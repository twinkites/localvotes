const OpenStatesAPI = (() => {
  const BASE = 'https://v3.openstates.org';

  const PARTY_MAP = {
    'Democratic': 'Democratic Party',
    'Republican': 'Republican Party',
    'Green': 'Green Party',
    'Libertarian': 'Libertarian Party',
    'Independent': 'Independent',
    'Nonpartisan': 'Nonpartisan',
  };

  // Exposed so app.js can surface a user-facing notice when a rate limit is hit.
  let _lastError = null;

  function normalizeOfficial(person) {
    const role = person.current_role || {};
    const chamber = role.org_classification || '';
    const partyRaw = (person.party || '').trim();
    const party = PARTY_MAP[partyRaw] || partyRaw || 'Unknown';

    const officeLabel = chamber === 'upper'
      ? `State Senator${role.district ? `, District ${role.district}` : ''}`
      : chamber === 'lower'
      ? `State Representative${role.district ? `, District ${role.district}` : ''}`
      : role.title || 'State Official';

    const urls = (person.links || []).map(l => l.url);
    const phones = [];
    const emails = [];
    const address = [];

    (person.contact_details || []).forEach(c => {
      if (c.type === 'voice') phones.push(c.value);
      if (c.type === 'email') emails.push(c.value);
      if (c.type === 'address') address.push({ line1: c.value });
    });

    // Extract two-letter state abbreviation from the OCD jurisdiction ID
    // e.g. "ocd-jurisdiction/country:us/state:ca/government" → "CA"
    const stateAbbr = (person.current_role?.jurisdiction_id || '')
      .match(/state:([a-z]{2})/)?.[1]?.toUpperCase() || '';

    return {
      name: person.name,
      office: officeLabel,
      historical: !person.current_role,
      level: 'State',
      levelRaw: 'administrativeArea1',
      stateAbbr,
      role: chamber === 'upper' ? 'Senator / Upper Chamber' : 'Representative / Lower Chamber',
      party,
      phones,
      urls,
      emails,
      photoUrl: person.image || null,
      address,
      channels: [],
      openStatesProfile: `https://ballotpedia.org/${encodeURIComponent(person.name.trim().replace(/\s+/g, '_'))}`,
      openStatesId: person.id || null,
      _fetchedAt: Date.now(),
    };
  }

  async function getOfficials(lat, lng) {
    _lastError = null;
    const key = CONFIG.OPENSTATES_API_KEY;
    if (!key) return [];
    try {
      const res = await fetch(
        `${BASE}/people.geo?lat=${lat}&lng=${lng}&apikey=${key}`
      );
      if (res.status === 429) {
        _lastError = {
          type: 'rate_limit',
          message: 'OpenStates rate limit reached. State legislator data is temporarily unavailable — please wait a moment and try again.',
        };
        return [];
      }
      if (!res.ok) {
        _lastError = { type: 'api_error', message: 'State legislator data temporarily unavailable.' };
        return [];
      }
      const data = await res.json();
      return (data.results || []).map(normalizeOfficial);
    } catch {
      _lastError = { type: 'network_error', message: 'Could not reach OpenStates. Check your connection and try again.' };
      return [];
    }
  }

  function getLastError() { return _lastError; }

  // Fetch recently sponsored bills for a state legislator via the OpenStates bills endpoint.
  async function enrich(official) {
    if (official.level !== 'State' || !official.openStatesId) return official;
    const key = CONFIG.OPENSTATES_API_KEY;
    if (!key) return official;
    try {
      const res = await fetch(
        `${BASE}/bills?sponsor=${encodeURIComponent(official.openStatesId)}&sort=updated_at&per_page=5&apikey=${key}`
      );
      if (!res.ok) return official;
      const data = await res.json();
      const bills = (data.results || []).map(b => ({
        label:        b.identifier,
        title:        b.title,
        url:          b.openstates_url || b.sources?.[0]?.url || '',
        introducedDate: b.first_action_date ? b.first_action_date.slice(0, 10) : '',
        latestAction: b.latest_action_description || '',
      }));
      if (bills.length) official.stateBills = bills;
    } catch { /* silent fail */ }
    return official;
  }

  return { getOfficials, getLastError, enrich };
})();
