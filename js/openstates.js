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
      openStatesProfile: `https://openstates.org/person/${person.id}/`,
    };
  }

  async function getOfficials(lat, lng) {
    const key = CONFIG.OPENSTATES_API_KEY;
    if (!key) return [];
    try {
      const res = await fetch(
        `${BASE}/people.geo?lat=${lat}&lng=${lng}&apikey=${key}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).map(normalizeOfficial);
    } catch {
      return [];
    }
  }

  return { getOfficials };
})();
