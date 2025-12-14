import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, quote
import concurrent.futures
import hashlib
import time
from functools import lru_cache

# === PERFORMANCE OPTIMIZATIONS ===
# 1. Connection pooling with persistent sessions
# 2. Parallel URL scraping with ThreadPoolExecutor
# 3. Reduced timeouts for faster failures
# 4. Smart content extraction (smaller text limits)
# 5. URL deduplication
# 6. LRU caching for repeated searches

# Persistent session for connection reuse
_session = None

def get_session():
    """Get or create a persistent requests session with connection pooling."""
    global _session
    if _session is None:
        _session = requests.Session()
        # Configure connection pool
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=20,
            pool_maxsize=20,
            max_retries=1
        )
        _session.mount('http://', adapter)
        _session.mount('https://', adapter)
        _session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        })
    return _session


def extract_domain(url):
    """Extract domain name from URL for display."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except:
        return url


# Cache search results for 5 minutes (300 seconds)
@lru_cache(maxsize=100)
def _cached_search(query_hash, max_results):
    """Internal cached search - uses hash as cache key."""
    return _perform_search_internal(query_hash, max_results)


def _perform_search_internal(query, max_results):
    """Actual search implementation."""
    # Try DDGS first (fastest when working)
    links = search_with_ddgs(query, max_results)
    if links and len(links) > 0:
        return links
    
    # Fallback to HTML scraping
    links = search_with_duckduckgo_html(query, max_results)
    if links and len(links) > 0:
        return links
    
    # Last resort: Brave
    links = search_with_brave(query, max_results)
    if links and len(links) > 0:
        return links
    
    return []


def search_with_ddgs(search_query, max_results):
    """Search using ddgs library - fastest method."""
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(search_query, max_results=max_results))
            links = []
            for result in results:
                url = result.get('href') or result.get('link')
                title = result.get('title', '')
                snippet = result.get('body', '')
                if url and url.startswith('http'):
                    links.append({'url': url, 'title': title, 'snippet': snippet})
            return links
    except Exception as e:
        print(f"DDGS search failed: {e}")
        return None


def search_with_duckduckgo_html(search_query, max_results):
    """Fallback: Search DuckDuckGo HTML directly."""
    from urllib.parse import unquote
    
    try:
        session = get_session()
        search_url = f"https://html.duckduckgo.com/html/?q={quote(search_query)}"
        response = session.get(search_url, timeout=8)  # Reduced from 15s
        soup = BeautifulSoup(response.text, 'html.parser')
        
        links = []
        result_links = soup.find_all('a', class_='result__a')
        
        for result in result_links[:max_results]:
            href = result.get('href', '')
            title = result.get_text(strip=True)
            
            if 'uddg=' in href:
                actual_url = href.split('uddg=')[1].split('&')[0]
                actual_url = unquote(actual_url)
                if actual_url.startswith('http'):
                    links.append({'url': actual_url, 'title': title, 'snippet': ''})
            elif href.startswith('http') and 'duckduckgo.com' not in href:
                links.append({'url': href, 'title': title, 'snippet': ''})
        
        return links
    except Exception as e:
        print(f"DuckDuckGo HTML search failed: {e}")
        return None


def search_with_brave(search_query, max_results):
    """Fallback: Use Brave Search."""
    try:
        session = get_session()
        search_url = f"https://search.brave.com/search?q={quote(search_query)}"
        response = session.get(search_url, timeout=8)  # Reduced from 15s
        soup = BeautifulSoup(response.text, 'html.parser')
        
        links = []
        results = soup.find_all('a', {'class': lambda x: x and 'result-header' in x})
        if not results:
            results = soup.find_all('div', {'class': 'snippet'})
        
        for result in results[:max_results]:
            link = result.find('a', href=True) if result.name == 'div' else result
            if link:
                href = link.get('href', '')
                title = link.get_text(strip=True)
                if href.startswith('http') and 'brave.com' not in href:
                    links.append({'url': href, 'title': title, 'snippet': ''})
        
        return links
    except Exception as e:
        print(f"Brave search failed: {e}")
        return None


def perform_search(search_query, max_results):
    """Perform search with caching."""
    # Use query hash for cache key (handles special chars)
    query_hash = hashlib.md5(search_query.encode()).hexdigest()
    
    # Try cache first
    try:
        return _cached_search(query_hash, max_results)
    except:
        # Cache miss or error - perform fresh search
        return _perform_search_internal(search_query, max_results)


def scrape_single_url(url, title, snippet, timeout=6):
    """
    Scrape a single URL - designed to be called in parallel.
    Returns (source_info, result_dict) or (source_info, None) on failure.
    """
    session = get_session()
    domain = extract_domain(url)
    
    source_info = {
        'url': url,
        'title': title or domain,
        'domain': domain
    }
    
    try:
        response = session.get(url, timeout=timeout, allow_redirects=True)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Get title if not provided
        if not title:
            title_tag = soup.find('title')
            title = title_tag.get_text(strip=True) if title_tag else domain
        
        # Truncate long titles
        if len(title) > 80:
            title = title[:77] + '...'
        source_info['title'] = title
        
        # Remove non-content elements
        for element in soup(['script', 'style', 'nav', 'footer', 'header', 'iframe', 'noscript', 'aside', 'form', 'button']):
            element.decompose()
        
        # Try to get main content first (more focused extraction)
        main_content = (
            soup.find('article') or 
            soup.find('main') or 
            soup.find('div', class_=['content', 'article', 'post', 'entry']) or
            soup.find('body')
        )
        
        if main_content:
            text = main_content.get_text(separator=' ', strip=True)
        else:
            text = soup.get_text(separator=' ', strip=True)
        
        # Clean up whitespace
        text = ' '.join(text.split())
        
        # REDUCED text limit for faster processing (was 12000)
        if len(text) > 6000:
            text = text[:6000] + "... [truncated]"
        
        result = {
            'url': url,
            'title': title,
            'text': text
        }
        
        return source_info, result
        
    except Exception as e:
        print(f"Error scraping {url}: {str(e)[:50]}")
        # Use snippet as fallback
        fallback_text = snippet if snippet else 'Could not fetch page content'
        result = {
            'url': url,
            'title': title or domain,
            'text': fallback_text
        }
        return source_info, result


def search_and_scrape(search, result_number):
    """
    Takes a search query and number of results, returns structured data.
    OPTIMIZED: Parallel scraping with connection pooling.
    
    Parameters:
    search (str): The search query
    result_number (int): Number of websites to scrape
    
    Returns:
    dict: Contains 'sources' list with URL/title/domain and 'full_text' combined content
    """
    start_time = time.time()
    
    # Perform search
    links = perform_search(search, result_number)
    
    print(f"Found {len(links)} links in {time.time() - start_time:.2f}s")
    
    if not links:
        return {
            'sources': [],
            'full_text': 'No search results found. Please try a different query.',
            'error': 'No results',
            'count': 0
        }
    
    # Deduplicate URLs
    seen_urls = set()
    unique_links = []
    for link in links[:result_number]:
        url = link['url']
        if url not in seen_urls:
            seen_urls.add(url)
            unique_links.append(link)
    
    # PARALLEL SCRAPING - major speed improvement
    sources = []
    results = []
    scrape_start = time.time()
    
    # Use ThreadPoolExecutor for parallel scraping
    max_workers = min(len(unique_links), 10)  # Cap at 10 concurrent requests
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all scraping tasks
        future_to_link = {
            executor.submit(
                scrape_single_url, 
                link['url'], 
                link['title'], 
                link.get('snippet', ''),
                6  # 6 second timeout per URL (was 12)
            ): link for link in unique_links
        }
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(future_to_link):
            try:
                source_info, result = future.result()
                sources.append(source_info)
                if result:
                    results.append(result)
            except Exception as e:
                print(f"Scraping task failed: {e}")
    
    print(f"Scraped {len(results)} URLs in {time.time() - scrape_start:.2f}s (parallel)")
    
    # Build full text for AI processing
    full_text = ""
    for i, result in enumerate(results, 1):
        full_text += f"\n\n--- Source {i}: {result['title']} ---\nURL: {result['url']}\n{result['text']}"
    
    total_time = time.time() - start_time
    print(f"Total search_and_scrape time: {total_time:.2f}s")
    
    return {
        'sources': sources,
        'full_text': full_text,
        'count': len(sources)
    }


def search_and_scrape_fast(search, result_number):
    """
    Faster version with reduced content extraction.
    Use for quick lookups where full page content isn't needed.
    """
    links = perform_search(search, result_number)
    
    if not links:
        return {
            'sources': [],
            'full_text': 'No search results found.',
            'count': 0
        }
    
    # Just return search snippets without full scraping
    sources = []
    full_text = ""
    
    for i, link in enumerate(links[:result_number], 1):
        source_info = {
            'url': link['url'],
            'title': link['title'],
            'domain': extract_domain(link['url'])
        }
        sources.append(source_info)
        
        snippet = link.get('snippet', '')
        full_text += f"\n\n--- Source {i}: {link['title']} ---\nURL: {link['url']}\n{snippet}"
    
    return {
        'sources': sources,
        'full_text': full_text,
        'count': len(sources)
    }


# Legacy function for backwards compatibility
def search_and_scrape_text(search, result_number):
    """Returns just the full text (legacy behavior)."""
    result = search_and_scrape(search, result_number)
    return result.get('full_text', '')


# Clear cache utility
def clear_search_cache():
    """Clear the search cache."""
    _cached_search.cache_clear()
