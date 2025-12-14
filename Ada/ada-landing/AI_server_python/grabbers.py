import requests
from bs4 import BeautifulSoup
from urllib.parse import unquote

def search_and_scrape(search, result_number):
    """
    Takes a search query and number of results, returns text data from those websites.
    
    Parameters:
    search (str): The search query
    result_number (int): Number of websites to scrape
    
    Returns:
    list: List of dictionaries containing URL and text data for each website
    """
    results = []
    
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
                
                results.append({
                    'url': url,
                    'text': text
                })
            except Exception as e:
                print(f"Error scraping {url}: {str(e)}")
                results.append({
                    'url': url,
                    'text': f'Error scraping: {str(e)}'
                })
        
    except Exception as e:
        return [{'error': f'Search failed: {str(e)}'}]
    full_text = ""
    for i, result in enumerate(results, 1):
        full_text += f"URL: {result['url']}\n" + result['text']
    return full_text



