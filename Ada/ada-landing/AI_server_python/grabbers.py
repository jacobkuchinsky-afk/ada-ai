import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from duckduckgo_search import DDGS

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
    links = []
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    try:
        # Use duckduckgo-search library - much more reliable than scraping HTML
        with DDGS() as ddgs:
            search_results = list(ddgs.text(search, max_results=result_number))
            
            for result in search_results:
                url = result.get('href') or result.get('link')
                title = result.get('title', '')
                snippet = result.get('body', '')
                
                if url and url.startswith('http'):
                    links.append({
                        'url': url,
                        'title': title,
                        'snippet': snippet
                    })
        
        print(f"Found {len(links)} links to scrape")
        
        # Scrape each website
        for i, link_info in enumerate(links[:result_number]):
            url = link_info['url']
            title = link_info['title']
            snippet = link_info['snippet']
            
            print(f"Scraping {i+1}/{result_number}: {url}")
            
            try:
                page_response = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
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
                for element in page_soup(['script', 'style', 'nav', 'footer', 'header', 'iframe', 'noscript']):
                    element.decompose()
                
                # Get text from body or main content
                body = page_soup.find('body')
                if body:
                    text = body.get_text(separator=' ', strip=True)
                else:
                    text = page_soup.get_text(separator=' ', strip=True)
                
                # Clean up whitespace
                text = ' '.join(text.split())
                
                # Limit text length to avoid token issues
                if len(text) > 15000:
                    text = text[:15000] + "... [truncated]"
                
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
                fallback_text = snippet if snippet else f'Error scraping: {str(e)}'
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
