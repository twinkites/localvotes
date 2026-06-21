// civic-info.js — Google Civic Information API integration.
// Provides live polling place lookup and ballot measure data.
// Requires CONFIG.GOOGLE_CIVIC_API_KEY (free — register at https://console.cloud.google.com/).

const CivicInfo = (() => {
  const BASE = 'https://www.googleapis.com/civicinfo/v2';

  // Session-scoped cache for the elections list — one fetch per session.
  let _electionsCache = null;

  async function _getElections() {
    if (_electionsCache !== null) return _electionsCache;
    const key = CONFIG.GOOGLE_CIVIC_API_KEY;
    if (!key) { _electionsCache = []; return []; }
    try {
      const res = await fetch(`${BASE}/elections?key=${encodeURIComponent(key)}`);
      if (!res.ok) { _electionsCache = []; return []; }
      const data = await res.json();
      _electionsCache = data.elections || [];
      return _electionsCache;
    } catch {
      _electionsCache = [];
      return [];
    }
  }

  // Returns the most relevant upcoming election for the given state, or null.
  async function _findElection(stateAbbr) {
    const elections = await _getElections();
    const sc = stateAbbr.toLowerCase();
    const now = Date.now();

    // Prefer state-specific elections; fall back to federal (ocd-division/country:us).
    const ranked = elections
      .filter(e => e.electionDay)
      .map(e => ({
        e,
        ms: new Date(e.electionDay).getTime(),
        isState: (e.ocdDivisionId || '').includes(`state:${sc}`),
        isFederal: (e.ocdDivisionId || '') === 'ocd-division/country:us',
      }))
      .filter(({ ms }) => ms >= now)
      .sort((a, b) => {
        // State-specific elections rank above federal for the same date.
        if (a.ms !== b.ms) return a.ms - b.ms;
        return (b.isState ? 1 : 0) - (a.isState ? 1 : 0);
      });

    return ranked[0]?.e || null;
  }

  // Fetches voter info for the given address and state.
  // Returns the raw Google Civic API voterinfo response, or null on failure.
  async function getVoterInfo(address, stateAbbr) {
    const key = CONFIG.GOOGLE_CIVIC_API_KEY;
    if (!key) return null;
    try {
      const election = await _findElection(stateAbbr);
      if (!election) return null;

      const params = new URLSearchParams({
        key,
        address,
        electionId: election.id,
        officialOnly: 'false',
      });
      const res = await fetch(`${BASE}/voterinfo?${params}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // Extracts the primary polling location from a voterinfo response.
  function extractPollingPlace(voterInfo) {
    if (!voterInfo) return null;
    const locs = voterInfo.pollingLocations || [];
    if (!locs.length) return null;
    const loc = locs[0];
    return {
      name:    loc.address?.locationName || 'Polling Location',
      line1:   loc.address?.line1 || '',
      city:    loc.address?.city || '',
      state:   loc.address?.state || '',
      zip:     loc.address?.zip || '',
      hours:   loc.pollingHours || '',
      notes:   loc.notes || '',
      sources: (loc.sources || []).map(s => s.name).filter(Boolean),
    };
  }

  // Extracts early vote sites from a voterinfo response.
  function extractEarlyVoting(voterInfo) {
    if (!voterInfo) return [];
    return (voterInfo.earlyVoteSites || []).map(s => ({
      name:      s.address?.locationName || 'Early Vote Site',
      line1:     s.address?.line1 || '',
      city:      s.address?.city || '',
      state:     s.address?.state || '',
      zip:       s.address?.zip || '',
      hours:     s.pollingHours || '',
      startDate: s.startDate || '',
      endDate:   s.endDate || '',
    }));
  }

  // Extracts ballot measures (referendums) from a voterinfo response.
  function extractBallotMeasures(voterInfo) {
    if (!voterInfo) return [];
    return (voterInfo.contests || [])
      .filter(c => c.type === 'Referendum')
      .map(c => ({
        title:       c.referendumTitle || c.name || '',
        subtitle:    c.referendumSubtitle || '',
        description: c.referendumBrief || c.referendumText || '',
        url:         c.referendumUrl || null,
        ballotTitle: c.ballotTitle || '',
        district:    c.district?.name || '',
      }));
  }

  // Returns the election name from a voterinfo response.
  function extractElectionName(voterInfo) {
    return voterInfo?.election?.name || null;
  }

  return { getVoterInfo, extractPollingPlace, extractEarlyVoting, extractBallotMeasures, extractElectionName };
})();
