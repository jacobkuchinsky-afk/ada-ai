import os
import json
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from datetime import date
from dotenv import load_dotenv
from openai import OpenAI
import grabbers

# Load environment variables
load_dotenv()

app = Flask(__name__)

# CORS configuration - allow localhost for development and Vercel for production
CORS(app, origins=[
    "http://localhost:3000",
    "https://*.vercel.app",
    os.getenv('FRONTEND_URL', '')  # Allow custom frontend URL from env
], supports_credentials=True)

current_date = date.today()

# Model configurations
general = "moonshotai/Kimi-K2-Instruct-0905"
researcher = "deepseek-ai/DeepSeek-V3.2"
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
                (Finnally add all sources exactly as provided in the text. Format: Add Sources: then all sources with names and then link. Example: Source_Name: https:\\source_link)
                Format:
                Please use markdown formating: For example use bold to exemplify important data or ideas. Use the code block for code.
                """

search_prompt = f"""You are an expert at converting questions into effective web search queries.

                    TASK: Transform the user's question into a single, optimized Google search query.

                    REQUIREMENTS:
                    - Create ONE focused search query (not multiple)
                    - Length: 3-10 words maximum (half to one sentence)
                    - Never use quotation marks (" or ')
                    - Focus on broad, findable information only (not specific tools or deep page content)
                    Exceptions:
                    - If the users question is simple enough that there is aboslutly no searching needed to find and fact check the answer then return ONLY '<No searching needed>' exactly and ignore all other questions.
                    Important: You HEAVILY favor searching for answers over not searching
                    CONTEXT: Current date: {current_date}

                    OUTPUT: Return only the search query, nothing else.
"""

goodness_decided_prompt = """Job: Decide if the provied data fully answers the users question to 100%. This means the the provied data gives the entire answer and FULLY matches the users question
                            If it does NOT FULLY answer the users question please include <Does not fully answer user question> in your reponse and what could be used to gather more information where information is lacking the first amount of data. Please also inlude what information was missing this should be 2 sentences long in total. The searcher this will be fed to can only do internet searches.
                             If it does FULLY answer the users question please include <Fully answers user question> and nothing else.
                              You do not care about conciseness or verbosity AT ALL """

summarizer = """Job: Take the given chunk of data and summarize each source with all peices of data from it example: opinoins, numbers, data, quotes, ect. Please output everything important to the users question
                Format: Please produce the name of the source, link to the source, the information from the source under the source then repeat
                Your summary SHOULD NOT EVER answer the users question just summarize the data and pull together all data that could MAYBE be used to answer the users question even if the connect is thin. 
                Summary style: Your summary should be think and verbose with large walls of text"""


def get_api_client():
    """Get the API client based on configuration."""
    api_provider = os.getenv('API_PROVIDER', 'chutes')
    
    if api_provider == 'openrouter':
        api_key = os.getenv('OPENROUTER_API_KEY')
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")
        return OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
            default_headers={"HTTP-Referer": os.getenv('FRONTEND_URL', 'http://localhost:3000')}
        )
    else:  # chutes
        api_key = os.getenv('CHUTES_API_KEY')
        if not api_key:
            raise ValueError("CHUTES_API_KEY environment variable is required")
        return OpenAI(
            base_url="https://llm.chutes.ai/v1",
            api_key=api_key
        )


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


def process_search(prompt, memory):
    """Process the search workflow and yield status updates and final streaming response."""
    search_data = []
    search_history = []  # Track all searches for frontend
    iter_count = 0
    searching = True
    no_search = False
    query = ""
    
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
        if "<search>" not in if_search:
            searching = False
    
    while searching and iter_count < 4:
        # Step 1: Generate search query
        yield {
            "type": "status", 
            "message": "Thinking...", 
            "step": 1, 
            "icon": "thinking"
        }
        
        if iter_count > 0:
            query = ai(
                "User question: " + prompt + " Your original query: " + query + " Failed, please make a new better suited query.",
                search_prompt, True, researcher
            )
        else:
            query = ai(
                "User question:" + prompt + " Memory: " + str(memory),
                search_prompt, True, researcher
            )
        
        if "<No searching needed>" in query:
            no_search = True
            break
        
        query = query.replace('"', "").strip()
        
        # Step 2: Search - send search event with query
        yield {
            "type": "status", 
            "message": f"Searching: {query[:60]}{'...' if len(query) > 60 else ''}", 
            "step": 2, 
            "icon": "searching"
        }
        
        # Send search event immediately with query (sources pending)
        yield {
            "type": "search",
            "query": query,
            "sources": [],
            "iteration": iter_count + 1,
            "status": "searching"
        }
        
        depth = 8
        scrape_result = grabbers.search_and_scrape(query, int(depth))
        sources = scrape_result.get('sources', [])
        full_text = scrape_result.get('full_text', '')
        
        search_data.append(full_text)
        
        # Create search entry for history
        search_entry = {
            "query": query,
            "sources": sources,
            "iteration": iter_count + 1
        }
        search_history.append(search_entry)
        
        # Send updated search event with sources
        yield {
            "type": "search",
            "query": query,
            "sources": sources,
            "iteration": iter_count + 1,
            "status": "complete"
        }
        
        # Step 3: Evaluate results
        yield {
            "type": "status", 
            "message": "Evaluating search results...", 
            "step": 3, 
            "icon": "evaluating"
        }
        
        good = ai(
            "User prompt:" + prompt + " Information: " + str(search_data),
            goodness_decided_prompt, True, general
        )
        
        if "<Fully answers user question>" in good:
            searching = False
        
        iter_count += 1
    
    # Step 4: Generate final response with streaming
    yield {
        "type": "status", 
        "message": "Generating response...", 
        "step": 4, 
        "icon": "generating"
    }
    
    if no_search:
        prompt_text = "User question: " + prompt + " Search data: " + str(search_data) + " No data has been given just answer the users question truthfully"
    else:
        prompt_text = "User question: " + prompt + " Search data: " + str(search_data)
    
    instructions = main_prompt + " Memory from previous conversation: " + str(memory)
    
    # Stream the final response
    for chunk in ai_stream(prompt_text, instructions, general):
        yield {"type": "content", "data": chunk}
    
    # Send done event with complete search history
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


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
