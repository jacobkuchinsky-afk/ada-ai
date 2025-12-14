import os
import json
import re
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from datetime import date
from dotenv import load_dotenv
from openai import OpenAI
import grabbers
import concurrent.futures
import time

# === PERFORMANCE OPTIMIZATIONS ===
# 1. Singleton API client (connection reuse)
# 2. Parallel searching
# 3. Reduced sources per query (5 instead of 8)
# 4. Non-streaming mode for internal AI calls (faster)
# 5. Optimized prompts (shorter = faster)
# 6. Smart search detection (skip search for simple questions)
# 7. Goodness evaluation loop to ensure quality answers


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

# CORS configuration
CORS(app, resources={r"/api/*": {"origins": "*"}})

current_date = date.today()

# === MODEL CONFIGURATION ===
# Using heavier models for better quality
general = "moonshotai/Kimi-K2-Instruct-0905"  # Main response generation
researcher = "Qwen/Qwen3-235B-A22B"  # Heavy model for query generation and evaluation

# === SINGLETON API CLIENT ===
_api_client = None

def get_api_client():
    """Get singleton API client for connection reuse."""
    global _api_client
    if _api_client is None:
        api_provider = os.getenv('API_PROVIDER', 'chutes')
        
        if api_provider == 'openrouter':
            api_key = os.getenv('OPENROUTER_API_KEY')
            if not api_key:
                raise ValueError("OPENROUTER_API_KEY environment variable is required")
            _api_client = OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=api_key,
                default_headers={"HTTP-Referer": os.getenv('FRONTEND_URL', 'http://localhost:3000')}
            )
        else:  # chutes
            api_key = os.getenv('CHUTES_API_KEY')
            if not api_key:
                raise ValueError("CHUTES_API_KEY environment variable is required")
            _api_client = OpenAI(
                base_url="https://llm.chutes.ai/v1",
                api_key=api_key
            )
    return _api_client


# === PROMPTS ===

search_prompt = f"""You are an expert at converting questions into effective web search queries.

TASK: Transform the user's question into optimized Google search queries.

REQUIREMENTS:
- Create focused search queries (not multiple)
- Length: 3-10 words maximum (half to one sentence)
- Never use quotation marks (" or ')
- Focus on broad, findable information only (not specific tools or deep page content)
- Please give 4 search queries separated by ~ Example: "~query1 ~ query2 ~ query3 ~ query4"
- The first query should be the most broad and general query that will return the most results. It should hopefully give results that directly answer the users question.
- The second query should attack the query from a different angle so if the first query doesn't give any quality results then the second query will be a fallback because it is from a different viewpoint.
- The third query should ask questions that aren't fully answering the users question but getting background details and other useful information that might help support the answer
- The fourth query should be used as another specific query aimed to gather information of something very specific to the users question.

Exceptions:
- If the users question is simple enough that there is absolutely no searching needed to find and fact check the answer then return ONLY '<No searching needed>' exactly and ignore all other questions.
Important: You HEAVILY favor searching for answers over not searching

CONTEXT: Current date: {current_date}

OUTPUT: Return only the search queries, nothing else."""

main_prompt = f"""Job: You have been given large text from multiple sources. You need to, using the text answer the users question in an efficient, easy to read, and expository way.
Follow all guidelines described Important guidelines
- Your responses should be verbose and fully explain the topic unless asked by the user otherwise
- Only use sources that are reputable
- Favor data that is backed up by multiple sources
Current date: {current_date}
Output Structure:
(First add an introduction this should be friendly and short/concise 1-2 sentences. It should introduce the subject. Format: %Give a positive remark about the users question (A couple of words maybe telling them that it is a great idea or question), %tell them a very brief summary of what you found (Half a sentence) %Flow into the sentence basic example : Here is some information that will be helpful. Make sure to fit the example to the question)
(Next add a verbose output of all important information found in the text that may help answer or fulfill the users question. Format: It is recommended to use bullet points, lists, and readable paragraph spacing for user readability. Make sure that this section fully answers the user question 100%. Make sure to include specific facts, quotes, and numerical data if it both pertains to the user question and is provided in the text.)
(Then add a conclusion Format: Give the user an example of another question they could ask and how you could possibly expand your response)
(Finally add all sources exactly as provided in the text. Format: Add Sources: then all sources with names and then link. Example: Source_Name: https:\\source_link)
Format:
Please use markdown formatting: For example use bold to exemplify important data or ideas make sure to use bold sparingly to get the most important data across. Use the code block for code."""

goodness_decided_prompt = """Job: Decide if the provided data fully answers the users question to 100%. This means the provided data gives the entire answer and FULLY matches the users question.
If it does NOT FULLY answer the users question please include <Does not fully answer user question> in your response and what could be used to gather more information where information is lacking the first amount of data. Please also include what information was missing this should be 2 sentences long in total. The searcher this will be fed to can only do internet searches.
If it does FULLY answer the users question please include <Fully answers user question> and nothing else.
You do not care about conciseness or verbosity AT ALL 
You favor not searching for more answers and only search for more when needed"""

# Prompt for checking if search is needed on follow-ups
follow_up_check_prompt = """Job: This is a follow up question please decide if to answer it a internet search should be done. If yes please respond with <search> if no please respond with <no search>."""


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
    return clean_ai_output(answer)


def ai_stream(prompt, instructions, model):
    """Streaming AI call that yields chunks for SSE."""
    client = get_api_client()
    
    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": instructions},
            {"role": "user", "content": prompt}
        ],
        stream=True
    )
    
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            yield content


def process_search(prompt, memory):
    """
    Search workflow with goodness evaluation loop and parallel processing.
    """
    search_data = []
    search_history = []
    iter_count = 0
    searching = True
    no_search = False
    query = ""
    
    start_time = time.time()
    
    # === STEP 1: Check if search is needed (for follow-ups) ===
    if memory and len(memory) > 0:
        yield {
            "type": "status", 
            "message": "Checking if search needed...", 
            "step": 0, 
            "icon": "thinking"
        }
        
        if_search = ai(
            "User question: " + prompt,
            follow_up_check_prompt,
            False, researcher
        )
        
        if "<no search>" in if_search.lower():
            searching = False
    
    # === SEARCH LOOP WITH GOODNESS EVALUATION ===
    while searching and iter_count < 4:
        # Step 2: Generate search query
        yield {
            "type": "status", 
            "message": "Thinking...", 
            "step": 1, 
            "icon": "thinking"
        }
        
        if iter_count > 0:
            query = ai(
                "User question: " + prompt + " Your original query: " + query + " Failed, please make a new better suited query.",
                search_prompt, False, researcher
            )
        else:
            query = ai(
                "User question:" + prompt + " Memory: " + str(memory),
                search_prompt, False, researcher
            )
        
        query = clean_ai_output(query)
        
        if "<No searching needed>" in query:
            no_search = True
            break
        
        query = query.replace('"', "").strip()
        
        # Split queries by ~ and search in parallel
        queries = [q.strip() for q in query.split("~") if q.strip()]
        queries = [clean_ai_output(q) for q in queries]
        queries = [q for q in queries if q and len(q) > 2]
        
        # If no valid queries after split, use original
        if not queries:
            queries = [query]
        
        # Limit to 4 queries
        queries = queries[:4]
        
        depth = 5  # 5 sources per query (reduced from 8 for speed)
        
        # Step 3: Send initial searching status for each query
        for q_idx, q in enumerate(queries):
            yield {
                "type": "status", 
                "message": f"Searching ({q_idx + 1}/{len(queries)}): {q[:50]}{'...' if len(q) > 50 else ''}", 
                "step": 2, 
                "icon": "searching"
            }
            yield {
                "type": "search",
                "query": q,
                "sources": [],
                "iteration": iter_count + 1,
                "queryIndex": q_idx + 1,
                "status": "searching"
            }
        
        # Search all queries in parallel using ThreadPoolExecutor
        search_results = {}
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as executor:
            future_to_query = {executor.submit(grabbers.search_and_scrape, q, depth): (idx, q) for idx, q in enumerate(queries)}
            
            for future in concurrent.futures.as_completed(future_to_query):
                idx, q = future_to_query[future]
                try:
                    scrape_result = future.result()
                    search_results[idx] = (q, scrape_result)
                except Exception as e:
                    print(f"Error searching query '{q}': {e}")
                    search_results[idx] = (q, {'sources': [], 'full_text': f'Search failed: {str(e)}'})
        
        # Process results in order and yield events
        for idx in range(len(queries)):
            q, scrape_result = search_results[idx]
            sources = scrape_result.get('sources', [])
            full_text = scrape_result.get('full_text', '')
            
            search_data.append(full_text)
            
            search_entry = {
                "query": q,
                "sources": sources,
                "iteration": iter_count + 1,
                "queryIndex": idx + 1
            }
            search_history.append(search_entry)
            
            yield {
                "type": "search",
                "query": q,
                "sources": sources,
                "iteration": iter_count + 1,
                "queryIndex": idx + 1,
                "status": "complete"
            }
        
        # Step 4: Evaluate results (GOODNESS CHECK)
        yield {
            "type": "status", 
            "message": "Evaluating search results...", 
            "step": 3, 
            "icon": "evaluating"
        }
        
        # Combine search data for evaluation
        eval_search_data = "\n\n---\n\n".join(search_data) if search_data else ""
        good = ai(
            "User prompt: " + prompt + "\n\nInformation gathered:\n" + eval_search_data,
            goodness_decided_prompt, False, researcher
        )
        
        good = clean_ai_output(good)
        good_lower = good.lower()
        
        # Only continue searching if AI explicitly says answer is incomplete
        if "does not fully answer" in good_lower or "doesn't fully answer" in good_lower:
            # AI says more info needed - continue searching
            print(f"Iteration {iter_count + 1}: Need more info, searching again...")
            pass
        else:
            # AI says it's answered OR response is ambiguous - stop searching
            searching = False
        
        iter_count += 1
    
    # === STEP 5: Generate final response with streaming ===
    yield {
        "type": "status", 
        "message": "Generating response...", 
        "step": 4, 
        "icon": "generating"
    }
    
    # Combine all search data into a single formatted string
    combined_search_data = "\n\n=== COMBINED SEARCH RESULTS ===\n\n".join(search_data) if search_data else ""
    
    if no_search:
        prompt_text = "User question: " + prompt + "\n\nSearch data: " + combined_search_data + "\n\nNo data has been given just answer the users question truthfully"
    else:
        prompt_text = "User question: " + prompt + "\n\nSearch data:\n" + combined_search_data
    
    instructions = main_prompt + " Memory from previous conversation: " + str(memory)
    
    # Stream the final response
    for chunk in ai_stream(prompt_text, instructions, general):
        yield {"type": "content", "data": chunk}
    
    total_time = time.time() - start_time
    print(f"Total process_search time: {total_time:.2f}s (iterations: {iter_count})")
    
    yield {
        "type": "done",
        "searchHistory": search_history
    }


@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat requests with SSE streaming response."""
    data = request.json
    message = data.get('message', '')
    memory = data.get('memory', [])
    
    if not message:
        return Response(
            json.dumps({"error": "No message provided"}),
            status=400,
            mimetype='application/json'
        )
    
    def generate():
        try:
            for update in process_search(message, memory):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            print(f"Chat error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return {"status": "ok"}


@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    """Clear search cache endpoint."""
    grabbers.clear_search_cache()
    return {"status": "cache cleared"}


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
