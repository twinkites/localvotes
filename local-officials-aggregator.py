#!/usr/bin/env python3
"""
Local Officials Data Aggregator
Scrapes school board member data by ZIP code using free sources only.

Pipeline:
  ZIP → Census TIGERweb → school district name + GEOID
      → district website (DuckDuckGo HTML search fallback)
      → board page (common URL pattern probing + homepage nav scan)
      → HTML parsing (tables → staff cards → heading/text fallback)
      → JSON output

Usage:
  pip install -r requirements-aggregator.txt
  python local-officials-aggregator.py --zip 90210
  python local-officials-aggregator.py --zip 90210 10001 60601 --output results.json
  python local-officials-aggregator.py --zip 90210 --delay 3 --verbose

  # For JS-rendered board pages (e.g. schools using React/Angular CMS):
  pip install playwright && playwright install chromium
  python local-officials-aggregator.py --zip 90210 --use-browser
"""

import argparse
import json
import logging
import re
import time
from dataclasses import dataclass, asdict
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# Optional Playwright for JS-rendered pages — only imported when --use-browser is set
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)-8s %(name)s: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger('aggregator')


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Official:
    name: str
    title: str
    jurisdiction: str
    level: str = 'School Board'
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    source_url: Optional[str] = None
    zip_code: str = ''


@dataclass
class DistrictInfo:
    leaid: str
    name: str
    city: str
    state: str
    phone: Optional[str]
    website: Optional[str]
    zip_code: str


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Board member title keywords used in parsing heuristics
BOARD_TITLES = frozenset({
    'president', 'vice president', 'vice-president',
    'clerk', 'secretary', 'treasurer',
    'chair', 'chairperson', 'chairman', 'chairwoman',
    'board member', 'board director', 'trustee', 'director',
    'member at large', 'at-large member',
    'area representative', 'zone representative',
    'governing board member',
})

TITLE_RE = re.compile(
    r'\b(' + '|'.join(re.escape(t) for t in BOARD_TITLES) + r')\b',
    re.IGNORECASE,
)

# Looks like a proper name: two or more capitalized words
NAME_RE = re.compile(r'\b([A-Z][a-zA-Z\'\-]+(?:\s+[A-Z][a-zA-Z\'\-]+)+)\b')

# Phone number pattern
PHONE_RE = re.compile(r'\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}')

# URL path suffixes to probe for a board page
BOARD_PAGE_SLUGS = [
    '/board',
    '/school-board',
    '/board-of-education',
    '/board-members',
    '/our-board',
    '/about/board',
    '/about/school-board',
    '/about/board-of-education',
    '/district/board',
    '/district/school-board',
    '/district/board-of-education',
    '/our-district/board',
    '/boe',
    '/governing-board',
    '/board-of-trustees',
    '/trustees',
]

# Domains to skip when picking a district site from search results
SKIP_DOMAINS = frozenset({
    'wikipedia.org', 'facebook.com', 'twitter.com', 'instagram.com',
    'niche.com', 'greatschools.org', 'publicschoolreview.com',
    'schooldigger.com', 'usnews.com', 'yelp.com', 'linkedin.com',
    'youtube.com', 'reddit.com', 'nextdoor.com',
})

# Domains that are likely legitimate district/gov sites
GOOD_TLDS = ('.org', '.net', '.edu', '.us', '.gov', '.k12')


# ---------------------------------------------------------------------------
# HTTP session factory
# ---------------------------------------------------------------------------

def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/120.0.0.0 Safari/537.36'
        ),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    return s


# ---------------------------------------------------------------------------
# Optional browser-based page fetcher (Playwright)
# ---------------------------------------------------------------------------

class BrowserFetcher:
    """
    Fetches a fully rendered page using a headless Chromium browser via Playwright.
    Waits for the DOM to stabilise before returning HTML so that JS-rendered content
    (e.g. staff grids populated by React/Angular) is present in the response.

    Requires:
      pip install playwright
      playwright install chromium
    """

    WAIT_SELECTOR_TIMEOUT = 8_000   # ms to wait for a known content selector
    NETWORK_IDLE_TIMEOUT  = 15_000  # ms total page-load timeout

    def __init__(self):
        if not PLAYWRIGHT_AVAILABLE:
            raise RuntimeError(
                'Playwright is not installed. Run:\n'
                '  pip install playwright\n'
                '  playwright install chromium'
            )
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        logger.info('Headless browser started (Chromium via Playwright)')

    def fetch(self, url: str) -> str:
        """Return the fully-rendered HTML of *url* as a string."""
        page = self._browser.new_page()
        try:
            page.goto(url, wait_until='domcontentloaded', timeout=self.NETWORK_IDLE_TIMEOUT)
            # Wait for network to quiet down so lazy-loaded content renders
            try:
                page.wait_for_load_state('networkidle', timeout=self.NETWORK_IDLE_TIMEOUT)
            except PlaywrightTimeoutError:
                pass  # Best-effort — take whatever rendered
            return page.content()
        finally:
            page.close()

    def close(self):
        try:
            self._browser.close()
            self._pw.stop()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# District lookup — two-step: ZIP → lat/lng → school district via Census TIGERweb
# ---------------------------------------------------------------------------

class DistrictLookup:
    """
    Step 1: api.zippopotam.us  →  lat, lng, city, state  (free, no key)
    Step 2: Census TIGERweb    →  school district name + GEOID  (free, no key)

    TIGERweb layers used (tigerWMS_Current MapServer):
      14 = Unified School Districts   (covers K-12, most common)
      16 = Secondary School Districts
      18 = Elementary School Districts
    """

    ZIPPOPOTAM = 'https://api.zippopotam.us/us/{zip}'
    TIGERWEB   = (
        'https://tigerweb.geo.census.gov/arcgis/rest/services/'
        'TIGERweb/tigerWMS_Current/MapServer/{layer}/query'
    )
    LAYERS = [14, 16, 18]  # try in order; first match wins

    def __init__(self, session: requests.Session):
        self.session = session

    def get_districts_by_zip(self, zip_code: str) -> list[DistrictInfo]:
        # --- Step 1: ZIP → coordinates ---
        try:
            r = self.session.get(self.ZIPPOPOTAM.format(zip=zip_code), timeout=10)
            r.raise_for_status()
            place = r.json()['places'][0]
            lat  = float(place['latitude'])
            lng  = float(place['longitude'])
            city = place['place name']
            state = place['state abbreviation'].upper()
        except Exception as e:
            logger.error(f'ZIP lookup failed for {zip_code}: {e}')
            return []

        # --- Step 2: coordinates → school district ---
        for layer in self.LAYERS:
            try:
                r = self.session.get(
                    self.TIGERWEB.format(layer=layer),
                    params={
                        'geometry': f'{lng},{lat}',
                        'geometryType': 'esriGeometryPoint',
                        'inSR': '4326',
                        'spatialRel': 'esriSpatialRelIntersects',
                        'outFields': 'NAME,GEOID',
                        'returnGeometry': 'false',
                        'f': 'json',
                    },
                    timeout=12,
                )
                r.raise_for_status()
                features = r.json().get('features', [])
                if not features:
                    continue

                districts = []
                for feat in features:
                    attr = feat['attributes']
                    districts.append(DistrictInfo(
                        leaid=attr.get('GEOID', ''),
                        name=attr.get('NAME', '').strip(),
                        city=city,
                        state=state,
                        phone=None,
                        website=None,
                        zip_code=zip_code,
                    ))
                logger.info(f'TIGERweb layer {layer}: {len(districts)} district(s) for ZIP {zip_code}')
                return districts

            except Exception as e:
                logger.warning(f'TIGERweb layer {layer} failed: {e}')
                continue

        logger.warning(f'No school district found for ZIP {zip_code} via TIGERweb')
        return []


# ---------------------------------------------------------------------------
# District website finder
# ---------------------------------------------------------------------------

class WebsiteFinder:
    """
    Returns the root URL of a school district's official website.
    Uses the NCES-provided URL if present; falls back to a
    DuckDuckGo HTML search (no API key required).
    """

    DDG_URL = 'https://html.duckduckgo.com/html/'

    def __init__(self, session: requests.Session, delay: float):
        self.session = session
        self.delay = delay

    def find(self, district: DistrictInfo) -> Optional[str]:
        if district.website:
            parsed = urlparse(district.website)
            return f'{parsed.scheme}://{parsed.netloc}'.rstrip('/')

        query = f'"{district.name}" {district.city} {district.state} school district official site'
        logger.info(f'Searching DDG for district site: {query}')
        time.sleep(self.delay)

        try:
            r = self.session.post(
                self.DDG_URL,
                data={'q': query},
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=20,
            )
            r.raise_for_status()
            soup = BeautifulSoup(r.text, 'lxml')

            for a in soup.select('a.result__a'):
                href = a.get('href', '')
                try:
                    parsed = urlparse(href)
                    host = parsed.netloc.lower()
                except Exception:
                    continue

                if any(bad in host for bad in SKIP_DOMAINS):
                    continue
                if any(host.endswith(tld) for tld in GOOD_TLDS):
                    site = f'{parsed.scheme}://{parsed.netloc}'
                    logger.info(f'DDG → district site: {site}')
                    return site

        except Exception as e:
            logger.warning(f'DDG website search failed for {district.name}: {e}')

        return None


# ---------------------------------------------------------------------------
# Board page finder
# ---------------------------------------------------------------------------

class BoardPageFinder:
    """
    Given a district's root URL, finds the URL of their board members page
    by probing common slug patterns and falling back to homepage nav parsing.
    """

    def __init__(self, session: requests.Session, delay: float):
        self.session = session
        self.delay = delay

    def find(self, base_url: str) -> Optional[str]:
        # Probe common board page slugs
        for slug in BOARD_PAGE_SLUGS:
            url = base_url.rstrip('/') + slug
            time.sleep(self.delay * 0.25)  # lighter delay for probing
            try:
                r = self.session.get(url, timeout=10, allow_redirects=True)
                if r.status_code == 200 and len(r.text) > 1000:
                    # Quick sanity check: page should mention board-related words
                    snippet = r.text[:5000].lower()
                    if any(kw in snippet for kw in ('board', 'trustee', 'member', 'president')):
                        logger.info(f'Board page found via slug: {r.url}')
                        return r.url
            except Exception:
                continue

        # Fallback: scan homepage navigation for a board link
        return self._find_in_nav(base_url)

    def _find_in_nav(self, base_url: str) -> Optional[str]:
        logger.info(f'Scanning homepage nav for board link: {base_url}')
        try:
            time.sleep(self.delay * 0.5)
            r = self.session.get(base_url, timeout=12)
            if r.status_code != 200:
                return None
            soup = BeautifulSoup(r.text, 'lxml')
            board_kws = ('board of education', 'school board', 'board members', 'trustees', 'governing board')
            for a in soup.find_all('a', href=True):
                text = a.get_text(strip=True).lower()
                if any(kw in text for kw in board_kws):
                    href = a['href']
                    full = href if href.startswith('http') else urljoin(base_url, href)
                    logger.info(f'Board page found via nav: {full}')
                    return full
        except Exception as e:
            logger.warning(f'Nav scan failed on {base_url}: {e}')
        return None


# ---------------------------------------------------------------------------
# Board page parser
# ---------------------------------------------------------------------------

class BoardPageParser:
    """
    Extracts board member names and titles from a board page.

    Three strategies in priority order:
      1. Tables with header rows containing name/title columns
      2. Staff/member card elements (div, article, li) with board-title keywords
      3. Plain-text extraction near board-related headings
    """

    def parse(self, html: str, source_url: str, district: DistrictInfo) -> list[Official]:
        soup = BeautifulSoup(html, 'lxml')
        self._strip_noise(soup)

        officials = (
            self._parse_tables(soup, district, source_url)
            or self._parse_cards(soup, district, source_url)
            or self._parse_text_blocks(soup, district, source_url)
        )

        # Deduplicate by lowercased name
        seen: set[str] = set()
        unique = []
        for o in officials:
            key = o.name.lower().strip()
            if key and key not in seen:
                seen.add(key)
                unique.append(o)

        logger.info(f'Parsed {len(unique)} member(s) from {source_url}')
        return unique

    # ------------------------------------------------------------------
    # Noise removal
    # ------------------------------------------------------------------

    def _strip_noise(self, soup: BeautifulSoup):
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']):
            tag.decompose()

    # ------------------------------------------------------------------
    # Strategy 1: HTML tables
    # ------------------------------------------------------------------

    def _parse_tables(self, soup: BeautifulSoup, district: DistrictInfo, url: str) -> list[Official]:
        officials = []
        for table in soup.find_all('table'):
            headers = [th.get_text(' ', strip=True).lower() for th in table.find_all('th')]
            if not headers:
                # Try first row as header
                first_row = table.find('tr')
                if first_row:
                    headers = [td.get_text(' ', strip=True).lower() for td in first_row.find_all(['td', 'th'])]

            header_str = ' '.join(headers)
            if not any(kw in header_str for kw in ('name', 'member', 'trustee', 'director', 'position', 'title')):
                continue

            name_col = next((i for i, h in enumerate(headers) if 'name' in h), 0)
            title_col = next((i for i, h in enumerate(headers)
                              if any(k in h for k in ('title', 'position', 'role', 'office', 'area'))), None)
            email_col = next((i for i, h in enumerate(headers) if 'email' in h or 'contact' in h), None)

            for row in table.find_all('tr')[1:]:
                cells = row.find_all(['td', 'th'])
                if len(cells) <= name_col:
                    continue

                name = self._clean_name(cells[name_col].get_text(' ', strip=True))
                if not name:
                    continue

                title = 'Board Member'
                if title_col is not None and title_col < len(cells):
                    title = cells[title_col].get_text(' ', strip=True) or 'Board Member'

                email = None
                if email_col is not None and email_col < len(cells):
                    mailto = cells[email_col].find('a', href=re.compile(r'^mailto:', re.I))
                    if mailto:
                        email = mailto['href'].replace('mailto:', '').strip()
                    else:
                        raw = cells[email_col].get_text(strip=True)
                        if '@' in raw:
                            email = raw

                officials.append(Official(
                    name=name, title=title[:80], jurisdiction=district.name,
                    contact_email=email, source_url=url, zip_code=district.zip_code,
                ))

        return officials

    # ------------------------------------------------------------------
    # Strategy 2: Staff / member cards
    # ------------------------------------------------------------------

    def _parse_cards(self, soup: BeautifulSoup, district: DistrictInfo, url: str) -> list[Official]:
        officials = []
        card_class_re = re.compile(
            r'\b(staff|member|person|team|board|trustee|bio|card|profile|people)\b', re.I
        )

        for card in soup.find_all(['div', 'article', 'li', 'section'],
                                   class_=card_class_re):
            text = card.get_text(' ', strip=True)
            # Card must mention a board title somewhere
            if not TITLE_RE.search(text):
                continue

            # Name: prefer the most prominent heading or bold element
            name_tag = card.find(['h1', 'h2', 'h3', 'h4', 'strong', 'b'])
            if not name_tag:
                continue
            name = self._clean_name(name_tag.get_text(' ', strip=True))
            if not name:
                continue

            # Title: first short text element after the name tag
            title = 'Board Member'
            for candidate in name_tag.find_all_next(['p', 'span', 'em', 'small', 'div'], limit=5):
                t = candidate.get_text(' ', strip=True)
                if 0 < len(t) <= 80 and TITLE_RE.search(t):
                    title = t
                    break

            # Email via mailto link
            mailto = card.find('a', href=re.compile(r'^mailto:', re.I))
            email = mailto['href'].replace('mailto:', '').strip() if mailto else None

            # Phone
            phone_m = PHONE_RE.search(text)
            phone = phone_m.group() if phone_m else None

            officials.append(Official(
                name=name, title=title, jurisdiction=district.name,
                contact_email=email, contact_phone=phone,
                source_url=url, zip_code=district.zip_code,
            ))

        return officials

    # ------------------------------------------------------------------
    # Strategy 3: Text blocks near board headings
    # ------------------------------------------------------------------

    def _parse_text_blocks(self, soup: BeautifulSoup, district: DistrictInfo, url: str) -> list[Official]:
        officials = []

        # Find the first heading that mentions "board"
        heading = None
        for tag in soup.find_all(['h1', 'h2', 'h3', 'h4']):
            txt = tag.get_text(strip=True).lower()
            if 'board' in txt or 'trustee' in txt:
                heading = tag
                break
        if not heading:
            return officials

        # Gather text from siblings until the next heading of equal/higher level
        heading_level = int(heading.name[1])
        lines = []
        for sib in heading.find_next_siblings():
            if sib.name and sib.name[0] == 'h' and sib.name[1:].isdigit():
                if int(sib.name[1]) <= heading_level:
                    break
            lines.append(sib.get_text(' ', strip=True))

        block = ' '.join(lines)

        # Find title-adjacent name patterns: "Name, Title" or "Title: Name"
        # Pattern: "First Last, Board Member" or "Board President: First Last"
        for match in re.finditer(
            r'([A-Z][a-zA-Z\'\-]+(?:\s+[A-Z][a-zA-Z\'\-]+)+)\s*[,–\-]\s*(' + TITLE_RE.pattern + r')',
            block,
        ):
            name = self._clean_name(match.group(1))
            title = match.group(2).strip().title()
            if name:
                officials.append(Official(
                    name=name, title=title, jurisdiction=district.name,
                    source_url=url, zip_code=district.zip_code,
                ))

        # Fallback within fallback: just extract all names if block is short
        if not officials and len(block) < 3000:
            for match in NAME_RE.finditer(block):
                name = self._clean_name(match.group(1))
                if name:
                    officials.append(Official(
                        name=name, title='Board Member', jurisdiction=district.name,
                        source_url=url, zip_code=district.zip_code,
                    ))

        return officials

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _clean_name(self, raw: str) -> Optional[str]:
        """Return a cleaned name string, or None if it doesn't look like a person's name."""
        name = raw.strip()
        # Remove common noise prefixes
        name = re.sub(r'^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Rev\.?|Hon\.?)\s+', '', name, flags=re.I)
        name = re.sub(r'\s+', ' ', name).strip()
        # Must match name pattern and be reasonable length
        if not NAME_RE.search(name):
            return None
        if len(name) < 4 or len(name) > 60:
            return None
        # Reject if it looks like a title or sentence rather than a name
        if any(kw in name.lower() for kw in ('board', 'school', 'district', 'education', 'committee')):
            return None
        return name


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class OfficialsAggregator:
    def __init__(self, rate_limit_delay: float = 2.0, use_browser: bool = False):
        self.delay = rate_limit_delay
        self.session = make_session()
        self.nces = DistrictLookup(self.session)
        self.website_finder = WebsiteFinder(self.session, rate_limit_delay)
        self.board_finder = BoardPageFinder(self.session, rate_limit_delay)
        self.parser = BoardPageParser()
        self.browser: Optional[BrowserFetcher] = BrowserFetcher() if use_browser else None

    def process_zip(self, zip_code: str) -> dict:
        result = {
            'zip_code': zip_code,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'districts': [],
            'officials': [],
            'not_found': [],
        }

        districts = self.nces.get_districts_by_zip(zip_code)
        if not districts:
            logger.warning(f'No districts found for ZIP {zip_code}')
            return result

        for district in districts:
            logger.info(f'Processing: {district.name} ({district.city}, {district.state})')
            district_entry = {
                'name': district.name,
                'leaid': district.leaid,
                'city': district.city,
                'state': district.state,
                'phone': district.phone,
            }

            time.sleep(self.delay)
            website = self.website_finder.find(district)
            if not website:
                logger.warning(f'No website found for {district.name}')
                result['not_found'].append({
                    'district': district.name,
                    'reason': 'district website not found — manual search needed',
                })
                result['districts'].append(district_entry)
                continue

            district_entry['website'] = website
            time.sleep(self.delay)
            board_url = self.board_finder.find(website)

            if not board_url:
                logger.warning(f'No board page found at {website}')
                result['not_found'].append({
                    'district': district.name,
                    'website': website,
                    'reason': 'board page not found — check site manually',
                    'manual_search': f'https://duckduckgo.com/?q=site:{urlparse(website).netloc}+board',
                })
                result['districts'].append(district_entry)
                continue

            district_entry['board_page'] = board_url
            time.sleep(self.delay)

            try:
                html = self._fetch_page(board_url)
                officials = self.parser.parse(html, board_url, district)

                # If static HTML returned nothing and a browser is available,
                # retry with JS rendering before giving up.
                if not officials and self.browser is None:
                    logger.info(
                        f'0 members parsed from static HTML for {district.name}. '
                        f'Re-run with --use-browser if the board page is JS-rendered.'
                    )
                elif not officials and self.browser is not None:
                    logger.info(f'Retrying {board_url} with headless browser…')
                    html = self.browser.fetch(board_url)
                    officials = self.parser.parse(html, board_url, district)

                result['officials'].extend([asdict(o) for o in officials])
                district_entry['members_found'] = len(officials)
                logger.info(f'✓ {district.name}: {len(officials)} member(s)')
            except Exception as e:
                logger.error(f'Failed to parse {board_url}: {e}')
                district_entry['members_found'] = 0
                result['not_found'].append({
                    'district': district.name,
                    'board_page': board_url,
                    'reason': f'parse error: {e}',
                })

            result['districts'].append(district_entry)

        return result

    def _fetch_page(self, url: str) -> str:
        """Fetch a URL with the requests session (static HTML)."""
        r = self.session.get(url, timeout=15)
        r.raise_for_status()
        return r.text

    def close(self):
        if self.browser:
            self.browser.close()

    def process_zips(self, zip_codes: list[str]) -> list[dict]:
        results = []
        for i, zip_code in enumerate(zip_codes):
            logger.info(f'━━━ ZIP {zip_code}  ({i + 1}/{len(zip_codes)}) ━━━')
            results.append(self.process_zip(zip_code))
            if i < len(zip_codes) - 1:
                time.sleep(self.delay)
        return results

    def save(self, results: list[dict], path: str):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, default=str, ensure_ascii=False)
        total = sum(len(r['officials']) for r in results)
        not_found = sum(len(r['not_found']) for r in results)
        logger.info(f'Saved {total} official(s), {not_found} district(s) need manual follow-up → {path}')


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description='Scrape school board member data by ZIP code (free sources only).',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python local-officials-aggregator.py --zip 90210
  python local-officials-aggregator.py --zip 90210 10001 60601 --output results.json
  python local-officials-aggregator.py --zip 90210 --delay 3 --verbose
        """,
    )
    ap.add_argument('--zip', nargs='+', required=True, metavar='ZIPCODE',
                    help='One or more 5-digit ZIP codes to process')
    ap.add_argument('--output', default='officials_output.json',
                    help='Output JSON file path (default: officials_output.json)')
    ap.add_argument('--delay', type=float, default=2.0,
                    help='Seconds between requests — be polite (default: 2.0)')
    ap.add_argument('--verbose', action='store_true',
                    help='Enable debug-level logging')
    ap.add_argument('--use-browser', action='store_true',
                    help=(
                        'Use a headless Chromium browser (via Playwright) to render '
                        'JS-heavy board pages. Requires: pip install playwright && '
                        'playwright install chromium'
                    ))
    args = ap.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    bad_zips = [z for z in args.zip if not re.match(r'^\d{5}$', z)]
    if bad_zips:
        ap.error(f'Invalid ZIP code(s): {", ".join(bad_zips)}')

    if args.use_browser and not PLAYWRIGHT_AVAILABLE:
        ap.error(
            '--use-browser requires Playwright:\n'
            '  pip install playwright\n'
            '  playwright install chromium'
        )

    aggregator = OfficialsAggregator(
        rate_limit_delay=args.delay,
        use_browser=args.use_browser,
    )
    try:
        results = aggregator.process_zips(args.zip)
        aggregator.save(results, args.output)
    finally:
        aggregator.close()

    # Human-readable summary
    total_officials = sum(len(r['officials']) for r in results)
    total_not_found = sum(len(r['not_found']) for r in results)
    print(f'\n{"─" * 50}')
    print(f'  ZIPs processed : {len(results)}')
    print(f'  Officials found: {total_officials}')
    print(f'  Need follow-up : {total_not_found} district(s)')
    print(f'  Output         : {args.output}')
    print(f'{"─" * 50}')

    if total_not_found:
        print('\nDistricts needing manual follow-up:')
        for r in results:
            for nf in r['not_found']:
                print(f"  [{r['zip_code']}] {nf['district']}: {nf['reason']}")
                if 'manual_search' in nf:
                    print(f"         → {nf['manual_search']}")


if __name__ == '__main__':
    main()
