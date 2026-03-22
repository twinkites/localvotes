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

  # Scrape all school boards for a state (50 states supported):
  python local-officials-aggregator.py --state MA
  python local-officials-aggregator.py --state NY --delay 3
  python local-officials-aggregator.py --state TX --max-districts 10  # test run

  # For JS-rendered board pages (e.g. schools using React/Angular CMS):
  pip install playwright && playwright install chromium
  python local-officials-aggregator.py --state CA --use-browser

  # Scrape city/town council members:
  python local-officials-aggregator.py --council --state MA
  python local-officials-aggregator.py --council --state MA --max-cities 5  # test run
  python local-officials-aggregator.py --new-england                        # all 6 NE states
  python local-officials-aggregator.py --new-england --delay 8              # slower/polite
"""

import argparse
import json
import logging
import os
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
    'youtube.com', 'reddit.com', 'nextdoor.com', 'publicschoolsk12.com',
})

# Domains that are likely legitimate district/gov sites
GOOD_TLDS = ('.org', '.net', '.edu', '.us', '.gov', '.k12')


# ---------------------------------------------------------------------------
# DDG search helper — shared by WebsiteFinder and SchoolFallback
# ---------------------------------------------------------------------------

DDG_URL         = 'https://html.duckduckgo.com/html/'
DDG_BACKOFF_SEC = 120  # seconds to wait after a 202 rate-limit response
DDG_MAX_RETRIES = 3


def ddg_search(session: requests.Session, query: str, delay: float) -> Optional['BeautifulSoup']:
    """
    POST a query to DDG's HTML interface and return a BeautifulSoup of the results.
    Handles 202 rate-limit responses with exponential back-off.
    Returns None if all retries are exhausted or an error occurs.
    """
    for attempt in range(DDG_MAX_RETRIES):
        if attempt > 0:
            wait = DDG_BACKOFF_SEC * attempt
            logger.warning(f'DDG rate-limited — backing off {wait}s (attempt {attempt + 1}/{DDG_MAX_RETRIES})')
            time.sleep(wait)
        else:
            time.sleep(delay)
        try:
            r = session.post(
                DDG_URL,
                data={'q': query},
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=20,
            )
            if r.status_code == 202:
                continue   # rate-limited — retry after back-off
            r.raise_for_status()
            return BeautifulSoup(r.text, 'lxml')
        except Exception as e:
            logger.warning(f'DDG request failed: {e}')
            return None
    logger.warning(f'DDG rate-limit unresolved after {DDG_MAX_RETRIES} attempts — skipping: {query}')
    return None


# ---------------------------------------------------------------------------
# State configuration: FIPS codes, bounding boxes, and terminology overrides
# ---------------------------------------------------------------------------

# Maps state abbreviation → {fips, bbox, extra_titles, extra_slugs, nav_keywords}
# bbox format: 'minLon,minLat,maxLon,maxLat' (WGS-84)
STATE_CONFIG: dict[str, dict] = {
    'AL': {'fips': '01', 'bbox': '-88.4731,30.2245,-84.8882,35.0081'},
    'AK': {'fips': '02', 'bbox': '-179.1506,51.2097,-129.9824,71.5388'},
    'AZ': {'fips': '04', 'bbox': '-114.8183,31.3322,-109.0452,37.0042'},
    'AR': {'fips': '05', 'bbox': '-94.6178,33.0041,-89.6442,36.4997'},
    'CA': {'fips': '06', 'bbox': '-124.4096,32.5343,-114.1312,42.0095'},
    'CO': {'fips': '08', 'bbox': '-109.0603,36.9931,-102.0424,41.0034'},
    'CT': {'fips': '09', 'bbox': '-73.7278,40.9870,-71.7870,42.0505'},
    'DE': {'fips': '10', 'bbox': '-75.7890,38.4510,-75.0480,39.8390'},
    'DC': {'fips': '11', 'bbox': '-77.1198,38.7916,-76.9094,38.9955'},
    'FL': {'fips': '12', 'bbox': '-87.6349,24.3963,-79.9743,31.0007'},
    'GA': {'fips': '13', 'bbox': '-85.6052,30.3575,-80.7514,35.0008'},
    'HI': {'fips': '15', 'bbox': '-160.2471,18.9106,-154.8069,22.2356'},
    'ID': {'fips': '16', 'bbox': '-117.2431,41.9880,-111.0435,49.0011'},
    'IL': {'fips': '17', 'bbox': '-91.5131,36.9703,-87.0199,42.5083'},
    'IN': {'fips': '18', 'bbox': '-88.0998,37.7717,-84.7845,41.7607'},
    'IA': {'fips': '19', 'bbox': '-96.6397,40.3754,-90.1401,43.5012'},
    'KS': {'fips': '20', 'bbox': '-102.0517,36.9931,-94.5883,40.0031'},
    'KY': {'fips': '21', 'bbox': '-89.5715,36.4973,-81.9647,39.1474'},
    'LA': {'fips': '22', 'bbox': '-94.0432,28.9271,-88.7578,33.0191'},
    'ME': {'fips': '23', 'bbox': '-71.0837,42.9774,-66.9499,47.4597'},
    'MD': {'fips': '24', 'bbox': '-79.4877,37.9116,-74.9860,39.7228'},
    'MA': {
        'fips': '25', 'bbox': '-73.5087,41.2373,-69.9281,42.8867',
        'extra_titles': frozenset({
            'school committee', 'committee member',
            'vice chair', 'vice-chair', 'chair emeritus',
            'student representative', 'student member',
        }),
        'extra_slugs': [
            '/school-committee', '/school-committee-members',
            '/about/school-committee', '/about-us/school-committee',
            '/district/school-committee', '/our-district/school-committee',
            '/community/school-committee', '/school-committee/members',
            '/school-committee/meet-the-committee', '/sc',
        ],
        'nav_keywords': (
            'school committee', 'committee members', 'meet the committee',
            'board of education', 'school board', 'board members', 'trustees',
        ),
    },
    'MI': {'fips': '26', 'bbox': '-90.4182,41.6961,-82.1220,48.3063'},
    'MN': {'fips': '27', 'bbox': '-97.2390,43.4994,-89.4898,49.3845'},
    'MS': {'fips': '28', 'bbox': '-91.6550,30.1730,-88.0983,35.0081'},
    'MO': {'fips': '29', 'bbox': '-95.7748,35.9956,-89.0990,40.6135'},
    'MT': {'fips': '30', 'bbox': '-116.0491,44.3582,-104.0400,49.0011'},
    'NE': {'fips': '31', 'bbox': '-104.0533,39.9999,-95.3083,43.0012'},
    'NV': {'fips': '32', 'bbox': '-120.0059,35.0018,-114.0418,42.0002'},
    'NH': {'fips': '33', 'bbox': '-72.5573,42.6970,-70.6101,45.3058'},
    'NJ': {'fips': '34', 'bbox': '-75.5596,38.9285,-73.8948,41.3574'},
    'NM': {'fips': '35', 'bbox': '-109.0502,31.3322,-103.0022,37.0001'},
    'NY': {'fips': '36', 'bbox': '-79.7624,40.4960,-71.8562,45.0158'},
    'NC': {'fips': '37', 'bbox': '-84.3219,33.8428,-75.4601,36.5881'},
    'ND': {'fips': '38', 'bbox': '-104.0489,45.9350,-96.5543,49.0011'},
    'OH': {'fips': '39', 'bbox': '-84.8203,38.4033,-80.5189,41.9773'},
    'OK': {'fips': '40', 'bbox': '-103.0025,33.6153,-94.4307,37.0021'},
    'OR': {'fips': '41', 'bbox': '-124.5663,41.9917,-116.4635,46.2323'},
    'PA': {'fips': '42', 'bbox': '-80.5197,39.7198,-74.6895,42.2699'},
    'RI': {'fips': '44', 'bbox': '-71.9073,41.0958,-71.0886,42.0189'},
    'SC': {'fips': '45', 'bbox': '-83.3535,32.0333,-78.5418,35.2155'},
    'SD': {'fips': '46', 'bbox': '-104.0579,42.4797,-96.4368,45.9451'},
    'TN': {'fips': '47', 'bbox': '-90.3102,34.9828,-81.6469,36.6781'},
    'TX': {'fips': '48', 'bbox': '-106.6456,25.8371,-93.5083,36.5007'},
    'UT': {'fips': '49', 'bbox': '-114.0529,36.9979,-109.0416,42.0017'},
    'VT': {'fips': '50', 'bbox': '-73.4379,42.7270,-71.4653,45.0158'},
    'VA': {'fips': '51', 'bbox': '-83.6754,36.5407,-75.1665,39.4660'},
    'WA': {'fips': '53', 'bbox': '-124.7631,45.5435,-116.9160,49.0025'},
    'WV': {'fips': '54', 'bbox': '-82.6447,37.2015,-77.7193,40.6386'},
    'WI': {'fips': '55', 'bbox': '-92.8893,42.4919,-86.2499,47.0809'},
    'WY': {'fips': '56', 'bbox': '-111.0545,40.9948,-104.0522,45.0059'},
}

# Generic suffix pattern — handles the most common district naming conventions
_DISTRICT_SUFFIX_RE = re.compile(
    r'\s*(?:regional\s+)?(?:unified\s+|independent\s+|community\s+|city\s+|'
    r'central\s+|common\s+|joint\s+|cooperative\s+)?'
    r'(?:school\s+(?:district|committee|department|union|board)|'
    r'(?:elementary|secondary|high)\s+school\s+district|'
    r'public\s+schools?|schools?|board\s+of\s+education)\s*$',
    re.IGNORECASE,
)

_DISTRICT_PREFIX_RE = re.compile(
    r'^(?:greater|north\s+shore|south\s+shore|cape\s+cod|pioneer\s+valley|'
    r'central|eastern|western|northern|southern)\s+',
    re.IGNORECASE,
)


def _extract_state_cities(district_name: str) -> list[str]:
    """Extract candidate city/town names from a school district name.

    Works generically for all states: strips common district-type suffixes
    and geographic prefixes, then splits on hyphens/slashes for multi-city
    districts.

    Examples:
      "Amherst School District"              → ["Amherst"]
      "Amherst-Pelham Regional School Dist"  → ["Amherst", "Pelham"]
      "Los Angeles Unified School District"  → ["Los Angeles"]
      "Greater Lawrence Technical School"    → ["Lawrence"]
    """
    name = _DISTRICT_SUFFIX_RE.sub('', district_name).strip()
    name = re.sub(r'\s+(?:Technical|Vocational|Cooperative|Regional)\s*$', '', name, flags=re.I).strip()
    parts = [p.strip() for p in re.split(r'[-/]', name)]
    cities = []
    for part in parts:
        part = _DISTRICT_PREFIX_RE.sub('', part).strip()
        if part and len(part) >= 2:
            cities.append(part)
    return cities


def _get_state_title_re(state_abbr: str) -> re.Pattern:
    """Returns a compiled regex matching board member titles for the given state."""
    cfg = STATE_CONFIG.get(state_abbr.upper(), {})
    titles = BOARD_TITLES | cfg.get('extra_titles', frozenset())
    return re.compile(
        r'\b(' + '|'.join(re.escape(t) for t in titles) + r')\b',
        re.IGNORECASE,
    )


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

    def __init__(self, session: requests.Session, delay: float):
        self.session = session
        self.delay = delay

    def find(self, district: DistrictInfo) -> Optional[str]:
        if district.website:
            parsed = urlparse(district.website)
            return f'{parsed.scheme}://{parsed.netloc}'.rstrip('/')

        query = f'"{district.name}" {district.city} {district.state} school district official site'
        logger.info(f'Searching DDG for district site: {query}')
        soup = ddg_search(self.session, query, self.delay)
        if soup is None:
            return None

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

        return None


# ---------------------------------------------------------------------------
# publicschoolsk12.com school-level fallback
# ---------------------------------------------------------------------------

class SchoolFallback:
    """
    Fallback for when no district website can be found.

    Uses the NCES Education Data Portal API (free, no key) to list the schools
    in a district by LEAID, then DDG-searches each school by name + city + state
    to find its official website.  Those school websites are then fed to the
    board-page finder, since school sites commonly link to the district committee.
    """

    NCES_BASE   = 'https://educationdata.urban.org/api/v1/schools/ccd/directory'
    NCES_YEAR   = 2021          # most recent complete CCD year
    MAX_SCHOOLS = 4             # cap DDG searches per district

    def __init__(self, session: requests.Session, delay: float):
        self.session = session
        self.delay   = delay

    def find_school_websites(self, district: DistrictInfo) -> list[str]:
        """Return official websites for up to MAX_SCHOOLS schools in this district."""
        schools = self._nces_schools(district.leaid)
        if not schools:
            logger.info(f'NCES returned no schools for LEAID {district.leaid}')
            return []
        websites: list[str] = []
        for school in schools[:self.MAX_SCHOOLS]:
            site = self._search_school_website(school['name'], school['city'], district.state)
            if site and site not in websites:
                websites.append(site)
        return websites

    def _nces_schools(self, leaid: str) -> list[dict]:
        """Return school names and cities for a district from the NCES CCD API."""
        try:
            r = self.session.get(
                f'{self.NCES_BASE}/{self.NCES_YEAR}/',
                params={
                    'leaid':  leaid,
                    'fields': 'school_name,city_location',
                    'limit':  20,
                },
                timeout=15,
            )
            if not r.ok:
                return []
            results = r.json().get('results', [])
            seen: set[str] = set()
            schools: list[dict] = []
            for s in results:
                name = s.get('school_name', '').strip()
                if name and name not in seen:
                    seen.add(name)
                    schools.append({'name': name, 'city': s.get('city_location', '')})
            return schools
        except Exception as e:
            logger.warning(f'NCES lookup failed for LEAID {leaid}: {e}')
            return []

    def _search_school_website(self, name: str, city: str, state: str) -> Optional[str]:
        """DDG-search for a school's official website by name + city + state."""
        query = f'"{name}" {city} {state} official site'
        logger.info(f'Searching DDG for school site: {name}')
        soup = ddg_search(self.session, query, self.delay)
        if soup is None:
            return None
        for a in soup.select('a.result__a'):
            href = a.get('href', '')
            try:
                parsed = urlparse(href)
                host   = parsed.netloc.lower()
            except Exception:
                continue
            if any(bad in host for bad in SKIP_DOMAINS):
                continue
            if any(host.endswith(tld) for tld in GOOD_TLDS):
                return f'{parsed.scheme}://{parsed.netloc}'
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
    def __init__(self, rate_limit_delay: float = 6.0, use_browser: bool = False):
        self.delay = rate_limit_delay
        self.session = make_session()
        self.nces = DistrictLookup(self.session)
        self.website_finder = WebsiteFinder(self.session, rate_limit_delay)
        self.schools_scraper = SchoolFallback(self.session, rate_limit_delay)
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

            if website:
                candidate_sites = [website]
            else:
                logger.info(f'No district website — trying publicschoolsk12.com fallback for {district.name}')
                candidate_sites = self.schools_scraper.find_school_websites(district)

            if not candidate_sites:
                logger.warning(f'No website found for {district.name}')
                result['not_found'].append({
                    'district': district.name,
                    'reason': 'district website not found — manual search needed',
                })
                result['districts'].append(district_entry)
                continue

            board_url = None
            for candidate in candidate_sites:
                time.sleep(self.delay)
                board_url = self.board_finder.find(candidate)
                if board_url:
                    website = candidate
                    break

            district_entry['website'] = website
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
# Massachusetts statewide school committee pipeline
# ---------------------------------------------------------------------------

class StateDistrictFetcher:
    """
    Fetches all K-12 school districts for a given state from Census TIGERweb
    using a statewide bounding box query.

    TIGERweb layers: 14 = Unified, 16 = Secondary, 18 = Elementary.
    Paginates automatically if the server sets exceededTransferLimit.
    """

    TIGERWEB = (
        'https://tigerweb.geo.census.gov/arcgis/rest/services/'
        'TIGERweb/tigerWMS_Current/MapServer/{layer}/query'
    )
    LAYERS = [14, 16, 18]

    def __init__(self, state_abbr: str, session: requests.Session):
        cfg = STATE_CONFIG.get(state_abbr.upper())
        if not cfg:
            raise ValueError(f'Unsupported state: {state_abbr}')
        self.state_abbr = state_abbr.upper()
        self.fips = cfg['fips']
        self.bbox = cfg['bbox']
        self.session = session

    def fetch_all(self) -> list[dict]:
        seen_geoids: set[str] = set()
        all_districts: list[dict] = []

        for layer in self.LAYERS:
            offset = 0
            while True:
                try:
                    r = self.session.get(
                        self.TIGERWEB.format(layer=layer),
                        params={
                            'geometry': self.bbox,
                            'geometryType': 'esriGeometryEnvelope',
                            'inSR': '4326',
                            'spatialRel': 'esriSpatialRelIntersects',
                            'where': f"GEOID LIKE '{self.fips}%'",
                            'outFields': 'NAME,GEOID',
                            'returnGeometry': 'false',
                            'resultRecordCount': 1000,
                            'resultOffset': offset,
                            'f': 'json',
                        },
                        timeout=20,
                    )
                    r.raise_for_status()
                    data = r.json()
                except Exception as e:
                    logger.warning(f'TIGERweb {self.state_abbr} layer {layer} offset {offset}: {e}')
                    break

                features = data.get('features', [])
                if not features:
                    break

                new_count = 0
                for feat in features:
                    attr = feat.get('attributes', {})
                    geoid = attr.get('GEOID', '')
                    if not geoid.startswith(self.fips) or geoid in seen_geoids:
                        continue
                    seen_geoids.add(geoid)
                    all_districts.append({
                        'name': attr.get('NAME', '').strip(),
                        'geoid': geoid,
                        'layer': layer,
                    })
                    new_count += 1

                logger.info(f'TIGERweb layer {layer} offset {offset}: {new_count} new {self.state_abbr} districts')

                if not data.get('exceededTransferLimit'):
                    break
                offset += len(features)

        logger.info(f'Total {self.state_abbr} school districts: {len(all_districts)}')
        return all_districts


class StateBoardPageFinder(BoardPageFinder):
    """
    Board page finder parameterized by state configuration.
    Probes state-specific slugs first, then falls back to generic slugs.
    """

    _DEFAULT_NAV_KEYWORDS = (
        'board of education', 'school board', 'board members',
        'trustees', 'governing board', 'school committee',
    )

    def __init__(self, state_abbr: str, session: requests.Session, delay: float):
        super().__init__(session, delay)
        cfg = STATE_CONFIG.get(state_abbr.upper(), {})
        self._extra_slugs: list[str] = cfg.get('extra_slugs', [])
        self._nav_keywords: tuple = cfg.get('nav_keywords', self._DEFAULT_NAV_KEYWORDS)

    def find(self, base_url: str) -> Optional[str]:
        for slug in self._extra_slugs + BOARD_PAGE_SLUGS:
            url = base_url.rstrip('/') + slug
            time.sleep(self.delay * 0.25)
            try:
                r = self.session.get(url, timeout=10, allow_redirects=True)
                if r.status_code == 200 and len(r.text) > 1000:
                    snippet = r.text[:5000].lower()
                    if any(kw in snippet for kw in ('committee', 'board', 'trustee', 'member', 'president')):
                        logger.info(f'Board page via slug: {r.url}')
                        return r.url
            except Exception:
                continue
        return self._find_in_nav(base_url)

    def _find_in_nav(self, base_url: str) -> Optional[str]:
        logger.info(f'Scanning nav for board link: {base_url}')
        try:
            time.sleep(self.delay * 0.5)
            r = self.session.get(base_url, timeout=12)
            if r.status_code != 200:
                return None
            soup = BeautifulSoup(r.text, 'lxml')
            for a in soup.find_all('a', href=True):
                text = a.get_text(strip=True).lower()
                if any(kw in text for kw in self._nav_keywords):
                    href = a['href']
                    full = href if href.startswith('http') else urljoin(base_url, href)
                    logger.info(f'Board page via nav: {full}')
                    return full
        except Exception as e:
            logger.warning(f'Nav scan failed on {base_url}: {e}')
        return None


class StateSchoolBoardAggregator:
    """
    Statewide school board/committee data pipeline for any supported state.

    1. Fetches all school districts for the given state from Census TIGERweb.
    2. For each district: finds the website, finds the board page,
       and parses board member names/titles.
    3. Outputs city-indexed JSON to data/{state_lower}_school_boards.json.

    Run with:
      python local-officials-aggregator.py --state MA
      python local-officials-aggregator.py --state NY --delay 3
      python local-officials-aggregator.py --state TX --max-districts 10   # test run
    """

    def __init__(self, state_abbr: str, rate_limit_delay: float = 6.0,
                 use_browser: bool = False, max_districts: Optional[int] = None):
        state_abbr = state_abbr.upper()
        if state_abbr not in STATE_CONFIG:
            raise ValueError(
                f'Unsupported state: {state_abbr}. '
                f'Supported: {", ".join(sorted(STATE_CONFIG))}'
            )
        self.state_abbr = state_abbr
        self.delay = rate_limit_delay
        self.max_districts = max_districts
        self.session = make_session()
        self.district_fetcher = StateDistrictFetcher(state_abbr, self.session)
        self.website_finder   = WebsiteFinder(self.session, rate_limit_delay)
        self.schools_scraper  = SchoolFallback(self.session, rate_limit_delay)
        self.board_finder     = StateBoardPageFinder(state_abbr, self.session, rate_limit_delay)
        self.parser = BoardPageParser()
        self.browser: Optional[BrowserFetcher] = BrowserFetcher() if use_browser else None
        self._title_re = _get_state_title_re(state_abbr)

    def default_output_path(self) -> str:
        return f'data/{self.state_abbr.lower()}_school_boards.json'

    def run(self, output_path: Optional[str] = None):
        if output_path is None:
            output_path = self.default_output_path()
        os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)

        logger.info(f'Fetching all {self.state_abbr} school districts from TIGERweb...')
        raw_districts = self.district_fetcher.fetch_all()

        if self.max_districts:
            raw_districts = raw_districts[:self.max_districts]
            logger.info(f'Capped at {self.max_districts} districts (--max-districts)')

        districts_out: list[dict] = []
        city_index: dict[str, list[int]] = {}

        for i, raw in enumerate(raw_districts):
            name = raw['name']
            geoid = raw['geoid']
            idx = len(districts_out)

            logger.info(f'[{i + 1}/{len(raw_districts)}] {name}')

            city_hint = (_extract_state_cities(name) or [''])[0]
            district_info = DistrictInfo(
                leaid=geoid, name=name, city=city_hint, state=self.state_abbr,
                phone=None, website=None, zip_code='',
            )

            time.sleep(self.delay)
            website = self.website_finder.find(district_info)

            district_entry: dict = {
                'name': name,
                'geoid': geoid,
                'website': website,
                'board_page': None,
                'members': [],
            }

            # Build the list of candidate root URLs to probe for a board page.
            # Primary: the district's own website.
            # Fallback: individual school websites scraped from publicschoolsk12.com
            #           (school sites often link to the district school committee).
            if website:
                candidate_sites = [website]
            else:
                logger.info(f'No district website — trying publicschoolsk12.com fallback for {name}')
                candidate_sites = self.schools_scraper.find_school_websites(district_info)
                if not candidate_sites:
                    logger.warning(f'No website or school fallback found for {name}')
                    districts_out.append(district_entry)
                    self._index(name, idx, city_index)
                    continue

            board_page = None
            for candidate in candidate_sites:
                time.sleep(self.delay)
                board_page = self.board_finder.find(candidate)
                if board_page:
                    district_entry['website'] = candidate
                    break

            district_entry['board_page'] = board_page

            if not board_page:
                logger.warning(f'No board page found for {name}')
                if not website and candidate_sites:
                    district_entry['website'] = candidate_sites[0]
                districts_out.append(district_entry)
                self._index(name, idx, city_index)
                continue

            time.sleep(self.delay)
            try:
                html = self.session.get(board_page, timeout=15).text
                if self.browser and not self._title_re.search(
                    BeautifulSoup(html, 'lxml').get_text()
                ):
                    logger.info(f'Retrying with browser: {board_page}')
                    html = self.browser.fetch(board_page)

                officials = self.parser.parse(html, board_page, district_info)
                district_entry['members'] = [
                    {
                        'name': o.name,
                        'title': o.title,
                        'contact_email': o.contact_email,
                    }
                    for o in officials
                ]
                logger.info(f'✓ {name}: {len(officials)} member(s)')
            except Exception as e:
                logger.error(f'Parse error for {board_page}: {e}')

            districts_out.append(district_entry)
            self._index(name, idx, city_index)

            # Checkpoint every 50 districts so progress isn't lost
            if (i + 1) % 50 == 0:
                self._save(districts_out, city_index, output_path, partial=True)

        self._save(districts_out, city_index, output_path, partial=False)

        total_members = sum(len(d['members']) for d in districts_out)
        no_members = sum(1 for d in districts_out if not d['members'])
        logger.info(
            f'Done — {len(districts_out)} districts, {total_members} members found, '
            f'{no_members} districts with no members parsed'
        )

    def _index(self, district_name: str, idx: int, city_index: dict):
        for city in _extract_state_cities(district_name):
            key = city.lower()
            city_index.setdefault(key, [])
            if idx not in city_index[key]:
                city_index[key].append(idx)

    def _save(self, districts: list, city_index: dict, path: str, partial: bool = False):
        payload = {
            'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'state': self.state_abbr,
            'partial': partial,
            'districts': districts,
            'city_index': city_index,
        }
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        status = '(partial checkpoint)' if partial else ''
        logger.info(f'Saved → {path} {status}')

    def close(self):
        if self.browser:
            self.browser.close()


# ---------------------------------------------------------------------------
# City / Town Council scraper — New England focus
# ---------------------------------------------------------------------------

# New England states (the first target region for city council data)
NEW_ENGLAND_STATES = ('CT', 'MA', 'ME', 'NH', 'RI', 'VT')

# Common URL slugs for city/town council pages
COUNCIL_PAGE_SLUGS = [
    '/city-council',
    '/town-council',
    '/council',
    '/government/city-council',
    '/government/town-council',
    '/government/council',
    '/elected-officials/city-council',
    '/elected-officials/town-council',
    '/departments/city-council',
    '/departments/town-council',
    '/selectboard',
    '/board-of-selectmen',
    '/selectmen',
    '/government/selectboard',
    '/government/board-of-selectmen',
    '/government/selectmen',
    '/aldermen',
    '/board-of-aldermen',
    '/government/aldermen',
]

# Navigation keywords for finding council links in homepages
COUNCIL_NAV_KEYWORDS = (
    'city council', 'town council', 'board of selectmen', 'selectboard',
    'selectmen', 'board of aldermen', 'aldermen', 'council members',
    'elected officials', 'government officials',
)

# Title keywords for identifying council members in parsed pages
COUNCIL_TITLES = frozenset({
    'mayor', 'council president', 'council vice president',
    'city council', 'councilor', 'councilmember', 'council member',
    'councilman', 'councilwoman', 'alderman', 'alderwoman', 'alderperson',
    'at-large', 'at large', 'district representative',
    'ward representative', 'ward councilor',
    'selectman', 'selectwoman', 'selectperson', 'select board member',
    'chair', 'vice chair', 'chairperson', 'chairman', 'chairwoman',
    'member', 'town manager', 'city manager',
})

COUNCIL_TITLE_RE = re.compile(
    r'\b(' + '|'.join(re.escape(t) for t in COUNCIL_TITLES) + r')\b',
    re.IGNORECASE,
)


class CensusCitiesFetcher:
    """
    Fetches all incorporated places (cities, towns, villages) for a state
    using the Census Bureau's free Decennial data API (no API key required).

    Returns a list of dicts: [{'name': 'Methuen', 'fips_place': '45345'}, ...]
    """

    # 2020 Decennial Census — place list, no key needed
    CENSUS_API = 'https://api.census.gov/data/2020/dec/pl'

    def __init__(self, session: requests.Session):
        self.session = session

    def fetch(self, state_abbr: str) -> list[dict]:
        cfg = STATE_CONFIG.get(state_abbr.upper())
        if not cfg:
            raise ValueError(f'Unknown state: {state_abbr}')
        fips = cfg['fips']

        try:
            r = self.session.get(
                self.CENSUS_API,
                params={'get': 'NAME', 'for': 'place:*', 'in': f'state:{fips}'},
                timeout=20,
            )
            r.raise_for_status()
            rows = r.json()
        except Exception as e:
            logger.error(f'Census places fetch failed for {state_abbr}: {e}')
            return []

        places = []
        for row in rows[1:]:   # first row is the header
            raw_name = row[0]  # e.g. "Methuen city, Massachusetts"
            fips_place = row[2]
            # Strip the type suffix and state: "Methuen city, Massachusetts" → "Methuen"
            city = re.split(r'\s+(?:city|town|village|borough|township|CDP),', raw_name, flags=re.I)[0].strip()
            if city:
                places.append({'name': city, 'fips_place': fips_place})

        logger.info(f'{state_abbr}: {len(places)} places fetched from Census')
        return places


class CouncilPageFinder:
    """
    Given a city/town name and state, finds the URL of their council members page.

    Strategy:
      1. DDG-search for the official city/town website
      2. Probe common council URL slug patterns
      3. Fall back to scanning the homepage nav for council links
    """

    def __init__(self, session: requests.Session, delay: float):
        self.session = session
        self.delay = delay

    def find_site(self, city: str, state_abbr: str) -> Optional[str]:
        """DDG-search for the official city/town website."""
        query = f'"{city}" {state_abbr} official city town government site'
        logger.info(f'Searching DDG for city site: {city}, {state_abbr}')
        soup = ddg_search(self.session, query, self.delay)
        if soup is None:
            return None

        for a in soup.select('a.result__a'):
            href = a.get('href', '')
            try:
                parsed = urlparse(href)
                host = parsed.netloc.lower()
            except Exception:
                continue
            if any(bad in host for bad in SKIP_DOMAINS):
                continue
            # Prefer .gov / .us / .org / .net — typical municipal TLDs
            if any(host.endswith(tld) for tld in GOOD_TLDS):
                site = f'{parsed.scheme}://{parsed.netloc}'
                logger.info(f'DDG → city site: {site}')
                return site

        return None

    def find_council_page(self, base_url: str) -> Optional[str]:
        """Probe slug patterns then fall back to nav scan."""
        for slug in COUNCIL_PAGE_SLUGS:
            url = base_url.rstrip('/') + slug
            time.sleep(self.delay * 0.25)
            try:
                r = self.session.get(url, timeout=10, allow_redirects=True)
                if r.status_code == 200 and len(r.text) > 500:
                    snippet = r.text[:5000].lower()
                    if any(kw in snippet for kw in ('council', 'selectmen', 'aldermen', 'member')):
                        logger.info(f'Council page found via slug: {r.url}')
                        return r.url
            except Exception:
                continue

        return self._find_in_nav(base_url)

    def _find_in_nav(self, base_url: str) -> Optional[str]:
        logger.info(f'Scanning homepage nav for council link: {base_url}')
        try:
            time.sleep(self.delay * 0.5)
            r = self.session.get(base_url, timeout=12)
            if r.status_code != 200:
                return None
            soup = BeautifulSoup(r.text, 'lxml')
            for a in soup.find_all('a', href=True):
                text = a.get_text(strip=True).lower()
                if any(kw in text for kw in COUNCIL_NAV_KEYWORDS):
                    href = a['href']
                    full = href if href.startswith('http') else urljoin(base_url, href)
                    logger.info(f'Council page found via nav: {full}')
                    return full
        except Exception as e:
            logger.warning(f'Nav scan failed on {base_url}: {e}')
        return None


class CouncilPageParser:
    """
    Extracts council member names, titles, emails, and phones from a council page.

    Uses the same three-strategy approach as BoardPageParser:
      1. HTML tables
      2. Staff/member card elements
      3. Plain-text extraction near council-related headings
    """

    def parse(self, html: str, source_url: str, city: str) -> list[dict]:
        soup = BeautifulSoup(html, 'lxml')
        self._strip_noise(soup)

        members = (
            self._parse_tables(soup, source_url)
            or self._parse_cards(soup, source_url)
            or self._parse_text_blocks(soup, source_url)
        )

        # Deduplicate by lowercased name
        seen: set[str] = set()
        unique = []
        for m in members:
            key = m['name'].lower().strip()
            if key and key not in seen:
                seen.add(key)
                unique.append(m)

        logger.info(f'Parsed {len(unique)} council member(s) from {source_url}')
        return unique

    def _strip_noise(self, soup: BeautifulSoup):
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']):
            tag.decompose()

    def _make_member(self, name: str, title: str = 'Council Member',
                     email: Optional[str] = None, phone: Optional[str] = None) -> dict:
        return {'name': name, 'title': title, 'contact_email': email, 'contact_phone': phone}

    def _clean_name(self, raw: str) -> str:
        raw = re.sub(r'[\r\n\t]+', ' ', raw).strip()
        raw = re.sub(r'\s{2,}', ' ', raw)
        m = NAME_RE.search(raw)
        return m.group(0) if m else ''

    def _extract_email(self, cell) -> Optional[str]:
        a = cell.find('a', href=re.compile(r'^mailto:', re.I))
        if a:
            return a['href'].replace('mailto:', '').strip()
        m = re.search(r'[\w.+-]+@[\w.-]+\.\w{2,}', cell.get_text())
        return m.group(0) if m else None

    def _extract_phone(self, cell) -> Optional[str]:
        m = PHONE_RE.search(cell.get_text())
        return m.group(0) if m else None

    def _parse_tables(self, soup: BeautifulSoup, url: str) -> list[dict]:
        members = []
        for table in soup.find_all('table'):
            headers = [th.get_text(' ', strip=True).lower() for th in table.find_all('th')]
            if not headers:
                first_row = table.find('tr')
                if first_row:
                    headers = [td.get_text(' ', strip=True).lower()
                                for td in first_row.find_all(['td', 'th'])]

            header_str = ' '.join(headers)
            if not any(kw in header_str for kw in ('name', 'member', 'council', 'alderman', 'selectman')):
                continue

            name_col  = next((i for i, h in enumerate(headers) if 'name' in h), 0)
            title_col = next((i for i, h in enumerate(headers)
                              if any(k in h for k in ('title', 'position', 'role', 'office', 'ward', 'district'))), None)
            email_col = next((i for i, h in enumerate(headers) if 'email' in h or 'contact' in h), None)
            phone_col = next((i for i, h in enumerate(headers) if 'phone' in h or 'tel' in h), None)

            for row in table.find_all('tr')[1:]:
                cells = row.find_all(['td', 'th'])
                if len(cells) <= name_col:
                    continue
                name = self._clean_name(cells[name_col].get_text(' ', strip=True))
                if not name:
                    continue
                title = cells[title_col].get_text(' ', strip=True) if title_col and len(cells) > title_col else 'Council Member'
                email = self._extract_email(cells[email_col]) if email_col and len(cells) > email_col else None
                phone = self._extract_phone(cells[phone_col]) if phone_col and len(cells) > phone_col else None
                members.append(self._make_member(name, title or 'Council Member', email, phone))

        return members

    def _parse_cards(self, soup: BeautifulSoup, url: str) -> list[dict]:
        members = []
        for el in soup.find_all(['div', 'article', 'li', 'section']):
            text = el.get_text(' ', strip=True)
            if not COUNCIL_TITLE_RE.search(text):
                continue
            if len(text) > 600 or len(text) < 10:
                continue

            name_m = NAME_RE.search(text)
            if not name_m:
                continue
            name = name_m.group(0)

            title_m = COUNCIL_TITLE_RE.search(text)
            title = title_m.group(0).title() if title_m else 'Council Member'

            email = self._extract_email(el)
            phone_m = PHONE_RE.search(text)
            phone = phone_m.group(0) if phone_m else None

            members.append(self._make_member(name, title, email, phone))

        return members

    def _parse_text_blocks(self, soup: BeautifulSoup, url: str) -> list[dict]:
        members = []
        council_headings = [
            h for h in soup.find_all(['h1', 'h2', 'h3', 'h4'])
            if any(kw in h.get_text(strip=True).lower()
                   for kw in ('council', 'selectmen', 'selectboard', 'aldermen', 'members'))
        ]
        for heading in council_headings:
            block = []
            for sib in heading.find_next_siblings():
                if sib.name in ('h1', 'h2', 'h3', 'h4'):
                    break
                block.append(sib.get_text(' ', strip=True))

            text = ' '.join(block)
            for m in NAME_RE.finditer(text):
                name = m.group(0)
                members.append(self._make_member(name))

        return members


class CityCouncilAggregator:
    """
    Scrapes city/town council member data for all incorporated places in a state.

    Targets New England states where municipal government data is sparse online.
    Outputs to data/{state_lower}_city_council.json with the same shape expected
    by js/city-council.js.

    Usage:
      python local-officials-aggregator.py --council --state MA
      python local-officials-aggregator.py --council --new-england
      python local-officials-aggregator.py --council --state CT --max-cities 10
    """

    def __init__(self, state_abbr: str, rate_limit_delay: float = 6.0,
                 max_cities: Optional[int] = None):
        state_abbr = state_abbr.upper()
        if state_abbr not in STATE_CONFIG:
            raise ValueError(f'Unsupported state: {state_abbr}')
        self.state_abbr = state_abbr
        self.delay = rate_limit_delay
        self.max_cities = max_cities
        self.session = make_session()
        self.cities_fetcher = CensusCitiesFetcher(self.session)
        self.page_finder = CouncilPageFinder(self.session, rate_limit_delay)
        self.parser = CouncilPageParser()

    def default_output_path(self) -> str:
        return f'data/{self.state_abbr.lower()}_city_council.json'

    def run(self, output_path: Optional[str] = None):
        if output_path is None:
            output_path = self.default_output_path()
        os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)

        logger.info(f'Fetching {self.state_abbr} cities/towns from Census...')
        places = self.cities_fetcher.fetch(self.state_abbr)

        if self.max_cities:
            places = places[:self.max_cities]
            logger.info(f'Capped at {self.max_cities} cities (--max-cities)')

        councils_out: list[dict] = []
        city_index: dict[str, list[int]] = {}

        for i, place in enumerate(places):
            city = place['name']
            idx  = len(councils_out)
            logger.info(f'[{i + 1}/{len(places)}] {city}, {self.state_abbr}')

            time.sleep(self.delay)
            site = self.page_finder.find_site(city, self.state_abbr)

            council_entry: dict = {
                'name':         f'{city} City Council',
                'city':         city,
                'state':        self.state_abbr,
                'website':      site,
                'council_page': None,
                'members':      [],
            }

            if not site:
                logger.warning(f'No website found for {city}, {self.state_abbr}')
                councils_out.append(council_entry)
                city_index.setdefault(city.lower(), []).append(idx)
                continue

            time.sleep(self.delay)
            council_page = self.page_finder.find_council_page(site)
            council_entry['council_page'] = council_page

            if not council_page:
                logger.warning(f'No council page found for {city}')
                councils_out.append(council_entry)
                city_index.setdefault(city.lower(), []).append(idx)
                continue

            time.sleep(self.delay)
            try:
                r = self.session.get(council_page, timeout=15)
                r.raise_for_status()
                members = self.parser.parse(r.text, council_page, city)
                council_entry['members'] = members
                logger.info(f'✓ {city}: {len(members)} member(s)')
            except Exception as e:
                logger.error(f'Parse error for {council_page}: {e}')

            councils_out.append(council_entry)
            city_index.setdefault(city.lower(), []).append(idx)

            # Checkpoint every 25 cities
            if (i + 1) % 25 == 0:
                self._save(councils_out, city_index, output_path, partial=True)

        self._save(councils_out, city_index, output_path, partial=False)

        total_members = sum(len(c['members']) for c in councils_out)
        no_members = sum(1 for c in councils_out if not c['members'])
        logger.info(
            f'Done — {len(councils_out)} cities, {total_members} members found, '
            f'{no_members} cities with no members parsed'
        )

    def _save(self, councils: list, city_index: dict, path: str, partial: bool = False):
        payload = {
            'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'state':     self.state_abbr,
            'partial':   partial,
            'councils':  councils,
            'city_index': city_index,
        }
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        status = '(partial checkpoint)' if partial else ''
        logger.info(f'Saved → {path} {status}')


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    supported_states = ', '.join(sorted(STATE_CONFIG))
    ap = argparse.ArgumentParser(
        description='Scrape school board / school committee member data (free sources only).',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
examples:
  python local-officials-aggregator.py --zip 90210
  python local-officials-aggregator.py --zip 90210 10001 60601 --output results.json
  python local-officials-aggregator.py --zip 90210 --delay 3 --verbose

  # Scrape all school boards for a state:
  python local-officials-aggregator.py --state MA
  python local-officials-aggregator.py --state NY --delay 3
  python local-officials-aggregator.py --state TX --max-districts 10   # test run
  python local-officials-aggregator.py --state CA --output data/ca_school_boards.json

supported states: {supported_states}
        """,
    )
    ap.add_argument('--zip', nargs='+', metavar='ZIPCODE',
                    help='One or more 5-digit ZIP codes to process')
    ap.add_argument('--state', metavar='XX',
                    help='Scrape all school boards for a state (e.g. MA, NY, CA). '
                         'Outputs to data/{state}_school_boards.json (or --output path).')
    ap.add_argument('--ma', action='store_true',
                    help='Alias for --state MA (backward compatibility)')
    ap.add_argument('--max-districts', type=int, default=None, metavar='N',
                    help='Limit --state scrape to first N districts (useful for testing)')

    # City council flags
    ap.add_argument('--council', action='store_true',
                    help='Scrape city/town council members instead of school boards. '
                         'Use with --state XX or --new-england.')
    ap.add_argument('--new-england', action='store_true',
                    help='Scrape city/town council members for all New England states '
                         '(CT, MA, ME, NH, RI, VT). Implies --council.')
    ap.add_argument('--max-cities', type=int, default=None, metavar='N',
                    help='Limit --council scrape to first N cities per state (useful for testing)')
    ap.add_argument('--output', default=None,
                    help='Output JSON file path (defaults: officials_output.json for --zip, '
                         'data/{state}_school_boards.json for --state)')
    ap.add_argument('--delay', type=float, default=6.0,
                    help='Seconds between requests — be polite (default: 6.0)')
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

    # --ma is a backward-compatible alias for --state MA
    state = args.state or ('MA' if args.ma else None)

    if not state and not args.zip and not args.new_england:
        ap.error('One of --zip, --state XX, --ma, or --new-england is required.')

    if args.use_browser and not PLAYWRIGHT_AVAILABLE:
        ap.error(
            '--use-browser requires Playwright:\n'
            '  pip install playwright\n'
            '  playwright install chromium'
        )

    # ── City/town council scrape — New England all-states shorthand ──────────
    if args.council and not state and not args.zip and not args.new_england:
        ap.error('--council requires --state XX or --new-england.')

    if args.new_england:
        target_states = NEW_ENGLAND_STATES
    elif args.council and state:
        target_states = (state.upper(),)
    else:
        target_states = ()

    if target_states:
        for abbr in target_states:
            logger.info(f'=== City council scrape: {abbr} ===')
            out_path = args.output or f'data/{abbr.lower()}_city_council.json'
            agg = CityCouncilAggregator(
                state_abbr=abbr,
                rate_limit_delay=args.delay,
                max_cities=args.max_cities,
            )
            agg.run(out_path)
        return

    # ── Statewide school board scrape ────────────────────────────────────────
    if state:
        state = state.upper()
        if state not in STATE_CONFIG:
            ap.error(f'Unknown state "{state}". Supported: {supported_states}')
        agg = StateSchoolBoardAggregator(
            state_abbr=state,
            rate_limit_delay=args.delay,
            use_browser=args.use_browser,
            max_districts=args.max_districts,
        )
        try:
            agg.run(args.output)
        finally:
            agg.close()
        return

    # ── Per-ZIP scrape ───────────────────────────────────────────────────────
    output = args.output or 'officials_output.json'

    bad_zips = [z for z in args.zip if not re.match(r'^\d{5}$', z)]
    if bad_zips:
        ap.error(f'Invalid ZIP code(s): {", ".join(bad_zips)}')

    aggregator = OfficialsAggregator(
        rate_limit_delay=args.delay,
        use_browser=args.use_browser,
    )
    try:
        results = aggregator.process_zips(args.zip)
        aggregator.save(results, output)
    finally:
        aggregator.close()

    # Human-readable summary
    total_officials = sum(len(r['officials']) for r in results)
    total_not_found = sum(len(r['not_found']) for r in results)
    print(f'\n{"─" * 50}')
    print(f'  ZIPs processed : {len(results)}')
    print(f'  Officials found: {total_officials}')
    print(f'  Need follow-up : {total_not_found} district(s)')
    print(f'  Output         : {output}')
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
