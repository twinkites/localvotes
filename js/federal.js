const FederalAPI = (() => {
  const BASE = 'https://api.congress.gov/v3';

  function parseName(nameStr) {
    // Congress.gov format: "Last, First Middle" → "First Middle Last"
    const idx = nameStr.indexOf(', ');
    return idx !== -1 ? `${nameStr.slice(idx + 2)} ${nameStr.slice(0, idx)}`.trim() : nameStr;
  }

  function normalizeOfficial(member, stateAbbr) {
    const isSenator = member.district == null;
    const raw = member.partyName || '';
    const party = /^rep/i.test(raw) ? 'Republican Party'
      : /^dem/i.test(raw) ? 'Democratic Party'
      : raw === 'Independent' ? 'Independent'
      : raw || 'Unknown';

    const office = isSenator
      ? `U.S. Senator for ${member.state || stateAbbr}`
      : `U.S. Representative, ${stateAbbr}-${member.district}`;

    return {
      name: parseName(member.name),
      office,
      level: 'Federal',
      levelRaw: 'country',
      stateAbbr,
      role: isSenator ? 'Senator / Upper Chamber' : 'Representative / Lower Chamber',
      party,
      phones: [],
      urls: [],
      emails: [],
      photoUrl: member.depiction?.imageUrl || null,
      address: [],
      channels: [],
      propublicaId: member.bioguideId,
      campaignFinance: null,
    };
  }

  async function getOfficials(stateAbbr, district) {
    const key = CONFIG.CONGRESS_API_KEY;
    if (!key) return [];
    try {
      // Use the congress/state path endpoint — the query-param ?stateCode= is ignored by
      // the /v3/member list endpoint and returns all current members regardless of state.
      const res = await fetch(
        `${BASE}/member/congress/119/${stateAbbr}?currentMember=true&limit=250&format=json&api_key=${key}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      const members = data.members || [];
      const distNum = district != null ? parseInt(district, 10) : null;
      return members
        .filter(m => {
          // Keep senators (no district) and the matching House rep.
          // The state-specific endpoint should only return this state's members,
          // but guard against any stray results with a state-name check.
          if (m.state && m.state !== stateAbbr &&
              !m.state.toLowerCase().includes(stateAbbr.toLowerCase())) {
            // m.state may be a full name ("Massachusetts") or abbreviation ("MA").
            // Only exclude if it clearly belongs to another state.
            const knownOtherState = m.state.length === 2 && m.state !== stateAbbr;
            if (knownOtherState) return false;
          }
          return m.district == null || (distNum != null && m.district === distNum);
        })
        .map(m => normalizeOfficial(m, stateAbbr));
    } catch {
      return [];
    }
  }

  return { getOfficials };
})();
