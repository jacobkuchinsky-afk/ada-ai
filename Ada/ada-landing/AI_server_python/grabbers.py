import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, quote
import time
import random

def extract_domain(url):
    """Extract domain name from URL for display."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc
        # Remove www. prefix if present
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except:
        return url


def search_with_ddgs(search_query, max_results):
    """Search using ddgs library with retry logic."""
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
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    
    try:
        search_url = f"https://html.duckduckgo.com/html/?q={quote(search_query)}"
        response = requests.get(search_url, headers=headers, timeout=15)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        links = []
        result_links = soup.find_all('a', class_='result__a')
        
        for result in result_links[:max_results]:
            href = result.get('href', '')
            title = result.get_text(strip=True)
            
            # Extract actual URL from DuckDuckGo redirect
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
    """Fallback: Use Brave Search (no API key needed for basic search)."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    
    try:
        search_url = f"https://search.brave.com/search?q={quote(search_query)}"
        response = requests.get(search_url, headers=headers, timeout=15)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        links = []
        # Brave uses different selectors
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


def perform_search(search_query, max_results, retry_count=3):
    """Try multiple search methods with retries."""
    
    for attempt in range(retry_count):
        # Try DDGS first (most reliable when it works)
        links = search_with_ddgs(search_query, max_results)
        if links and len(links) > 0:
            return links
        
        # Small delay between attempts
        if attempt < retry_count - 1:
            time.sleep(random.uniform(0.5, 1.5))
    
    # Fallback to HTML scraping
    print("DDGS failed, trying HTML fallback...")
    links = search_with_duckduckgo_html(search_query, max_results)
    if links and len(links) > 0:
        return links
    
    # Last resort: Brave
    print("DuckDuckGo failed, trying Brave...")
    links = search_with_brave(search_query, max_results)
    if links and len(links) > 0:
        return links
    
    return []


def search_and_scrape(search, result_number):
    """
    Takes a search query and number of results, returns structured data.
    
    Parameters:
    search (str): The search query
    result_number (int): Number of websites to scrape
    
    Returns:
    dict: Contains 'sources' list with URL/title/domain and 'full_text' combined content
    """
    results = []
    sources = []
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    try:
        # Perform search with fallbacks
        links = perform_search(search, result_number)
        
        print(f"Found {len(links)} links to scrape")
        
        if not links:
            return {
                'sources': [],
                'full_text': 'No search results found. Please try a different query.',
                'error': 'No results',
                'count': 0
            }
        
        # Scrape each website
        for i, link_info in enumerate(links[:result_number]):
            url = link_info['url']
            title = link_info['title']
            snippet = link_info.get('snippet', '')
            
            print(f"Scraping {i+1}/{min(len(links), result_number)}: {url}")
            
            try:
                page_response = requests.get(url, headers=headers, timeout=12, allow_redirects=True)
                page_response.raise_for_status()
                page_soup = BeautifulSoup(page_response.content, 'html.parser')
                
                # Extract page title if not already provided
                if not title:
                    title_tag = page_soup.find('title')
                    title = title_tag.get_text(strip=True) if title_tag else extract_domain(url)
                
                # Truncate long titles
                if len(title) > 80:
                    title = title[:77] + '...'
                
                # Remove script and style elements
                for element in page_soup(['script', 'style', 'nav', 'footer', 'header', 'iframe', 'noscript', 'aside']):
                    element.decompose()
                
                # Try to get main content first
                main_content = page_soup.find('main') or page_soup.find('article') or page_soup.find('body')
                if main_content:
                    text = main_content.get_text(separator=' ', strip=True)
                else:
                    text = page_soup.get_text(separator=' ', strip=True)
                
                # Clean up whitespace
                text = ' '.join(text.split())
                
                # Limit text length to avoid token issues
                if len(text) > 12000:
                    text = text[:12000] + "... [truncated]"
                
                # Add to sources list
                source_info = {
                    'url': url,
                    'title': title,
                    'domain': extract_domain(url)
                }
                sources.append(source_info)
                
                results.append({
                    'url': url,
                    'title': title,
                    'text': text
                })
                
            except Exception as e:
                print(f"Error scraping {url}: {str(e)}")
                # Still add the source with the snippet from search results
                source_info = {
                    'url': url,
                    'title': title or extract_domain(url),
                    'domain': extract_domain(url)
                }
                sources.append(source_info)
                
                # Use snippet as fallback text
                fallback_text = snippet if snippet else f'Could not fetch page content'
                results.append({
                    'url': url,
                    'title': title or extract_domain(url),
                    'text': fallback_text
                })
        
    except Exception as e:
        print(f"Search failed: {str(e)}")
        return {
            'sources': [],
            'full_text': f'Search failed: {str(e)}',
            'error': str(e)
        }
    
    # Build full text for AI processing
    full_text = ""
    for i, result in enumerate(results, 1):
        full_text += f"\n\n--- Source {i}: {result['title']} ---\nURL: {result['url']}\n{result['text']}"
    
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
