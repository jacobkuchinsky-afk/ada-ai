import os
import json
import re
import gc
import threading
import uuid
import base64
import traceback
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from datetime import date, datetime, timedelta
from dotenv import load_dotenv
from openai import OpenAI
import grabbers
import concurrent.futures
import stripe
import firebase_admin
from firebase_admin import credentials, firestore


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

# Stripe configuration - loaded lazily to avoid build-time issues
_stripe_initialized = False

def get_stripe_config():
    """Get Stripe configuration, initializing if needed."""
    global _stripe_initialized
    if not _stripe_initialized:
        # Use STRIPE_API_KEY to avoid Railway's secret detection on "SECRET" pattern
        stripe.api_key = os.getenv('STRIPE_API_KEY')
        _stripe_initialized = True
    return {
        # Use STRIPE_WEBHOOK_KEY to avoid Railway's secret detection
        'webhook_secret': os.getenv('STRIPE_WEBHOOK_KEY'),
        'price_id': os.getenv('STRIPE_PRICE_ID'),
        'frontend_url': os.getenv('FRONTEND_URL', 'http://localhost:3000')
    }

# Initialize Firebase Admin SDK
_firebase_initialized = False
_firestore_db = None

def get_firestore_db():
    """Get Firestore database instance, initializing Firebase if needed."""
    global _firebase_initialized, _firestore_db
    
    if _firebase_initialized:
        return _firestore_db
    
    # Try to initialize Firebase Admin SDK
    firebase_service_account = os.getenv('FIREBASE_SERVICE_ACCOUNT')
    
    if firebase_service_account:
        try:
            # Check if it's base64 encoded
            try:
                decoded = base64.b64decode(firebase_service_account)
                service_account_info = json.loads(decoded)
            except:
                # Assume it's raw JSON
                service_account_info = json.loads(firebase_service_account)
            
            cred = credentials.Certificate(service_account_info)
            firebase_admin.initialize_app(cred)
            _firestore_db = firestore.client()
            _firebase_initialized = True
            print("Firebase Admin SDK initialized successfully")
        except Exception as e:
            print(f"Error initializing Firebase Admin SDK: {e}")
            _firestore_db = None
    else:
        print("Warning: FIREBASE_SERVICE_ACCOUNT not set, Stripe webhooks won't update Firestore")
        _firestore_db = None
    
    _firebase_initialized = True
    return _firestore_db

app = Flask(__name__)

# CORS configuration - allow all origins for the API
# This is safe because we don't use cookies/sessions for auth
CORS(app, resources={r"/api/*": {
    "origins": "*",
    "allow_headers": ["Content-Type", "ngrok-skip-browser-warning", "bypass-tunnel-reminder"],
    "methods": ["GET", "POST", "OPTIONS"]
}})

# Global error handler to ensure CORS headers are always sent
@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all uncaught exceptions and return JSON with CORS headers."""
    print(f"[ERROR] Unhandled exception: {e}")
    traceback.print_exc()
    response = Response(
        json.dumps({"error": "Internal server error", "details": str(e)}),
        status=500,
        mimetype='application/json'
    )
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

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
                (Next add a verbose output of all important information found in the text that may help answer or fufil the users question. Format: It is recomened to use bullet points, lists, and readable paragraph spacing for user readibilty. Make sure that this section fully answers the user question 100%. Make sure to include specific facts, quotes, and numerical data if it both pertains to the user question and is provided in the text. In this output you may also add graphs and tables as described BUT ONLY WHEN IT MAKES SENSE TO DO SO.)
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
                
                IMAGES: You may be provided with a list of available images from the scraped sources. When an image would enhance your response or help illustrate a point, reference it using the special image syntax:
                §IMG:https://example.com/image.jpg§
                Image rules:
                - ONLY use image URLs from the "Available Images" list provided - NEVER make up or guess image URLs
                - Supported formats: .jpg, .jpeg, .png, .webp, .gif, .bmp, .avif (and CDN-hosted images)
                - ONLY reference images that have one of these supported extensions or are from known image CDNs
                - Do NOT reference .svg files or URLs without clear image extensions unless from a CDN
                - Place images inline where they are most relevant to the surrounding text
                - Use images sparingly - only when they add real value to the explanation
                - Add a brief description before or after the image to explain what it shows
                - Do NOT use markdown image syntax ![alt](url), always use §IMG:url§ format
                - IMPORTANT: Use exactly §IMG: to start and § to end (with the § symbol)
                - Example: "Here's what the product looks like: §IMG:https://example.com/product.jpg§"
                """

search_prompt = f"""You are an expert at converting questions into effective web search queries.

                    TASK: Transform the user's question into a single, optimized Google search query.

                    REQUIREMENTS:
                    - Length: 3-10 words maximum (half to one sentence)
                    - Never use quotation marks (" or ')
                    - Focus on broad, findable information only (not specific tools or deep page content)
                    - Please give 4 search queries seperated by ~ Example: "~query1 ~ query2 ~ query3 ~ query4"
                    - The first query should be the most broad and general query that will return the most results. It should hoepfuly give results that directly answer the users question.
                    - The second query should attack the query from a different angle so if the first query doesnt give any quality results then the second query will be a fallback because it is from a different viewpoint.
                    - The third query should ask questions that arent full answersing the users quetion but getting background details and other useful information that might help support the answer
                    - The fourth query should be used as anther specific query aimed to gather information of somehting very specific to the users question. 
                    - At the end of each search query please add depth<number> to the query to indicate how many sources to search for.
                    - Example depth: Example: 1 or 2 or 3 or 4 or 5 or 6 or 7 or 8 or 9 or 10
                    - For simple searches the number should be small and for comlicated searches the number should approach 10
                    - If the user asks for multiple things search each thing sperate as you have many searches. This will allow more details insetad of trying to group them. For example if the user asks how many chickens are there for each cow instead of searching that thing exactly search for the amount of chickens and then the amount of cows.
                    - Think about if the given search query would return any use results or if it is to specific, if it is to specific then possibly chop the query into multiple queries.
                    Exceptions:
                    - If the users question is simple enough that there is aboslutly no searching needed to find and fact check the answer then return ONLY '<No searching needed>' exactly and ignore all other questions.
                    - Add no searching needed if the users prompt follows one of these: If the users prompt is not a question and it could be answered without the need for fact checking, If the users prompt is conversational like hello, bye, ect.
        
                    CONTEXT: Current date: {current_date}

                    OUTPUT: Return only the search query, nothing else.
"""

search_fast_prompt = f"""You are an expert at converting questions into effective web search queries.

                    TASK: Transform the user's question into a single, optimized Google search query.

                    REQUIREMENTS:
                    - Create ONE focused search query (not multiple)
                    - Length: 3-10 words maximum (half to one sentence)
                    - Never use quotation marks (" or ')
                    - Focus on broad, findable information only (not specific tools or deep page content)
                    - The user has asked for the answer to be quick so the depth should be under 5.
                    - At the end of each search query please add depth<number> to the query to indicate how many sources to search for.
                    - Example depth: Example: 1 or 2 or 3 or 4 or 5
                    - For simple searches the number should be VERY small (1 or 2)
                   
                    - Make sure the search query will return useful results if it will not as in it is too specific on somehting change the query to something more broad.
                    Exceptions:
                    - If the users question is simple enough that there is aboslutly no searching needed to find and fact check the answer then return ONLY '<No searching needed>' exactly and ignore all other questions.
                    - Add no searching needed if the users prompt follows one of these: If the users prompt is not a question and it could be answered without the need for fact checking, If the users prompt is conversational like hello, bye, ect.
                    - The user has asked for a fast response, searching takes time so if it is one the line if searching is needed go for not searching.
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


def process_search(prompt, memory, previous_search_data=None, previous_user_question=None, session_id=None, fast_mode=False):
    """Process the search workflow and yield status updates and final streaming response.
    
    Args:
        prompt: The user's current message
        memory: Conversation history as list of {role, content} dicts
        previous_search_data: Raw search data from previous message (for summarization)
        previous_user_question: The user question from previous message (for summarization context)
        session_id: Unique session ID for skip search tracking
        fast_mode: If True, use faster search prompt and skip goodness loop for quicker responses
    """
    search_data = []
    search_history = []  # Track all searches for frontend
    all_images = []  # Collect images from all search results
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
            # In fast mode, this block should never execute since we skip the goodness loop
            query = ai(
                "User question: " + prompt + " Your original query: " + query + " Failed, please make a new better suited query.",
                search_fast_prompt if fast_mode else search_prompt, False, researcher
            )
        elif iter_count == 0:
            # Use fast search prompt when fast_mode is enabled (single query, lower depth)
            query = ai(
                "User question:" + prompt + " Memory: " + str(memory),
                search_fast_prompt if fast_mode else search_prompt, False, researcher
            )
        
        # Clean AI output to remove thinking tags
        query = clean_ai_output(query)
        
        if "<No searching needed>" in query:
            no_search = True
            break
        
        query = query.replace('"', "").strip()
        
        # Split queries by ~ and extract depth from each
        # Format: "query text depth<number>" e.g. "nvidia stock price depth3"
        queries_with_depth = []
        for raw_q in query.split("~"):
            q = clean_ai_output(raw_q).strip()
            if not q or len(q) <= 2:
                continue
            
            # Extract depth using regex (handles "depth3", "depth 3", "Depth3", etc.)
            depth_match = re.search(r'depth\s*(\d+)', q, re.IGNORECASE)
            if depth_match:
                query_depth = min(max(int(depth_match.group(1)), 1), 10)
                q = re.sub(r'depth\s*\d+', '', q, flags=re.IGNORECASE).strip()
            else:
                query_depth = 5  # Default
            
            if q and len(q) > 2:
                queries_with_depth.append((q, query_depth))
                print(f"[DEPTH] Query: '{q[:40]}...' -> depth={query_depth}")
        
        # Fallback if no valid queries
        if not queries_with_depth:
            queries_with_depth = [(query, 5)]
        
        queries = [q for q, _ in queries_with_depth]
        
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
        def search_single_query(q, depth):
            return grabbers.search_and_scrape(q, depth)
        
        # Store results with their query index for ordering
        search_results = {}
        text_preview_sent = False  # Track if we've sent a text preview yet
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as executor:
            future_to_query = {executor.submit(search_single_query, q, d): (idx, q) for idx, (q, d) in enumerate(queries_with_depth)}
            
            for future in concurrent.futures.as_completed(future_to_query):
                idx, q = future_to_query[future]
                try:
                    scrape_result = future.result()
                    search_results[idx] = (q, scrape_result)
                    
                    # Send text preview immediately when FIRST result with content arrives
                    if not text_preview_sent:
                        full_text = scrape_result.get('full_text', '')
                        if full_text and len(full_text) > 50:
                            text_preview = full_text[:800].replace('\n', ' ').strip()
                            text_preview_sent = True
                            print(f"[TEXTPREVIEW] Sending preview from query '{q[:30]}...', length={len(text_preview)}")
                            yield {
                                "type": "text_preview",
                                "text": text_preview,
                                "iteration": iter_count + 1
                            }
                except Exception as e:
                    print(f"Error searching query '{q}': {e}")
                    search_results[idx] = (q, {'sources': [], 'full_text': f'Search failed: {str(e)}', 'images': [], 'service_available': False})
        
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
            images = scrape_result.get('images', [])
            
            search_data.append(full_text)
            all_images.extend(images)  # Collect images from all results
            
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
        
        # In fast mode, skip the goodness evaluation entirely - just use first search results
        if fast_mode:
            good = "<<<SEARCH_COMPLETE>>>"  # Fake completion to skip loop
        else:
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
        
        # In fast mode, skip the goodness loop entirely after first search
        if fast_mode:
            searching = False
            iter_count += 1
            continue
        
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
    
    # Add available images to the prompt if any were found
    if all_images:
        # Limit to 25 images max to avoid overwhelming the AI
        available_images = all_images[:25]
        images_text = "\n\nAvailable Images (use §IMG:url§ to reference):\n"
        for i, img in enumerate(available_images, 1):
            alt_text = f" - {img['alt']}" if img.get('alt') else ""
            images_text += f"{i}. {img['url']}{alt_text}\n"
        prompt_text += images_text
    
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
    fast_mode = data.get('fastMode', False)  # Fast mode flag for quicker responses
    
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
            
            for update in process_search(message, memory, previous_search_data, previous_user_question, session_id, fast_mode):
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


@app.route('/api/create-checkout', methods=['POST'])
def create_checkout():
    """Create a Stripe Checkout session for premium subscription."""
    # #region agent log
    import time as _t; _log_data = {"location":"main.py:create_checkout:entry","message":"create_checkout endpoint called","data":{"method":request.method,"origin":request.headers.get('Origin'),"content_type":request.headers.get('Content-Type')},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"B,C"}
    with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data)+"\n")
    # #endregion
    # Initialize Stripe
    config = get_stripe_config()
    # #region agent log
    _log_data2 = {"location":"main.py:create_checkout:config","message":"Stripe config loaded","data":{"api_key_set":bool(stripe.api_key),"price_id":config.get('price_id'),"webhook_secret_set":bool(config.get('webhook_secret')),"frontend_url":config.get('frontend_url')},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"D"}
    with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data2)+"\n")
    # #endregion
    print(f"[Checkout] Config loaded - API key set: {bool(stripe.api_key)}, Price ID: {config.get('price_id')}")
    
    data = request.json
    user_id = data.get('userId') if data else None
    user_email = data.get('email') if data else None
    
    print(f"[Checkout] Request - userId: {user_id}, email: {user_email}")
    
    if not user_id:
        return Response(
            json.dumps({"error": "userId is required"}),
            status=400,
            mimetype='application/json'
        )
    
    if not stripe.api_key:
        print("[Checkout] ERROR: Stripe API key not configured")
        return Response(
            json.dumps({"error": "Stripe not configured - missing STRIPE_API_KEY"}),
            status=500,
            mimetype='application/json'
        )
    
    if not config.get('price_id'):
        print("[Checkout] ERROR: Stripe price ID not configured")
        return Response(
            json.dumps({"error": "Stripe not configured - missing STRIPE_PRICE_ID"}),
            status=500,
            mimetype='application/json'
        )
    
    try:
        # #region agent log
        _log_data3 = {"location":"main.py:create_checkout:try_block","message":"Entering try block for checkout","data":{"user_id":user_id,"user_email":user_email},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"C,E"}
        with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data3)+"\n")
        # #endregion
        # Check if user already has a Stripe customer ID
        db = get_firestore_db()
        # #region agent log
        _log_data4 = {"location":"main.py:create_checkout:firestore","message":"Firestore db obtained","data":{"db_available":db is not None},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"E"}
        with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data4)+"\n")
        # #endregion
        existing_customer_id = None
        
        if db:
            user_doc = db.collection('users').document(user_id).get()
            if user_doc.exists:
                user_data = user_doc.to_dict()
                existing_customer_id = user_data.get('stripeCustomerId')
        
        # Create or reuse customer
        if existing_customer_id:
            customer_id = existing_customer_id
        else:
            # Create a new Stripe customer
            customer_params = {'metadata': {'firebaseUserId': user_id}}
            if user_email:
                customer_params['email'] = user_email
            customer = stripe.Customer.create(**customer_params)
            customer_id = customer.id
            
            # Store customer ID in Firestore
            if db:
                db.collection('users').document(user_id).set({
                    'stripeCustomerId': customer_id
                }, merge=True)
        
        # Create Checkout session
        checkout_session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=['card'],
            line_items=[{
                'price': config['price_id'],
                'quantity': 1,
            }],
            mode='subscription',
            success_url=f"{config['frontend_url']}/dashboard?payment=success",
            cancel_url=f"{config['frontend_url']}/profile?payment=cancelled",
            metadata={
                'firebaseUserId': user_id
            },
            subscription_data={
                'metadata': {
                    'firebaseUserId': user_id
                }
            }
        )
        
        # #region agent log
        _log_data5 = {"location":"main.py:create_checkout:success","message":"Checkout session created successfully","data":{"session_id":checkout_session.id,"has_url":bool(checkout_session.url)},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"C"}
        with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data5)+"\n")
        # #endregion
        return Response(
            json.dumps({"url": checkout_session.url, "sessionId": checkout_session.id}),
            status=200,
            mimetype='application/json'
        )
        
    except stripe.error.StripeError as e:
        # #region agent log
        _log_data6 = {"location":"main.py:create_checkout:stripe_error","message":"Stripe error occurred","data":{"error":str(e),"error_type":type(e).__name__},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"C,D"}
        with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data6)+"\n")
        # #endregion
        print(f"Stripe error: {e}")
        return Response(
            json.dumps({"error": str(e)}),
            status=400,
            mimetype='application/json'
        )
    except Exception as e:
        # #region agent log
        _log_data7 = {"location":"main.py:create_checkout:generic_error","message":"Generic error in checkout","data":{"error":str(e),"error_type":type(e).__name__},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"C,E"}
        with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data7)+"\n")
        # #endregion
        print(f"Error creating checkout session: {e}")
        return Response(
            json.dumps({"error": "Failed to create checkout session"}),
            status=500,
            mimetype='application/json'
        )


@app.route('/api/stripe-webhook', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhook events."""
    payload = request.get_data(as_text=True)
    sig_header = request.headers.get('Stripe-Signature')
    
    # Get Stripe config
    config = get_stripe_config()
    webhook_secret = config['webhook_secret']
    
    if not webhook_secret:
        print("Warning: STRIPE_WEBHOOK_SECRET not set")
        return Response(status=400)
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, webhook_secret
        )
    except ValueError as e:
        print(f"Invalid payload: {e}")
        return Response(status=400)
    except stripe.error.SignatureVerificationError as e:
        print(f"Invalid signature: {e}")
        return Response(status=400)
    
    db = get_firestore_db()
    if not db:
        print("Firestore not available, cannot process webhook")
        return Response(status=500)
    
    event_type = event['type']
    print(f"Processing Stripe webhook: {event_type}")
    
    try:
        if event_type == 'checkout.session.completed':
            session = event['data']['object']
            user_id = session.get('metadata', {}).get('firebaseUserId')
            subscription_id = session.get('subscription')
            customer_id = session.get('customer')
            
            if user_id and subscription_id:
                # Get subscription details for the period end
                subscription = stripe.Subscription.retrieve(subscription_id)
                period_end = datetime.fromtimestamp(subscription.current_period_end)
                
                # Update user to premium
                db.collection('users').document(user_id).set({
                    'isPremium': True,
                    'premiumExpiresAt': period_end,
                    'stripeCustomerId': customer_id,
                    'stripeSubscriptionId': subscription_id,
                    'subscriptionStatus': 'active',
                    'credits': 200,  # Give them premium credits immediately
                }, merge=True)
                print(f"User {user_id} upgraded to premium, expires {period_end}")
        
        elif event_type == 'customer.subscription.updated':
            subscription = event['data']['object']
            user_id = subscription.get('metadata', {}).get('firebaseUserId')
            
            if user_id:
                cancel_at_period_end = subscription.get('cancel_at_period_end', False)
                status = subscription.get('status')
                period_end = datetime.fromtimestamp(subscription.current_period_end)
                
                update_data = {
                    'premiumExpiresAt': period_end,
                }
                
                if cancel_at_period_end:
                    update_data['subscriptionStatus'] = 'cancelling'
                    print(f"User {user_id} subscription cancelling at period end")
                elif status == 'active':
                    update_data['subscriptionStatus'] = 'active'
                    update_data['isPremium'] = True
                    print(f"User {user_id} subscription renewed/active")
                
                db.collection('users').document(user_id).set(update_data, merge=True)
        
        elif event_type == 'customer.subscription.deleted':
            subscription = event['data']['object']
            user_id = subscription.get('metadata', {}).get('firebaseUserId')
            
            if user_id:
                # Subscription ended - remove premium
                db.collection('users').document(user_id).set({
                    'isPremium': False,
                    'subscriptionStatus': 'cancelled',
                    'stripeSubscriptionId': None,
                }, merge=True)
                print(f"User {user_id} subscription cancelled, premium removed")
        
        elif event_type == 'invoice.payment_failed':
            invoice = event['data']['object']
            subscription_id = invoice.get('subscription')
            
            if subscription_id:
                # Get user ID from subscription metadata
                subscription = stripe.Subscription.retrieve(subscription_id)
                user_id = subscription.get('metadata', {}).get('firebaseUserId')
                
                if user_id:
                    db.collection('users').document(user_id).set({
                        'subscriptionStatus': 'payment_failed',
                    }, merge=True)
                    print(f"User {user_id} payment failed")
        
        return Response(json.dumps({"received": True}), status=200, mimetype='application/json')
        
    except Exception as e:
        print(f"Error processing webhook: {e}")
        return Response(status=500)


@app.route('/api/cancel-subscription', methods=['POST'])
def cancel_subscription():
    """Cancel a user's subscription at the end of the billing period."""
    # Initialize Stripe
    get_stripe_config()
    
    data = request.json
    user_id = data.get('userId')
    
    if not user_id:
        return Response(
            json.dumps({"error": "userId is required"}),
            status=400,
            mimetype='application/json'
        )
    
    if not stripe.api_key:
        return Response(
            json.dumps({"error": "Stripe not configured"}),
            status=500,
            mimetype='application/json'
        )
    
    try:
        db = get_firestore_db()
        if not db:
            return Response(
                json.dumps({"error": "Database not available"}),
                status=500,
                mimetype='application/json'
            )
        
        # Get user's subscription ID
        user_doc = db.collection('users').document(user_id).get()
        if not user_doc.exists:
            return Response(
                json.dumps({"error": "User not found"}),
                status=404,
                mimetype='application/json'
            )
        
        user_data = user_doc.to_dict()
        subscription_id = user_data.get('stripeSubscriptionId')
        
        if not subscription_id:
            return Response(
                json.dumps({"error": "No active subscription found"}),
                status=400,
                mimetype='application/json'
            )
        
        # Cancel at period end (user keeps premium until end of billing cycle)
        subscription = stripe.Subscription.modify(
            subscription_id,
            cancel_at_period_end=True
        )
        
        # Update Firestore
        period_end = datetime.fromtimestamp(subscription.current_period_end)
        db.collection('users').document(user_id).set({
            'subscriptionStatus': 'cancelling',
            'premiumExpiresAt': period_end,
        }, merge=True)
        
        return Response(
            json.dumps({
                "success": True,
                "message": f"Subscription will cancel at end of billing period",
                "expiresAt": period_end.isoformat()
            }),
            status=200,
            mimetype='application/json'
        )
        
    except stripe.error.StripeError as e:
        print(f"Stripe error cancelling subscription: {e}")
        return Response(
            json.dumps({"error": str(e)}),
            status=400,
            mimetype='application/json'
        )
    except Exception as e:
        print(f"Error cancelling subscription: {e}")
        return Response(
            json.dumps({"error": "Failed to cancel subscription"}),
            status=500,
            mimetype='application/json'
        )


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == '__main__':
    # #region agent log
    import time as _t
    _log_data = {"location":"main.py:startup","message":"Server starting","data":{"stripe_imported":True,"firebase_imported":True,"port":int(os.getenv('PORT', 5000))},"timestamp":_t.time()*1000,"sessionId":"debug-session","hypothesisId":"A"}
    try:
        with open(r"c:\Users\jacob\Downloads\Ada\.cursor\debug.log", "a") as _f: _f.write(__import__('json').dumps(_log_data)+"\n")
    except: pass
    # #endregion
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
