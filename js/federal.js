const FederalAPI = (() => {
  const BASE = 'https://api.propublica.org/congress/v1';
  const CONGRESS = 119;

  function headers() {
    const key = CONFIG.PROPUBLICA_API_KEY;
    return key ? { 'X-API-Key': key } : {};
  }

  function normalizeOfficial(member, chamber, stateAbbr) {
    const party = member.party === 'R' ? 'Republican Party'
      : member.party === 'D' ? 'Democratic Party'
      : member.party === 'I' ? 'Independent'
      : member.party || 'Unknown';

    const office = chamber === 'senate'
      ? `U.S. Senator for ${member.state || stateAbbr}`
      : `U.S. Representative, ${member.state || stateAbbr}-${member.district}`;

    return {
      name: `${member.first_name} ${member.last_name}`,
      office,
      level: 'Federal',
      levelRaw: 'country',
      stateAbbr,
      role: chamber === 'senate' ? 'Senator / Upper Chamber' : 'Representative / Lower Chamber',
      party,
      phones: [],
      urls: member.url ? [member.url] : [],
      emails: [],
      photoUrl: null,
      address: [],
      channels: [],
      propublicaId: member.id,
      votingRecord: {
        source: 'ProPublica',
        missedVotesPct: member.missed_votes_pct ?? null,
        votesWithPartyPct: member.votes_with_party_pct ?? null,
        url: member.url || null,
      },
      campaignFinance: null,
    };
  }

  async function getSenators(stateAbbr) {
    try {
      const res = await fetch(
        `${BASE}/members/${stateAbbr}/senate.json`,
        { headers: headers() }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results?.[0]?.members || [])
        .filter(m => m.in_office)
        .map(m => normalizeOfficial(m, 'senate', stateAbbr));
    } catch {
      return [];
    }
  }

  async function getHouseRep(stateAbbr, district) {
    if (!district) return [];
    // Strip leading zeros for the API call then re-pad
    const distNum = parseInt(district, 10);
    if (isNaN(distNum)) return [];
    try {
      const res = await fetch(
        `${BASE}/members/${stateAbbr}/${distNum}/house.json`,
        { headers: headers() }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results?.[0]?.members || [])
        .filter(m => m.in_office)
        .map(m => normalizeOfficial(m, 'house', stateAbbr));
    } catch {
      return [];
    }
  }

  async function getOfficials(stateAbbr, district) {
    const [senators, houseReps] = await Promise.all([
      getSenators(stateAbbr),
      getHouseRep(stateAbbr, district),
    ]);
    return [...senators, ...houseReps];
  }

  return { getOfficials };
})();
