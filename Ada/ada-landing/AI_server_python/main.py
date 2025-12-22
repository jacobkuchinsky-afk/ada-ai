import os
import json
import re
import gc
import threading
import uuid
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from datetime import date
from dotenv import load_dotenv
from openai import OpenAI
import grabbers
import concurrent.futures


# Thread-safe dict to track skip search requests by session_id
_skip_search_requests = {}
_skip_search_lock = threading.Lock()


def request_skip_search(session_id: str) -> bool:
    """Mark a session as requesting to skip search. Returns True if session was found."""
    with _skip_search_lock:
        if session_id in _skip_search_requests:
            _skip_search_requests[session_id] = True
            return True
        return False


def check_skip_search(session_id: str) -> bool:
    """Check if a session has requested to skip search."""
    with _skip_search_lock:
        return _skip_search_requests.get(session_id, False)


def register_session(session_id: str):
    """Register a new session for skip tracking."""
    with _skip_search_lock:
        _skip_search_requests[session_id] = False


def cleanup_session(session_id: str):
    """Clean up session from skip tracking."""
    with _skip_search_lock:
        _skip_search_requests.pop(session_id, None)


def clean_ai_output(text):
    """Remove thinking tags and other AI artifacts from output."""
    if not text:
        return text
    
    # Remove <think>...</think> tags and content (Qwen3 thinking format)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove <thinking>...</thinking> tags and content
    text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove any unclosed thinking tags at the start
    text = re.sub(r'^.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'^.*?</thinking>', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove the sentence marker mentioned in prompts
    text = text.replace('<｜begin▁of▁sentence｜>', '')
    
    # Remove any other common AI artifacts
    text = re.sub(r'<\|.*?\|>', '', text)  # Remove tokens like <|endoftext|>
    
    # Clean up extra whitespace
    text = re.sub(r'\n\s*\n', '\n', text)
    text = text.strip()
    
    return text

# Load environment variables
load_dotenv()

app = Flask(__name__)

# CORS configuration - allow all origins for the API
# This is safe because we don't use cookies/sessions for auth
CORS(app, resources={r"/api/*": {"origins": "*"}})

current_date = date.today()

# Model configurations
general = "moonshotai/Kimi-K2-Instruct-0905"
researcher = "Qwen/Qwen3-235B-A22B"
fast_general = "Qwen/Qwen3-235B-A22B"

# Prompts
search_depth_prompt = """Job: Decide how many results to look through in a web search based on how in depth the user's request is.
                        IMPORTANT: Your output structure should be only a number this will determine how many results and urls will be searched for the answer to what the user asked.
                        The more complex the question the higher number your response should be.
                        ONLY RETURN A NUMBER AND NOTHING ELSE!
                        NEVER ADD THIS TO YOUR RESPONSE: <｜begin▁of▁sentence｜>
                        For simple one answer questions like birthday, date, ect the number should be low like 1 or 2. If the question is more complex and needs a plethera of information make the number higher.
                        Example: 1 or 2 or 3 or 4 or 5 or 6 or 7 or 8
                        Max of 8 sources"""

main_prompt = f"""Job: You have been given large text from multiple sources. You need to, using the text answer the users question in an effecient, easy to read, and expository way.
                Follow all guidlines described Important guidlines
                - Your responses should be verbose and fully explain the topic unless asked by the user otherwise
                - Only use sources that are reputable
                - Favor data that is backed up by multiple sources
                Current date: {current_date}
                Output Structure:
                (First add an introduction this should be freindly and short/concise 1-2 sentences. It should introduce the subject. Format: %Give a positive remark about the users question (A couple of words maybe telling them that it is a great idea or question), %tell them a very breif summary of what you found (Half a sentence) %Flow into the sentence basic example : Here is some information that will be helpful. Make sure to fit the example to the question)
                (Next add a verbose output of all important information found in the text that may help answer or fufil the users question. Format: It is recomened to use bullet points, lists, and readable paragraph spacing for user readibilty. Make sure that this section fully answers the user question 100%. Make sure to include specific facts, quotes, and numerical data if it both pertains to the user question and is provided in the text.)
                (Then add a conclsion Format: Give the user an example of another question they could ask and how you could possibly expand you response)
                (Finally add all sources exactly as provided in the text. Format: Add Sources: The the hyperlinks where the text is the name of the sources and the link is the exact link to the sources follow the hyperlink guide for details. ALWAYS ADD SOURCES WHEN THERE WAS TEXT PROVIDED!)

                Format:
                Please use markdown formating: For example use bold to exemplify important data or ideas make sure to use bold sparingly to get the most important data across. Use the code block for code.
                
                HYPERLINKS: When referencing websites, sources, or external resources, ALWAYS use markdown hyperlink format make sure to use the hyperliunks for the required sources section:
                - Format: [Descriptive Text](https://url.com)
                - Example: [Official Python Documentation](https://docs.python.org)
                - Example: [Read more on Wikipedia](https://en.wikipedia.org/wiki/Topic)
                - For sources section, use: [Source Name](https://source-url.com)
                - NEVER just paste raw URLs - always wrap them in markdown link format with descriptive text
                - The descriptive text should tell the user what they'll find when clicking
                
                TABLES: When presenting comparative data, statistics, or structured information that would benefit from tabular format, use the special table syntax:
                §TABLE§
                Header1 | Header2 | Header3
                Row1Data1 | Row1Data2 | Row1Data3
                Row2Data1 | Row2Data2 | Row2Data3
                §/TABLE§
                - The first row is always headers
                - Separate columns with | (pipe character)
                - Each row on a new line
                - Use tables for: comparisons, specifications, pricing, statistics, feature lists, timelines
                - Do NOT use markdown tables with dashes (---), always use §TABLE§ format
                - IMPORTANT: Use exactly §TABLE§ to start and §/TABLE§ to end (with the § symbol)
                
                GRAPHS: When presenting numerical data, trends, comparisons, or relationships that would benefit from visual representation, use the special graph syntax:
                §GRAPH§
                {{
                  "type": "line|bar|scatter",
                  "title": "Chart Title (optional)",
                  "xAxis": {{"label": "X Axis Label", "type": "category|number"}},
                  "yAxis": {{"label": "Y Axis Label"}},
                  "data": [
                    {{"x": "Label1", "series1": 100, "series2": 150}},
                    {{"x": "Label2", "series1": 120, "series2": 170}}
                  ],
                  "series": [
                    {{"key": "series1", "name": "Display Name 1"}},
                    {{"key": "series2", "name": "Display Name 2"}}
                  ]
                }}
                §/GRAPH§
                Graph type guidelines:
                - "line": Use for trends over time, continuous data, multiple series comparisons
                - "bar": Use for categorical comparisons, discrete values, rankings
                - "scatter": Use for showing relationships between two variables, non-linear data, correlations
                Graph rules:
                - Use valid JSON inside the markers
                - "data" array contains objects where "x" is the x-axis value
                - "series" defines each line/bar series with a "key" (matching data keys) and "name" (display label)
                - For scatter plots, use numeric x values and include y key: {{"x": 10, "y": 25}}
                - Support up to 6 series per graph
                - Do NOT use markdown code blocks for graphs, always use §GRAPH§ format
                - IMPORTANT: Use exactly §GRAPH§ to start and §/GRAPH§ to end (with the § symbol)
                """

search_prompt = f"""You are an expert at converting questions into effective web search queries.

                    TASK: Transform the user's question into a single, optimized Google search query.

                    REQUIREMENTS:
                    - Create ONE focused search query (not multiple)
                    - Length: 3-10 words maximum (half to one sentence)
                    - Never use quotation marks (" or ')
                    - Focus on broad, findable information only (not specific tools or deep page content)
                    - Please give 4 search queries seperated by ~ Example: "~query1 ~ query2 ~ query3 ~ query4"
                    - The first query should be the most broad and general query that will return the most results. It should hoepfuly give results that directly answer the users question.
                    - The second query should attack the query from a different angle so if the first query doesnt give any quality results then the second query will be a fallback because it is from a different viewpoint.
                    - The third query should ask questions that arent full answersing the users quetion but getting background details and other useful information that might help support the answer
                    - The fourth query should be used as anther specific query aimed to gather information of somehting very specific to the users question. 
                    Exceptions:
                    - If the users question is simple enough that there is aboslutly no searching needed to find and fact check the answer then return ONLY '<No searching needed>' exactly and ignore all other questions.
                    Important: You HEAVILY favor searching for answers over not searching
                    CONTEXT: Current date: {current_date}

                    OUTPUT: Return only the search query, nothing else.
"""

goodness_decided_prompt = """Job: Decide if the provided data fully answers the user's question.

Respond with EXACTLY ONE of these markers:
- <<<SEARCH_COMPLETE>>> if the data fully answers the question
- <<<NEEDS_MORE_SEARCH>>> if more information is needed

If you choose <<<NEEDS_MORE_SEARCH>>>, briefly explain what's missing (1-2 sentences).

Guidelines:
- Favor stopping searches - only request more if critical information is clearly missing
- Do not request more searches for minor details or additional context
- The searcher can only do internet searches"""
chat_summary_prompt = """Job: Take the following chat logs and summarize the users question and then the output from the AI.
                        - The summarry should be short
                        - The questions summary should still keep the overall idea of what the question was
                        - The answer/output summary should keep the main points of what was said and some of the  speicifc numbers if possible"""
summarizer = """Job: Take the given chunk of data and summarize each source with all peices of data from it example: opinoins, numbers, data, quotes, ect. Please output everything important to the users question
                Format: Please produce the name of the source, link to the source, the information from the source under the source then repeat
                Your summary SHOULD NOT EVER answer the users question just summarize the data and pull together all data that could MAYBE be used to answer the users question even if the connect is thin. 
                Summary style: Your summary should be about 6 paragraphs long and have a list of important facts like numbers, quotes, data, ect."""


# Singleton OpenAI client - reused across all requests to prevent connection pool exhaustion
_openai_client = None
_openai_client_provider = None


def get_api_client():
    """Get the singleton API client based on configuration.
    
    Creates client once and reuses it for all requests.
    Thread-safe: OpenAI SDK client is designed for concurrent use.
    """
    global _openai_client, _openai_client_provider
    
    api_provider = os.getenv('API_PROVIDER', 'chutes')
    
    # Return existing client if it matches current provider
    if _openai_client is not None and _openai_client_provider == api_provider:
        return _openai_client
    
    # Create new client for current provider
    if api_provider == 'openrouter':
        api_key = os.getenv('OPENROUTER_API_KEY')
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")
        _openai_client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
            default_headers={"HTTP-Referer": os.getenv('FRONTEND_URL', 'http://localhost:3000')}
        )
    else:  # chutes
        api_key = os.getenv('CHUTES_API_KEY')
        if not api_key:
            raise ValueError("CHUTES_API_KEY environment variable is required")
        _openai_client = OpenAI(
            base_url="https://llm.chutes.ai/v1",
            api_key=api_key
        )
    
    _openai_client_provider = api_provider
    return _openai_client


def ai(prompt, instructions, think, model):
    """Non-streaming AI call for internal processing."""
    client = get_api_client()
    
    call_args = {
        "model": model,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": prompt}
        ],
        "stream": True
    }
    
    if think:
        call_args["max_tokens"] = 3000

    stream = client.chat.completions.create(**call_args)
    answer = ""
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            answer += content
    return answer


def ai_stream(prompt, instructions, model):
    """Streaming AI call that yields chunks for SSE."""
    client = get_api_client()
    
    call_args = {
        "model": model,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": prompt}
        ],
        "stream": True
    }

    stream = client.chat.completions.create(**call_args)
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            yield content


def summarize_research(search_data: str, user_question: str) -> str:
    """Summarize raw search data using the summarizer prompt.
    
    Args:
        search_data: Raw search data from previous message
        user_question: The user's question that the search was for
        
    Returns:
        Summarized research text, or empty string if summarization fails
    """
    if not search_data or len(search_data) < 100:
        return ""
    
    prompt = f"User question: {user_question}\n\nSearch data to summarize:\n{search_data[:40000]}"  # Cap input
    
    # Retry logic - try twice before giving up
    for attempt in range(2):
        try:
            result = ai(prompt, summarizer, False, fast_general)
            result = clean_ai_output(result)
            # Truncate if too long
            return result[:5000] if result else ""
        except Exception as e:
            if attempt == 0:
                print(f"Summarization attempt 1 failed: {e}, retrying...")
                continue  # Retry once
            print(f"Summarization failed after retry: {e}")
            return ""  # Skip on second failure
    
    return ""


def compress_memory(memory: list) -> list:
    """Compress oldest conversation pair if memory has 7+ exchanges.
    
    Args:
        memory: List of message dicts with 'role' and 'content' keys
        
    Returns:
        Memory list with oldest pair compressed if threshold met
    """
    if not memory or not isinstance(memory, list):
        return memory
    
    # Count pairs (user + assistant = 1 pair)
    # Filter to only count user and assistant messages
    conversation_messages = [m for m in memory if m.get('role') in ('user', 'assistant')]
    pairs = len(conversation_messages) // 2
    
    if pairs < 7:
        return memory
    
    # Find the first user message and its corresponding assistant response
    first_user_idx = None
    first_assistant_idx = None
    
    for i, msg in enumerate(memory):
        if msg.get('role') == 'user' and first_user_idx is None:
            first_user_idx = i
        elif msg.get('role') == 'assistant' and first_user_idx is not None and first_assistant_idx is None:
            first_assistant_idx = i
            break
    
    # If we can't find a valid pair, return original
    if first_user_idx is None or first_assistant_idx is None:
        return memory
    
    oldest_user = memory[first_user_idx]
    oldest_assistant = memory[first_assistant_idx]
    
    # Summarize using chat_summary_prompt
    chat_to_summarize = f"User: {oldest_user.get('content', '')}\n\nAssistant: {oldest_assistant.get('content', '')}"
    
    # Retry logic
    summary = None
    for attempt in range(2):
        try:
            summary = ai(chat_to_summarize[:20000], chat_summary_prompt, False, fast_general)  # Cap input
            summary = clean_ai_output(summary)
            break
        except Exception as e:
            if attempt == 0:
                print(f"Compression attempt 1 failed: {e}, retrying...")
                continue
            print(f"Compression failed after retry: {e}")
            # On second failure, keep original (don't lose data)
            return memory
    
    # If summary is empty or too short, keep original
    if not summary or len(summary) < 20:
        return memory
    
    # Truncate summary if too long
    summary = summary[:2000]
    
    # Replace oldest pair with compressed version
    compressed_message = {
        "role": "system",
        "content": f"[Compressed conversation summary]: {summary}"
    }
    
    # Build new memory: everything before first_user, compressed message, everything after first_assistant
    new_memory = memory[:first_user_idx] + [compressed_message] + memory[first_assistant_idx + 1:]
    
    return new_memory


def process_search(prompt, memory, previous_search_data=None, previous_user_question=None, session_id=None):
    """Process the search workflow and yield status updates and final streaming response.
    
    Args:
        prompt: The user's current message
        memory: Conversation history as list of {role, content} dicts
        previous_search_data: Raw search data from previous message (for summarization)
        previous_user_question: The user question from previous message (for summarization context)
        session_id: Unique session ID for skip search tracking
    """
    search_data = []
    search_history = []  # Track all searches for frontend
    iter_count = 0
    searching = True
    no_search = False
    query = ""
    service_failure_detected = False  # Track if search service is down
    research_summary = ""  # Will hold summarized previous research
    summary_future = None  # Future for parallel summarization
    
    # Yield immediate status so frontend knows we're processing
    yield {
        "type": "status", 
        "message": "Processing...", 
        "step": 0, 
        "icon": "thinking"
    }
    
    # Compress memory if it has 7+ conversation pairs (this may block if compression needed)
    memory = compress_memory(memory)
    
    # Check if this is a follow-up that needs searching
    if memory:
        yield {
            "type": "status", 
            "message": "Checking if search needed...", 
            "step": 0, 
            "icon": "thinking"
        }
        if_search = ai(
            "User question: " + prompt,
            "Job: This is a follow up question please decide if to answer it a internet search should be done. If yes please respond with <search> if no please respond with <no search>.",
            False, general
        )
        if_search = clean_ai_output(if_search)
        if "<search>" not in if_search:
            searching = False
    
    # Start parallel summarization of previous search data if:
    # 1. Current message will trigger a search (searching == True)
    # 2. We have previous search data to summarize
    # This runs in parallel with the search to minimize latency
    summarization_executor = None
    if searching and previous_search_data and len(previous_search_data) > 100:
        summarization_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        summary_future = summarization_executor.submit(
            summarize_research, 
            previous_search_data, 
            previous_user_question or prompt  # Use previous question if available, else current
        )
    
    while searching and iter_count < 4:
        # Only allow skip after first iteration (when goodness loop decides more search needed)
        in_goodness_loop = iter_count > 0
        
        # Check for skip request at the start of each iteration (only if in goodness loop)
        if in_goodness_loop and session_id and check_skip_search(session_id):
            yield {
                "type": "status",
                "message": "Search skipped by user, generating response...",
                "step": 3,
                "icon": "thinking",
                "canSkip": False
            }
            break
        
        # Step 1: Generate search query - canSkip only after first search (goodness loop)
        yield {
            "type": "status", 
            "message": "Thinking...", 
            "step": 1, 
            "icon": "thinking",
            "canSkip": in_goodness_loop  # Only allow skip in goodness loop (iter > 0)
        }
        
        if iter_count > 0 and not service_failure_detected:
            # Only regenerate query if previous search had results but they weren't good enough
            # Don't regenerate if the search service itself is down (that won't help)
            query = ai(
                "User question: " + prompt + " Your original query: " + query + " Failed, please make a new better suited query.",
                search_prompt, False, researcher
            )
        elif iter_count == 0:
            query = ai(
                "User question:" + prompt + " Memory: " + str(memory),
                search_prompt, False, researcher
            )
        
        # Clean AI output to remove thinking tags
        query = clean_ai_output(query)
        
        if "<No searching needed>" in query:
            no_search = True
            break
        
        query = query.replace('"', "").strip()
        
        # Split queries by ~ and search in parallel
        queries = [q.strip() for q in query.split("~") if q.strip()]
        
        # Clean each individual query too
        queries = [clean_ai_output(q) for q in queries]
        queries = [q for q in queries if q and len(q) > 2]  # Remove empty or tiny queries
        
        # If no valid queries after split, use original
        if not queries:
            queries = [query]
        
        depth = 5  # 5 sources per query (reduced from 8 to prevent memory issues)
        
        # Check for skip before starting searches (only if in goodness loop)
        if in_goodness_loop and session_id and check_skip_search(session_id):
            yield {
                "type": "status",
                "message": "Search skipped by user, generating response...",
                "step": 3,
                "icon": "thinking",
                "canSkip": False
            }
            searching = False
            break
        
        # Step 2: Send initial searching status for each query - canSkip only in goodness loop
        for q_idx, q in enumerate(queries):
            yield {
                "type": "status", 
                "message": f"Searching ({q_idx + 1}/{len(queries)}): {q[:50]}{'...' if len(q) > 50 else ''}", 
                "step": 2, 
                "icon": "searching",
                "canSkip": in_goodness_loop  # Only allow skip in goodness loop
            }
            # Send search event immediately with query (sources pending)
            yield {
                "type": "search",
                "query": q,
                "sources": [],
                "iteration": iter_count + 1,
                "queryIndex": q_idx + 1,
                "status": "searching"
            }
        
        # Search all queries in parallel using ThreadPoolExecutor
        def search_single_query(q):
            return grabbers.search_and_scrape(q, depth)
        
        # Store results with their query index for ordering
        search_results = {}
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as executor:
            future_to_query = {executor.submit(search_single_query, q): (idx, q) for idx, q in enumerate(queries)}
            
            for future in concurrent.futures.as_completed(future_to_query):
                idx, q = future_to_query[future]
                try:
                    scrape_result = future.result()
                    search_results[idx] = (q, scrape_result)
                except Exception as e:
                    print(f"Error searching query '{q}': {e}")
                    search_results[idx] = (q, {'sources': [], 'full_text': f'Search failed: {str(e)}', 'service_available': False})
        
        # Check if search service is down (all queries failed with service_available=False)
        service_unavailable_count = sum(
            1 for idx in range(len(queries))
            if not search_results.get(idx, (None, {}))[1].get('service_available', True)
        )
        if service_unavailable_count == len(queries):
            # All searches failed due to service being down - don't retry
            service_failure_detected = True
            print("Search service appears to be down - skipping further search attempts")
        
        # Process results in order and yield events
        for idx in range(len(queries)):
            q, scrape_result = search_results[idx]
            sources = scrape_result.get('sources', [])
            full_text = scrape_result.get('full_text', '')
            
            search_data.append(full_text)
            
            # Create search entry for history
            search_entry = {
                "query": q,
                "sources": sources,
                "iteration": iter_count + 1,
                "queryIndex": idx + 1
            }
            search_history.append(search_entry)
            
            # Build search event with sources
            search_event = {
                "type": "search",
                "query": q,
                "sources": sources,
                "iteration": iter_count + 1,
                "queryIndex": idx + 1,
                "status": "complete"
            }
            
            # Include text preview for first query only (for visual parsing feedback)
            if idx == 0 and full_text and len(full_text) > 50:
                # Get first 500 chars of actual content (skip source headers)
                text_preview = full_text[:500].replace('\n', ' ').strip()
                search_event["textPreview"] = text_preview
            
            yield search_event
        
        # If search service is down, exit the loop - don't waste time evaluating or retrying
        if service_failure_detected:
            searching = False
            no_search = True  # Fall back to AI knowledge
            yield {
                "type": "status",
                "message": "Search service unavailable, using AI knowledge...",
                "step": 3,
                "icon": "thinking"
            }
            break
        
        # Check if user requested to skip search BEFORE evaluation (only in goodness loop)
        if in_goodness_loop and session_id and check_skip_search(session_id):
            searching = False
            yield {
                "type": "status",
                "message": "Search skipped by user, generating response...",
                "step": 3,
                "icon": "thinking"
            }
            break
        
        # Step 3: Evaluate results - canSkip only in goodness loop
        yield {
            "type": "status", 
            "message": "Evaluating search results...", 
            "step": 3, 
            "icon": "evaluating",
            "canSkip": in_goodness_loop  # Only allow skip in goodness loop
        }
        
        # Check again after yielding (user may have clicked skip while status was shown)
        if in_goodness_loop and session_id and check_skip_search(session_id):
            searching = False
            yield {
                "type": "status",
                "message": "Search skipped by user, generating response...",
                "step": 3,
                "icon": "thinking"
            }
            break
        
        # Combine search data for evaluation
        eval_search_data = "\n\n---\n\n".join(search_data) if search_data else ""
        good = ai(
            "User prompt: " + prompt + "\n\nInformation gathered:\n" + eval_search_data,
            goodness_decided_prompt, False, general
        )
        
        # Clean AI output to remove thinking tags
        good = clean_ai_output(good)
        
        # Check for skip request after evaluation AI call (it may take a while) - only in goodness loop
        if in_goodness_loop and session_id and check_skip_search(session_id):
            searching = False
            yield {
                "type": "status",
                "message": "Search skipped by user, generating response...",
                "step": 3,
                "icon": "thinking"
            }
            break
        
        # Check for exact markers
        if "<<<NEEDS_MORE_SEARCH>>>" in good:
            # AI explicitly says more info needed - continue searching
            pass
        elif "<<<SEARCH_COMPLETE>>>" in good:
            # AI says search is complete - stop
            searching = False
        else:
            # Ambiguous response - default to stopping to prevent infinite loops
            searching = False
        
        iter_count += 1
    
    # Collect summarization result if it was started
    if summary_future is not None:
        try:
            research_summary = summary_future.result(timeout=30)  # 30 second timeout
            print(f"Research summarization completed: {len(research_summary)} chars")
        except concurrent.futures.TimeoutError:
            print("Research summarization timed out, skipping")
            research_summary = ""
        except Exception as e:
            print(f"Research summarization failed: {e}")
            research_summary = ""
    
    # Clean up the summarization executor
    if summarization_executor is not None:
        summarization_executor.shutdown(wait=False)
    
    # Step 4: Generate final response with streaming
    yield {
        "type": "status", 
        "message": "Generating response...", 
        "step": 4, 
        "icon": "generating"
    }
    
    # Combine all search data into a single formatted string
    combined_search_data = "\n\n=== COMBINED SEARCH RESULTS ===\n\n".join(search_data) if search_data else ""
    
    # Store raw search data for returning to frontend (capped at 50KB)
    raw_search_data_for_return = combined_search_data[:50000] if combined_search_data else ""
    
    # Free memory from search_data list before streaming
    search_data.clear()
    gc.collect()
    
    if no_search:
        prompt_text = "User question: " + prompt + "\n\nSearch data: " + combined_search_data + "\n\nNo data has been given just answer the users question truthfully"
    else:
        prompt_text = "User question: " + prompt + "\n\nSearch data:\n" + combined_search_data
    
    # Build instructions with memory and research summary
    instructions = main_prompt + " Memory from previous conversation: " + str(memory)
    
    # Add research summary from previous conversation if available
    if research_summary:
        instructions += f"\n\nSummarized research from previous conversation:\n{research_summary}"
    
    # Free combined_search_data after building prompt
    del combined_search_data
    gc.collect()
    
    # Stream the final response
    for chunk in ai_stream(prompt_text, instructions, general):
        yield {"type": "content", "data": chunk}
    
    # Send done event with complete search history and raw search data
    yield {
        "type": "done",
        "searchHistory": search_history,
        "rawSearchData": raw_search_data_for_return
    }


@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat requests with SSE streaming response."""
    data = request.json
    message = data.get('message', '')
    memory = data.get('memory', [])
    previous_search_data = data.get('previousSearchData', None)  # Raw search data from last message
    previous_user_question = data.get('previousUserQuestion', None)  # User question from last message
    session_id = data.get('sessionId', None)  # Session ID for skip search tracking
    
    if not message:
        return Response(
            json.dumps({"error": "No message provided"}),
            status=400,
            mimetype='application/json'
        )
    
    # Generate session_id if not provided
    if not session_id:
        session_id = str(uuid.uuid4())
    
    # Register session for skip tracking
    register_session(session_id)
    
    def generate():
        try:
            # Send session_id to frontend first so they can use it for skip requests
            yield f"data: {json.dumps({'type': 'session', 'sessionId': session_id})}\n\n"
            
            for update in process_search(message, memory, previous_search_data, previous_user_question, session_id):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Clean up session after request completes
            cleanup_session(session_id)
    
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )


@app.route('/api/skip-search', methods=['POST'])
def skip_search():
    """Endpoint to signal that the user wants to skip searching and go straight to generation."""
    data = request.json
    session_id = data.get('sessionId', '')
    
    if not session_id:
        return Response(
            json.dumps({"error": "No sessionId provided"}),
            status=400,
            mimetype='application/json'
        )
    
    success = request_skip_search(session_id)
    
    return Response(
        json.dumps({"success": success, "sessionId": session_id}),
        status=200,
        mimetype='application/json'
    )


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
