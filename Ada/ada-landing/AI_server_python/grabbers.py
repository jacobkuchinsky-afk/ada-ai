import requests
from bs4 import BeautifulSoup
from urllib.parse import unquote, urlparse

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
    
    # Use DuckDuckGo HTML search (no API key needed)
    search_url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(search)}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        # Get search results
        response = requests.get(search_url, headers=headers, timeout=10)
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
        
        print(f"Found {len(links)} links to scrape")
        
        # Scrape each website up to result_number
        for i, url in enumerate(links[:result_number]):
            print(f"Scraping {i+1}/{result_number}: {url}")
            try:
                page_response = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
                page_response.raise_for_status()
                page_soup = BeautifulSoup(page_response.content, 'html.parser')
                
                # Extract page title
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
                source_info = {
                    'url': url,
                    'title': extract_domain(url),
                    'domain': extract_domain(url),
                    'error': str(e)
                }
                sources.append(source_info)
                results.append({
                    'url': url,
                    'title': extract_domain(url),
                    'text': f'Error scraping: {str(e)}'
                })
        
    except Exception as e:
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
