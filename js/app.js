(async () => {
  const form              = document.getElementById('search-form');
  const input             = document.getElementById('zip-input');
  const geoBtn            = document.getElementById('geo-btn');
  const locationStatus    = document.getElementById('location-status');
  const locationLabel     = document.getElementById('location-label');
  const deleteLocationBtn = document.getElementById('delete-location-btn');
  const shareBtn = document.getElementById('share-btn');
  const printBtn = document.getElementById('print-btn');

  // In-memory location state — never written to localStorage, cookies, or any server.
  // Nulled immediately when the user deletes location data or edits the ZIP manually.
  let _locationCoords = null;

  SubmitForm.init();

  // View toggle — wire once; MapView keeps track of state
  document.getElementById('btn-cards').addEventListener('click', () => MapView.showCards());
  document.getElementById('btn-map').addEventListener('click',   () => MapView.show());

  // Share button — native share on mobile, clipboard fallback on desktop
  shareBtn?.addEventListener('click', async () => {
    const url  = location.href;
    const title = document.title;
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        const orig = shareBtn.textContent;
        shareBtn.textContent = 'Copied!';
        setTimeout(() => { shareBtn.textContent = orig; }, 2000);
      } catch {
        prompt('Copy this link to share:', url);
      }
    }
  });

  printBtn?.addEventListener('click', () => window.print());

  // ── Geolocation ─────────────────────────────────────────────────────────

  geoBtn.addEventListener('click', async () => {
    if (!('geolocation' in navigator)) {
      UI.showError('Geolocation is not available in your browser. Please type your ZIP code.');
      return;
    }
    geoBtn.disabled = true;
    geoBtn.innerHTML = '<span aria-hidden="true">📍</span> Locating…';
    UI.hideError();

    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        try {
          const result = await GeoAPI.reverseGeocodeToZip(lat, lng);
          if (!result) throw new Error(
            'Could not determine your ZIP code from your location. Please type it instead.'
          );
          // Hold coords in memory — this is the only place they are ever stored
          _locationCoords = { lat, lng };
          input.value = result.zip;
          locationLabel.textContent = `Near ${result.city}, ${result.state}`;
          locationStatus.classList.remove('hidden');
          history.pushState({ zip: result.zip }, '', `?zip=${result.zip}`);
          await search(result.zip);
        } catch (err) {
          _locationCoords = null;
          UI.showError(err.message);
        } finally {
          geoBtn.disabled = false;
          geoBtn.innerHTML = '<span aria-hidden="true">📍</span> Use my location';
        }
      },
      (err) => {
        _locationCoords = null;
        geoBtn.disabled = false;
        geoBtn.innerHTML = '<span aria-hidden="true">📍</span> Use my location';
        UI.showError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access was denied. Please type your ZIP code instead.'
            : 'Could not get your location. Please type your ZIP code instead.'
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });

  // Clicking "Delete location data" nulls the in-memory coords and resets everything
  deleteLocationBtn.addEventListener('click', () => {
    _locationCoords = null;
    input.value = '';
    locationStatus.classList.add('hidden');
    UI.reset();
    MapView.reset();
    history.pushState({}, '', window.location.pathname);
  });

  // If the user manually edits the ZIP, the geolocation is no longer in effect
  input.addEventListener('input', () => {
    if (_locationCoords) {
      _locationCoords = null;
      locationStatus.classList.add('hidden');
    }
  });

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
    _locationCoords = null;
    locationStatus.classList.add('hidden');
    history.pushState({}, '', window.location.pathname);
    UI.reset();
    MapView.reset();
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

    // Step 2: Geographic context (congressional district, county)
    const geoCtx  = await GeoAPI.getGeoContext(geo.lat, geo.lng);
    const district = geoCtx.congressionalDistrict;
    Object.assign(geo, geoCtx);

    // Step 3: Fetch federal, state, statewide executive, and school board officials in parallel
    const [federalOfficials, stateOfficials, statewideOfficials, schoolBoardOfficials] = await Promise.all([
      FederalAPI.getOfficials(geo.stateAbbr, district),
      OpenStatesAPI.getOfficials(geo.lat, geo.lng),
      StatewideAPI.getOfficials(geo.stateAbbr),
      SchoolBoards.lookup(geo.city, geo.stateAbbr),
    ]);

    const officials = [...federalOfficials, ...statewideOfficials, ...stateOfficials, ...schoolBoardOfficials];

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
    UI.renderDistrictPanel(geo);
    UI.renderCivicTools(geo);
    _updateMeta(geo.city, geo.stateAbbr, zip);
    MapView.init(officials, geo, district);
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
  }

  function _updateMeta(city, stateAbbr, zip) {
    const t = `ZIP ${zip} — ${city}, ${stateAbbr} Representatives | LocalVotes`;
    const d = `Every elected official for ZIP ${zip} (${city}, ${stateAbbr}): Congress, state, governor, school board, and more.`;
    document.title = t;
    [
      ['meta[property="og:title"]',        'content', t],
      ['meta[property="og:description"]',  'content', d],
      ['meta[property="og:url"]',          'content', location.href],
      ['meta[name="twitter:title"]',       'content', t],
      ['meta[name="twitter:description"]', 'content', d],
    ].forEach(([sel, attr, val]) =>
      document.querySelector(sel)?.setAttribute(attr, val)
    );
  }

  // On page load, run search if ?zip= is in the URL
  const initialZip = new URLSearchParams(location.search).get('zip');
  if (initialZip && /^\d{5}$/.test(initialZip)) {
    input.value = initialZip;
    await search(initialZip);
  }
})();
