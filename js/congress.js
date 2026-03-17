const CongressAPI = (() => {
  const BASE = 'https://api.congress.gov/v3';

  // Maps Congress.gov bill type codes to URL path segments
  const TYPE_PATHS = {
    HR:      'house-bill',
    S:       'senate-bill',
    HRES:    'house-resolution',
    SRES:    'senate-resolution',
    HJRES:   'house-joint-resolution',
    SJRES:   'senate-joint-resolution',
    HCONRES: 'house-concurrent-resolution',
    SCONRES: 'senate-concurrent-resolution',
    HAMDT:   'house-amendment',
    SAMDT:   'senate-amendment',
  };

  function billUrl(congress, type, number) {
    const path = TYPE_PATHS[type] || type.toLowerCase();
    return `https://www.congress.gov/bill/${congress}th-congress/${path}/${number}`;
  }

  function formatBillNumber(type, number) {
    // e.g. "H.R. 1234" or "S. 42"
    const labels = { HR: 'H.R.', S: 'S.', HRES: 'H.Res.', SRES: 'S.Res.',
      HJRES: 'H.J.Res.', SJRES: 'S.J.Res.',
      HCONRES: 'H.Con.Res.', SCONRES: 'S.Con.Res.' };
    return `${labels[type] || type} ${number}`;
  }

  async function getSponsoredBills(bioguideId) {
    const key = CONFIG.CONGRESS_API_KEY;
    if (!key) return null;
    try {
      const res = await fetch(
        `${BASE}/member/${bioguideId}/sponsored-legislation` +
        `?limit=8&format=json&api_key=${key}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const bills = data.sponsoredLegislation || [];
      return bills.map(b => ({
        label:           formatBillNumber(b.type, b.number),
        title:           b.title || null,
        congress:        b.congress,
        introducedDate:  b.introducedDate || null,
        latestAction:    b.latestAction?.actionText || null,
        latestActionDate: b.latestAction?.actionDate || null,
        url:             billUrl(b.congress, b.type, b.number),
      }));
    } catch {
      return null;
    }
  }

  async function getCommittees(bioguideId) {
    const key = CONFIG.PROPUBLICA_API_KEY;
    if (!key) return null;
    try {
      const res = await fetch(
        `https://api.propublica.org/congress/v1/members/${bioguideId}.json`,
        { headers: { 'X-API-Key': key } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const roles = data.results?.[0]?.roles || [];
      const current = roles.find(r => r.congress === '119') || roles[0];
      if (!current) return null;
      const committees = (current.committees || []).map(c => ({
        name: c.name,
        side: c.side,
      }));
      return committees.length ? committees : null;
    } catch {
      return null;
    }
  }

  async function enrich(official) {
    if (official.level !== 'Federal' || !official.propublicaId) return official;
    const [bills, committees] = await Promise.all([
      getSponsoredBills(official.propublicaId),
      getCommittees(official.propublicaId),
    ]);
    if (bills       !== null) official.sponsoredBills = bills;
    if (committees  !== null) official.committees     = committees;
    return official;
  }

  return { enrich };
})();
