const FECAPI = (() => {
  const BASE = 'https://api.open.fec.gov/v1';

  async function enrich(official) {
    if (!CONFIG.FEC_API_KEY) return official;
    // FEC only tracks federal campaign finance - skip state/local officials
    if (official.level !== 'Federal') return official;
    try {
      const nameParts = official.name.split(' ');
      const lastName = nameParts[nameParts.length - 1];
      const res = await fetch(
        `${BASE}/candidates/search/?q=${encodeURIComponent(lastName)}&api_key=${CONFIG.FEC_API_KEY}&per_page=5`
      );
      if (!res.ok) return official;
      const data = await res.json();
      // Cross-check state and chamber to avoid matching a same-name candidate
      // from a different state or office type
      const isSenator = official.role?.includes('Senator');
      const match = (data.results || []).find(c =>
        c.name &&
        c.name.toLowerCase().includes(lastName.toLowerCase()) &&
        c.state === official.stateAbbr &&
        (isSenator ? c.office_full === 'Senate' : c.office_full === 'House')
      );
      if (match) {
        official.campaignFinance = {
          source: 'FEC',
          candidateId: match.candidate_id,
          party: match.party_full,
          office: match.office_full,
          state: match.state,
          totalRaised: match.receipts,
          totalSpent: match.disbursements,
          fecUrl: `https://www.fec.gov/data/candidate/${match.candidate_id}/`,
        };
      }
    } catch { /* silent fail */ }
    return official;
  }

  return { enrich };
})();
