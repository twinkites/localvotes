const FECAPI = (() => {
  const BASE = 'https://api.open.fec.gov/v1';

  // FEC names are "LASTNAME, FIRST MIDDLE" — convert to readable display format.
  function _parseFecName(nameStr) {
    if (!nameStr) return 'Unknown';
    const idx = nameStr.indexOf(', ');
    if (idx === -1) return nameStr;
    return `${nameStr.slice(idx + 2).trim()} ${nameStr.slice(0, idx).trim()}`.replace(/\s+/g, ' ').trim();
  }

  // When the incumbent's seat isn't up in 2026, fall back to a name search
  // to populate historical campaign finance data.
  async function _enrichHistoricalFinance(official, lastName, firstName, isSenator) {
    try {
      const res = await fetch(
        `${BASE}/candidates/search/?q=${encodeURIComponent(lastName)}&api_key=${CONFIG.FEC_API_KEY}&per_page=10`
      );
      if (!res.ok) return;
      const data = await res.json();
      const match = (data.results || []).find(c => {
        if (!c.name || !c.state || !c.office_full) return false;
        const cName = c.name.toLowerCase();
        return cName.includes(lastName.toLowerCase()) &&
               cName.includes(firstName.toLowerCase()) &&
               c.state === official.stateAbbr &&
               c.office_full === (isSenator ? 'Senate' : 'House');
      });
      if (!match) return;
      official.campaignFinance = {
        source: 'FEC',
        candidateId: match.candidate_id,
        party: match.party_full,
        office: match.office_full,
        state: match.state,
        totalRaised: match.receipts,
        totalSpent: match.disbursements,
        fecUrl: `https://www.fec.gov/data/candidate/${match.candidate_id}/`,
        _fetchedAt: Date.now(),
      };
      const electionYears = match.election_years || [];
      official.isRunning2026 =
        electionYears.includes(2026) ||
        (match.active_through != null && match.active_through >= 2026);
    } catch { /* silent fail */ }
  }

  async function enrich(official) {
    if (!CONFIG.FEC_API_KEY) return official;
    if (official.level !== 'Federal') return official;

    const isSenator = official.role?.includes('Senator');
    const nameParts = official.name.trim().split(/\s+/);
    const lastName  = nameParts[nameParts.length - 1];
    const firstName = nameParts[0];

    try {
      // Fetch all 2026 candidates for this state+office to find incumbent and challengers
      // in a single call. Sort by receipts so the most-funded appear first.
      const params = new URLSearchParams({
        api_key:       CONFIG.FEC_API_KEY,
        state:         official.stateAbbr,
        office:        isSenator ? 'S' : 'H',
        election_year: '2026',
        per_page:      '20',
        sort:          '-receipts',
      });

      if (!isSenator) {
        // "U.S. Representative, MA-7" → district = "07"
        const distMatch = (official.office || '').match(/(\d+)$/);
        if (distMatch) params.set('district', distMatch[1].padStart(2, '0'));
      }

      const res = await fetch(`${BASE}/candidates/?${params}`);
      if (res.status === 429) {
        official._dataErrors = official._dataErrors || [];
        official._dataErrors.push('Campaign finance temporarily unavailable (rate limit)');
        return official;
      }
      if (!res.ok) return official;

      const data = await res.json();
      const candidates = data.results || [];

      const match = candidates.find(c => {
        if (!c.name) return false;
        const cName = c.name.toLowerCase();
        return cName.includes(lastName.toLowerCase()) && cName.includes(firstName.toLowerCase());
      });

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
          _fetchedAt: Date.now(),
        };
        const electionYears = match.election_years || [];
        official.isRunning2026 =
          electionYears.includes(2026) ||
          (match.active_through != null && match.active_through >= 2026);

        const challengers = candidates
          .filter(c => c.candidate_id !== match.candidate_id)
          .map(c => ({
            name:        _parseFecName(c.name),
            party:       c.party_full || c.party || 'Unknown',
            totalRaised: c.receipts || 0,
            fecUrl:      `https://www.fec.gov/data/candidate/${c.candidate_id}/`,
          }));
        if (challengers.length) official.challengers = challengers;
      } else {
        // Incumbent's seat is not up in 2026 — get most recent finance data via name search.
        await _enrichHistoricalFinance(official, lastName, firstName, isSenator);
      }
    } catch {
      official._dataErrors = official._dataErrors || [];
      official._dataErrors.push('Campaign finance data temporarily unavailable');
    }
    return official;
  }

  return { enrich };
})();
