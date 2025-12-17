import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from urllib.parse import unquote, urlparse


def create_session():
    """Create a requests session with connection pooling and retry logic.
    
    Creates a new session per function call (thread-safe) while still
    benefiting from connection reuse within that call.
    """
    session = requests.Session()
    
    # Configure retry strategy for transient failures
    retry_strategy = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    
    # Mount adapter with connection pooling
    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=10,
        pool_maxsize=10
    )
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    
    return session


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


def extract_main_content(soup):
    """
    Extract the main content from a page, ignoring navigation, ads, footers, etc.
    This gives the AI cleaner, more relevant data AND reduces memory usage.
    
    This IMPROVES quality by removing noise - the AI gets focused content
    instead of wading through menu items, cookie notices, and ads.
    """
    # Remove junk elements first
    for element in soup(['script', 'style', 'nav', 'footer', 'header', 'iframe', 
                         'noscript', 'aside', 'form', 'button', 'input', 'svg']):
        element.decompose()
    
    # Remove common junk by class/id patterns
    junk_patterns = ['nav', 'menu', 'sidebar', 'footer', 'header', 'cookie', 
                     'banner', 'ad-', 'ads-', 'advert', 'popup', 'modal', 'comment', 
                     'social', 'share', 'related', 'recommend', 'newsletter', 
                     'subscribe', 'signup', 'promo', 'sponsor', 'widget', 'toolbar']
    
    for pattern in junk_patterns:
        for element in soup.find_all(class_=lambda x: x and pattern in str(x).lower()):
            element.decompose()
        for element in soup.find_all(id=lambda x: x and pattern in str(x).lower()):
            element.decompose()
    
    # Try to find the main content area (in order of preference)
    content_selectors = [
        soup.find('article'),
        soup.find('main'),
        soup.find(class_='article'),
        soup.find(class_='content'),
        soup.find(class_='post'),
        soup.find(class_='entry'),
        soup.find(class_='article-body'),
        soup.find(class_='post-content'),
        soup.find(class_='entry-content'),
        soup.find(id='content'),
        soup.find(id='main'),
        soup.find(id='article'),
        soup.find('div', class_=lambda x: x and 'article' in str(x).lower() if x else False),
        soup.find('div', class_=lambda x: x and 'content' in str(x).lower() if x else False),
    ]
    
    # Use the first valid content area found
    main_content = None
    for selector in content_selectors:
        if selector:
            main_content = selector
            break
    
    # If we found a main content area, extract text from it
    if main_content:
        text_parts = []
        for element in main_content.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
                                               'li', 'td', 'th', 'blockquote', 'pre', 'code']):
            text = element.get_text(strip=True)
            # Only include substantial text (skip "Read more", "Click here", etc.)
            if len(text) > 30:
                text_parts.append(text)
        
        if text_parts:
            return ' '.join(text_parts)
    
    # Fallback: Extract all paragraphs and headings from body
    body = soup.find('body')
    if body:
        text_parts = []
        for element in body.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote']):
            text = element.get_text(strip=True)
            if len(text) > 30:  # Skip tiny fragments like menu items
                text_parts.append(text)
        
        if text_parts:
            return ' '.join(text_parts)
    
    # Last resort: get all text from body
    if body:
        text = body.get_text(separator=' ', strip=True)
        text = ' '.join(text.split())
        return text
    
    # Absolute fallback
    text = soup.get_text(separator=' ', strip=True)
    return ' '.join(text.split())


def search_and_scrape(search, result_number):
    """
    Takes a search query and number of results, returns text data from those websites.
    
    Parameters:
    search (str): The search query
    result_number (int): Number of websites to scrape
    
    Returns:
    dict: Contains 'sources' list with URL/title/domain and 'full_text' combined content
    """
    results = []
    sources = []
    
    # Use DuckDuckGo HTML search (no API key needed)
    search_url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(search)}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    # Create session for this search call - reused for all HTTP requests within this call
    # Using context manager ensures proper cleanup of connections
    with create_session() as session:
        session.headers.update(headers)
        
        try:
            # Get search results
            response = session.get(search_url, timeout=10)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract URLs from search results - get more than needed to ensure we have enough
            links = []
            
            # Try multiple selectors to find links
            result_links = soup.find_all('a', class_='result__a')
            if not result_links:
                result_links = soup.find_all('a', href=True)
            
            for result in result_links:
                href = result.get('href')
                if href:
                    # Extract actual URL from DuckDuckGo redirect
                    if 'uddg=' in href:
                        actual_url = href.split('uddg=')[1].split('&')[0]
                        actual_url = unquote(actual_url)
                        if actual_url.startswith('http') and actual_url not in links:
                            links.append(actual_url)
                    elif href.startswith('http') and 'duckduckgo.com' not in href and href not in links:
                        links.append(href)
                        
                # Stop when we have enough unique links
                if len(links) >= result_number:
                    break
            
            # Clean up search results soup immediately to free memory
            soup.decompose()
            del soup
            
            print(f"Found {len(links)} links to scrape")
            
            # Scrape each website up to result_number
            for i, url in enumerate(links[:result_number]):
                print(f"Scraping {i+1}/{result_number}: {url}")
                try:
                    page_response = session.get(url, timeout=15, allow_redirects=True)
                    page_response.raise_for_status()
                    page_soup = BeautifulSoup(page_response.content, 'html.parser')
                    
                    # Get page title
                    title_tag = page_soup.find('title')
                    title = title_tag.get_text(strip=True) if title_tag else extract_domain(url)
                    
                    # Truncate long titles
                    if len(title) > 80:
                        title = title[:77] + '...'
                    
                    # Use smart content extraction - gets clean content, removes junk
                    # This IMPROVES quality by giving AI focused data
                    text = extract_main_content(page_soup)
                    
                    # Add source info
                    sources.append({
                        'url': url,
                        'title': title,
                        'domain': extract_domain(url)
                    })
                    
                    results.append({
                        'url': url,
                        'title': title,
                        'text': text
                    })
                    
                    # Free memory immediately after processing each page
                    page_soup.decompose()
                    del page_soup, page_response
                    
                except Exception as e:
                    print(f"Error scraping {url}: {str(e)}")
                    # Still add the source even if scraping failed
                    sources.append({
                        'url': url,
                        'title': extract_domain(url),
                        'domain': extract_domain(url)
                    })
                    results.append({
                        'url': url,
                        'title': extract_domain(url),
                        'text': f'Error scraping: {str(e)}'
                    })
            
        except Exception as e:
            print(f"Search failed: {str(e)}")
            return {
                'sources': [],
                'full_text': f'Search failed: {str(e)}',
                'error': str(e),
                'count': 0
            }
    
    # Build full text for AI processing
    full_text = ""
    for i, result in enumerate(results, 1):
        full_text += f"\n\n--- Source {i}: {result.get('title', 'Unknown')} ---\nURL: {result['url']}\n{result['text']}"
    
    return {
        'sources': sources,
        'full_text': full_text,
        'count': len(sources)
    }
