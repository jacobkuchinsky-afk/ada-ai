import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from urllib.parse import urlparse, unquote, urljoin
import re

# Try to use ddgs package (more reliable than HTML scraping)
try:
    from ddgs import DDGS
    USE_DDGS = True
except ImportError:
    USE_DDGS = False
    print("Warning: ddgs not installed, falling back to HTML scraping")


def create_session():
    """Create a requests session with connection pooling and retry logic.
    
    Creates a new session per function call (thread-safe) while still
    benefiting from connection reuse within that call.
    """
    session = requests.Session()
    
    # Configure retry strategy - reduced from 3 to 2 retries
    retry_strategy = Retry(
        total=2,
        backoff_factor=0.3,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    
    # Mount adapter with reduced connection pooling
    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=5,
        pool_maxsize=5
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
    
    Returns content limited to 8000 characters to prevent memory bloat.
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
            content = ' '.join(text_parts)
            return content[:8000]  # Limit to 8000 chars
    
    # Fallback: Extract all paragraphs and headings from body
    body = soup.find('body')
    if body:
        text_parts = []
        for element in body.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote']):
            text = element.get_text(strip=True)
            if len(text) > 30:  # Skip tiny fragments like menu items
                text_parts.append(text)
        
        if text_parts:
            content = ' '.join(text_parts)
            return content[:8000]
    
    # Last resort: get all text from body
    if body:
        text = body.get_text(separator=' ', strip=True)
        text = ' '.join(text.split())
        return text[:8000]
    
    # Absolute fallback
    text = soup.get_text(separator=' ', strip=True)
    return ' '.join(text.split())[:8000]


def extract_images(soup, page_url, max_images=5):
    """
    Extract relevant images from a page with smart filtering.
    
    Supports: .jpg, .jpeg, .png, .webp, .gif, .bmp, .svg, .avif
    
    Filters out:
    - Images smaller than 50x50px (icons)
    - Data URIs
    - Common icon/logo patterns
    - Social media sharing icons
    - Tracking pixels
    
    Args:
        soup: BeautifulSoup object of the page
        page_url: URL of the page (for resolving relative URLs)
        max_images: Maximum number of images to extract (default 5)
    
    Returns:
        List of dicts with 'url', 'alt', 'source_page' keys
    """
    images = []
    seen_urls = set()
    
    # Valid image extensions (case insensitive)
    valid_extensions = re.compile(r'\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?.*)?$', re.IGNORECASE)
    
    # Patterns to skip (icons, logos, social media, etc.)
    skip_patterns = [
        r'favicon', r'logo[-_]', r'[-_]logo', r'[-_]icon', r'icon[-_]',
        r'sprite', r'avatar',
        r'facebook', r'twitter', r'linkedin', r'instagram', r'pinterest',
        r'youtube', r'tiktok', r'whatsapp', r'telegram', r'reddit',
        r'share[-_]', r'[-_]share', r'social', r'button', r'badge', r'emoji',
        r'loading', r'spinner', r'placeholder', r'blank',
        r'pixel', r'tracking', r'analytics', r'banner[-_]?ad',
        r'1x1', r'spacer', r'transparent\.', r'arrow[-_]', r'chevron',
        r'close[-_]', r'[-_]close', r'menu[-_]', r'hamburger',
    ]
    skip_regex = re.compile('|'.join(skip_patterns), re.IGNORECASE)
    
    # Find all img tags
    for img in soup.find_all('img'):
        if len(images) >= max_images:
            break
            
        # Get src attribute (try multiple common attributes)
        src = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
        
        # Try srcset if no src found
        if not src and img.get('srcset'):
            srcset = img.get('srcset', '')
            src = srcset.split(',')[0].split()[0] if srcset else None
        
        if not src:
            continue
        
        # Clean up srcset format (remove size descriptors like "2x" or "800w")
        src = src.split()[0] if ' ' in src else src
        
        # Skip data URIs
        if src.startswith('data:'):
            continue
        
        # Convert relative URLs to absolute
        if not src.startswith(('http://', 'https://')):
            src = urljoin(page_url, src)
        
        # Skip if we've already seen this URL
        if src in seen_urls:
            continue
        seen_urls.add(src)
        
        # Check if URL has a valid image extension OR contains image indicators
        url_lower = src.lower()
        has_valid_extension = valid_extensions.search(url_lower)
        has_image_path = any(x in url_lower for x in ['/image', '/img', '/photo', '/picture', '/media', '/upload'])
        
        # Skip if no valid extension and no image path indicators (likely not an image)
        if not has_valid_extension and not has_image_path:
            # Allow through if it looks like a CDN image URL
            if not any(cdn in url_lower for cdn in ['cloudinary', 'imgix', 'cloudfront', 'akamai', 'fastly', 'cdn']):
                continue
        
        # Skip if URL matches skip patterns
        if skip_regex.search(src):
            continue
        
        # Check for small dimensions in attributes
        width = img.get('width', '')
        height = img.get('height', '')
        try:
            w = int(str(width).replace('px', '').strip()) if width else 999
            h = int(str(height).replace('px', '').strip()) if height else 999
            if w < 50 or h < 50:
                continue
        except (ValueError, TypeError):
            pass  # Can't parse dimensions, allow through
        
        # Check class/id for skip patterns
        img_class = ' '.join(img.get('class', []))
        img_id = img.get('id', '')
        if skip_regex.search(img_class) or skip_regex.search(img_id):
            continue
        
        # Get alt text
        alt = img.get('alt', '').strip()
        
        # Skip if alt text indicates it's an icon/logo
        if alt and skip_regex.search(alt):
            continue
        
        # Add to results
        images.append({
            'url': src,
            'alt': alt[:200] if alt else '',  # Limit alt text length
            'source_page': page_url
        })
    
    return images


def search_ddgs(query, num_results):
    """
    Search using duckduckgo-search package (reliable API method).
    
    Returns:
        tuple: (list of results, service_available bool)
    """
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=num_results))
            return [{'url': r['href'], 'title': r['title']} for r in results], True
    except Exception as e:
        print(f"DDGS search failed: {e}")
        return [], False


def search_html_fallback(query, num_results, session):
    """
    Fallback HTML scraping method (less reliable).
    
    Returns:
        tuple: (list of URLs, service_available bool)
    """
    try:
        search_url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
        response = session.get(search_url, timeout=8)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        links = []
        for a in soup.find_all('a', class_='result__a')[:num_results]:
            href = a.get('href', '')
            if 'uddg=' in href:
                url = unquote(href.split('uddg=')[1].split('&')[0])
                if url.startswith('http') and url not in links:
                    links.append(url)
        
        soup.decompose()
        return links, True
    except requests.exceptions.Timeout:
        print(f"Search timeout for query: {query}")
        return [], False
    except requests.exceptions.ConnectionError:
        print(f"Search connection error for query: {query}")
        return [], False
    except Exception as e:
        print(f"Search failed: {e}")
        return [], False


def search_and_scrape(search, result_number):
    """
    Takes a search query and number of results, returns text data and images from those websites.
    
    Parameters:
    search (str): The search query
    result_number (int): Number of websites to scrape
    
    Returns:
    dict: Contains 'sources' list, 'full_text' combined content, 'images' list, 'count', and 'service_available'
    """
    # Cap results at 5 to prevent memory issues
    result_number = min(result_number, 5)
    
    results = []
    sources = []
    all_images = []  # Collect images from all pages
    links = []
    service_available = True
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    # Step 1: Get search results using DDGS or fallback
    if USE_DDGS:
        search_results, service_available = search_ddgs(search, result_number)
        links = [r['url'] for r in search_results]
    else:
        # Fallback to HTML scraping (less reliable)
        with create_session() as session:
            session.headers.update(headers)
            links, service_available = search_html_fallback(search, result_number, session)
    
    # If search service is unavailable, return early with flag
    if not service_available:
        return {
            'sources': [],
            'full_text': 'Search service temporarily unavailable',
            'images': [],
            'count': 0,
            'service_available': False
        }
    
    # If no results found (but service was available)
    if not links:
        return {
            'sources': [],
            'full_text': 'No search results found for this query',
            'images': [],
            'count': 0,
            'service_available': True
        }
    
    print(f"Found {len(links)} links to scrape")
    
    # Step 2: Scrape each website
    with create_session() as session:
        session.headers.update(headers)
        
        for i, url in enumerate(links[:result_number]):
            print(f"Scraping {i+1}/{min(len(links), result_number)}: {url}")
            try:
                page_response = session.get(url, timeout=10, allow_redirects=True)
                page_response.raise_for_status()
                page_soup = BeautifulSoup(page_response.content, 'html.parser')
                
                # Get page title
                title_tag = page_soup.find('title')
                title = title_tag.get_text(strip=True) if title_tag else extract_domain(url)
                
                # Truncate long titles
                if len(title) > 80:
                    title = title[:77] + '...'
                
                # Use smart content extraction - gets clean content, removes junk
                text = extract_main_content(page_soup)
                
                # Extract images from the page (before decomposing soup)
                page_images = extract_images(page_soup, url, max_images=5)
                all_images.extend(page_images)
                
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
    
    # Build full text for AI processing
    full_text = ""
    for i, result in enumerate(results, 1):
        full_text += f"\n\n--- Source {i}: {result.get('title', 'Unknown')} ---\nURL: {result['url']}\n{result['text']}"
    
    return {
        'sources': sources,
        'full_text': full_text,
        'images': all_images,
        'count': len(sources),
        'service_available': True
    }
