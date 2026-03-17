// statewide.js — fetches current statewide elected officials (Governor, AG, etc.)
// via Wikidata SPARQL (free, no API key).
// Results are cached per state for the browser session.

const StatewideAPI = (() => {
  // Wikidata QIDs for each US state/territory
  const STATE_QIDS = {
    AL: 'Q173',  AK: 'Q797',  AZ: 'Q816',  AR: 'Q1612', CA: 'Q99',
    CO: 'Q1261', CT: 'Q779',  DE: 'Q1389', FL: 'Q812',  GA: 'Q1428',
    HI: 'Q782',  ID: 'Q1221', IL: 'Q1204', IN: 'Q1415', IA: 'Q1206',
    KS: 'Q1558', KY: 'Q1603', LA: 'Q1588', ME: 'Q724',  MD: 'Q1391',
    MA: 'Q771',  MI: 'Q1166', MN: 'Q1527', MS: 'Q1494', MO: 'Q1581',
    MT: 'Q1212', NE: 'Q1553', NV: 'Q1227', NH: 'Q759',  NJ: 'Q1408',
    NM: 'Q1522', NY: 'Q1384', NC: 'Q1454', ND: 'Q1207', OH: 'Q1397',
    OK: 'Q1649', OR: 'Q1431', PA: 'Q1400', RI: 'Q1387', SC: 'Q1456',
    SD: 'Q1211', TN: 'Q1509', TX: 'Q1439', UT: 'Q829',  VT: 'Q16551',
    VA: 'Q1370', WA: 'Q1223', WV: 'Q1371', WI: 'Q1537', WY: 'Q1214',
    DC: 'Q61',
  };

  // Position priority for display ordering
  const POSITION_ORDER = [
    'governor', 'lieutenant governor', 'attorney general',
    'secretary of state', 'treasurer', 'comptroller', 'auditor',
  ];

  const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
  const TIMEOUT_MS = 7000;

  // Session cache: stateAbbr → Promise<official[]>
  const _cache = {};

  async function getOfficials(stateAbbr) {
    const stateQid = STATE_QIDS[stateAbbr];
    if (!stateQid) return [];

    if (_cache[stateAbbr]) return _cache[stateAbbr];

    _cache[stateAbbr] = _fetch(stateQid, stateAbbr).catch(() => []);
    return _cache[stateAbbr];
  }

  async function _fetch(stateQid, stateAbbr) {
    const sparql = `
SELECT DISTINCT ?officialLabel ?posLabel ?partyLabel ?image WHERE {
  VALUES ?state { wd:${stateQid} }
  ?position wdt:P1001 ?state .
  ?position rdfs:label ?posLabel .
  FILTER(LANG(?posLabel) = "en")
  FILTER(
    CONTAINS(LCASE(STR(?posLabel)), "governor") ||
    CONTAINS(LCASE(STR(?posLabel)), "attorney general") ||
    CONTAINS(LCASE(STR(?posLabel)), "secretary of state") ||
    CONTAINS(LCASE(STR(?posLabel)), "treasurer") ||
    CONTAINS(LCASE(STR(?posLabel)), "comptroller") ||
    CONTAINS(LCASE(STR(?posLabel)), "auditor")
  )
  FILTER(!CONTAINS(LCASE(STR(?posLabel)), "deputy"))
  FILTER(!CONTAINS(LCASE(STR(?posLabel)), "former"))
  ?official p:P39 ?tenure .
  ?tenure ps:P39 ?position .
  # Exclude tenures that have an explicit end date
  FILTER NOT EXISTS { ?tenure pq:P582 ?endDate }
  # Exclude people who have a recorded date of death (catches historical officials
  # like Luther Bradish whose tenure has no start/end dates in Wikidata)
  FILTER NOT EXISTS { ?official wdt:P570 ?deathDate }
  # If a start date is recorded, require it to be after 2000.
  # Belt-and-suspenders: catches any living historical figure whose tenure
  # somehow lacks an end date.
  OPTIONAL { ?tenure pq:P580 ?startDate }
  FILTER(!BOUND(?startDate) || ?startDate > "2000-01-01T00:00:00Z"^^xsd:dateTime)
  OPTIONAL { ?official wdt:P102 ?party }
  OPTIONAL { ?official wdt:P18 ?image }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 20`.trim();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let data;
    try {
      const res = await fetch(
        `${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}`,
        {
          headers: { Accept: 'application/sparql-results+json' },
          signal: controller.signal,
        }
      );
      if (!res.ok) return [];
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const bindings = data?.results?.bindings ?? [];
    const seen = new Set();
    const officials = [];

    for (const b of bindings) {
      const name = b.officialLabel?.value;
      const posLabel = b.posLabel?.value;
      if (!name || !posLabel || seen.has(name)) continue;
      // Skip Wikidata "no label" placeholders
      if (name.startsWith('Q') && /^\d+$/.test(name.slice(1))) continue;
      seen.add(name);

      const imageUri = b.image?.value
        ? b.image.value.replace('http://', 'https://')
        : null;

      officials.push({
        name,
        office: posLabel,
        level: 'State',
        party: _normalizeParty(b.partyLabel?.value),
        phones: [],
        emails: [],
        urls: [],
        address: [],
        channels: [],
        photoUrl: imageUri,
        _posOrder: _positionOrder(posLabel),
      });
    }

    // Sort: governor first, then others in defined order
    officials.sort((a, b) => a._posOrder - b._posOrder);

    // Strip the internal sort key before returning
    return officials.map(({ _posOrder, ...o }) => o);
  }

  function _positionOrder(label) {
    const l = label.toLowerCase();
    const idx = POSITION_ORDER.findIndex(p => l.includes(p));
    return idx === -1 ? 99 : idx;
  }

  function _normalizeParty(label) {
    if (!label) return 'Unknown';
    const l = label.toLowerCase();
    if (l.includes('republican')) return 'Republican Party';
    if (l.includes('democrat'))   return 'Democratic Party';
    if (l.includes('green'))      return 'Green Party';
    if (l.includes('libertarian'))return 'Libertarian Party';
    if (l.includes('independent') || l.includes('no party')) return 'Independent';
    return label;
  }

  return { getOfficials };
})();
