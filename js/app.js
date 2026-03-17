(async () => {
  const form = document.getElementById('search-form');
  const input = document.getElementById('zip-input');

  SubmitForm.init();

  // View toggle — wire once; MapView keeps track of state
  document.getElementById('btn-cards').addEventListener('click', () => MapView.showCards());
  document.getElementById('btn-map').addEventListener('click',   () => MapView.show());

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const zip = input.value.trim();
    if (!/^\d{5}$/.test(zip)) {
      UI.showError('Please enter a valid 5-digit ZIP code.');
      return;
    }
    // Push ZIP to URL so the result is bookmarkable/shareable
    history.pushState({ zip }, '', `?zip=${zip}`);
    await search(zip);
  });

  document.getElementById('search-again').addEventListener('click', e => {
    e.preventDefault();
    history.pushState({}, '', window.location.pathname);
    UI.reset();
    input.value = '';
    document.getElementById('search-section').scrollIntoView({ behavior: 'smooth' });
    input.focus();
  });

  // Support browser back/forward
  window.addEventListener('popstate', async e => {
    const zip = e.state?.zip || new URLSearchParams(location.search).get('zip');
    if (zip && /^\d{5}$/.test(zip)) {
      input.value = zip;
      await search(zip);
    } else {
      UI.reset();
      input.value = '';
    }
  });

  async function search(zip) {
    UI.hideError();
    UI.reset();
    MapView.reset();
    UI.showLoading(true);

    // Step 1: ZIP → lat/lng/state (required)
    let geo;
    try {
      geo = await GeoAPI.lookupZip(zip);
    } catch (err) {
      UI.showLoading(false);
      UI.showError(err.message);
      return;
    }

    // Step 2: Congressional district (for House rep lookup)
    const district = await GeoAPI.getCongressionalDistrict(geo.lat, geo.lng);

    // Step 3: Fetch federal + state officials in parallel
    const [federalOfficials, stateOfficials] = await Promise.all([
      FederalAPI.getOfficials(geo.stateAbbr, district),
      OpenStatesAPI.getOfficials(geo.lat, geo.lng),
    ]);

    const officials = [...federalOfficials, ...stateOfficials];

    // Step 4: Enrich with secondary data sources in parallel (all silent-fail)
    await Promise.all(officials.map(o => Promise.all([
      FECAPI.enrich(o),
      CongressAPI.enrich(o),
    ])));

    SubmitForm.setZip(zip);
    UI.showLoading(false);

    if (officials.length === 0) {
      UI.showError(
        `No officials found for ZIP ${zip}. ` +
        `The data sources may be temporarily unavailable — please try again in a moment.`
      );
      return;
    }

    UI.renderResults(officials, zip, geo);
    MapView.init(officials, geo);
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
  }

  // On page load, run search if ?zip= is in the URL
  const initialZip = new URLSearchParams(location.search).get('zip');
  if (initialZip && /^\d{5}$/.test(initialZip)) {
    input.value = initialZip;
    await search(initialZip);
  }
})();
