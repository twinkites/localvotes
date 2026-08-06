(async () => {
  const form              = document.getElementById('search-form');
  const input             = document.getElementById('zip-input');
  const geoBtn            = document.getElementById('geo-btn');
  const locationStatus    = document.getElementById('location-status');
  const locationLabel     = document.getElementById('location-label');
  const deleteLocationBtn = document.getElementById('delete-location-btn');
  const shareBtn       = document.getElementById('share-btn');
  const printBtn       = document.getElementById('print-btn');
  const cheatsheetBtn  = document.getElementById('cheatsheet-btn');

  // In-memory location state - never written to localStorage, cookies, or any server.
  // Nulled immediately when the user deletes location data or edits the ZIP manually.
  let _locationCoords = null;

  // Snapshot of the most recent search results, used to generate the sample ballot image.
  let _lastBallot = null;

  // Sample ballot card buttons are re-created on every render - delegate from a static ancestor.
  document.getElementById('sample-ballot-card').addEventListener('click', async e => {
    if (!_lastBallot) return;
    const { officials, zip, geo } = _lastBallot;

    if (e.target.closest('#ballot-card-download-btn')) {
      const btn = e.target.closest('#ballot-card-download-btn');
      const orig = btn.textContent;
      btn.textContent = 'Generating…';
      btn.disabled = true;
      try {
        await BallotCard.download(officials, zip, geo);
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
      }
    } else if (e.target.closest('#ballot-card-share-btn')) {
      const btn = e.target.closest('#ballot-card-share-btn');
      const orig = btn.textContent;
      btn.textContent = 'Preparing…';
      btn.disabled = true;
      try {
        await BallotCard.share(officials, zip, geo);
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
      }
    }
  });

  // This site is dedicated to the memory of June the cat. 🐈‍⬛

  // ── Help popup ───────────────────────────────────────────────────────────
  function _openHelp() {
    if (document.getElementById('help-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'help-modal';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.5)',
      zIndex: '9999',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
      opacity: '0', transition: 'opacity 0.25s ease',
    });

    overlay.innerHTML = `
      <div class="help-modal-inner">
        <button id="help-close" aria-label="Close help" class="help-modal-close">✕</button>
        <h2 class="help-modal-title">How to use LocalVotes</h2>
        <ul class="help-modal-list">
          <li><strong>Enter your ZIP code</strong> to find every elected official who represents you - from Congress down to your school committee.</li>
          <li><strong>Use my location</strong> to automatically detect your ZIP.</li>
          <li><strong>Filter by level</strong> using the tabs (Federal, State, County, etc.) to narrow results.</li>
          <li><strong>View Policy &amp; Finance Data</strong> on any card to see voting record, campaign finance, and sponsored legislation.</li>
          <li>Switch between <strong>Cards</strong> and <strong>Map</strong> view using the toggle above the results.</li>
          <li>Use the <strong>Share</strong> button to copy a link directly to your results.</li>
          <li>Know a missing official? Use <strong>Add an Official</strong> at the bottom of results.</li>
        </ul>
        <p class="help-modal-footer">
          All data comes from public government sources. No account or login required.
        </p>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    const close = () => {
      overlay.style.opacity = '0';
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    };

    document.getElementById('help-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, { once: true });
  }

  // Trigger via nav button
  document.getElementById('help-nav-btn').addEventListener('click', _openHelp);

  // Trigger via typing "help" (outside input fields)
  (() => {
    const SEQ = 'help';
    let _buf = '';
    document.addEventListener('keydown', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      _buf = (_buf + e.key.toLowerCase()).slice(-SEQ.length);
      if (_buf !== SEQ) return;
      _buf = '';
      _openHelp();
    });
  })();

  // ── Dark mode toggle ─────────────────────────────────────────────────────
  const themeToggle = document.getElementById('theme-toggle');
  function _updateThemeBtn() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeToggle.textContent = dark ? '☀️' : '🌙';
    themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  _updateThemeBtn();
  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('lv-theme', next);
    _updateThemeBtn();
  });
  // Keep in sync if system preference changes and user hasn't manually overridden
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('lv-theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      _updateThemeBtn();
    }
  });

  SubmitForm.init();

  // Register service worker for offline app-shell caching (silent fail).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Show/hide offline banner based on navigator.onLine.
  function _updateOfflineBanner() {
    const existing = document.getElementById('offline-banner');
    if (!navigator.onLine) {
      if (!existing) {
        const banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'offline-banner';
        banner.setAttribute('role', 'status');
        banner.textContent = '⚠ You appear to be offline. Live data is unavailable. Results shown may be from cache.';
        document.querySelector('.site-header')?.insertAdjacentElement('afterend', banner);
      }
    } else {
      existing?.remove();
    }
  }
  window.addEventListener('online',  _updateOfflineBanner);
  window.addEventListener('offline', _updateOfflineBanner);
  _updateOfflineBanner();

  // View toggle - wire once; MapView keeps track of state
  document.getElementById('btn-cards').addEventListener('click', () => MapView.showCards());
  document.getElementById('btn-map').addEventListener('click',   () => MapView.show());

  // Share button - native share on mobile, clipboard fallback on desktop
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

  cheatsheetBtn?.addEventListener('click', () => {
    document.documentElement.setAttribute('data-print-mode', 'cheatsheet');
    window.print();
    // Remove after print dialog closes (or immediately on cancel).
    window.addEventListener('afterprint', () => {
      document.documentElement.removeAttribute('data-print-mode');
    }, { once: true });
  });

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
          // Hold coords in memory - this is the only place they are ever stored
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
    _lastBallot = null;
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
    _lastBallot = null;
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

    // Step 3: Fetch the fast primary sources in parallel and render as soon as they land.
    // Statewide executives (Wikidata SPARQL) and per-official enrichment (FEC/Congress/
    // OpenStates bills) are comparatively slow and non-essential for first paint, so they
    // run separately in the background and trigger a re-render when they finish (Step 5).
    // Google Civic API expects city-first format: "City, ST ZIP"
    const address = `${geo.city}, ${geo.stateAbbr} ${zip}`;
    const [
      federalOfficials,
      stateOfficials,
      schoolBoardOfficials,
      cityCouncilOfficials,
      voterInfo,
    ] = await Promise.all([
      FederalAPI.getOfficials(geo.stateAbbr, district),
      OpenStatesAPI.getOfficials(geo.lat, geo.lng),
      SchoolBoards.lookup(geo.city, geo.stateAbbr),
      CityCouncil.lookup(geo.city, geo.stateAbbr),
      CivicInfo.getVoterInfo(address, geo.stateAbbr),
    ]);

    // Surface OpenStates rate-limit warnings early so the user knows data is incomplete.
    const openStatesError = OpenStatesAPI.getLastError();
    if (openStatesError?.type === 'rate_limit') {
      UI.showError(openStatesError.message);
    }

    const officials = [...federalOfficials, ...stateOfficials, ...schoolBoardOfficials, ...cityCouncilOfficials];

    SubmitForm.setZip(zip);
    UI.showLoading(false);

    if (officials.length === 0) {
      UI.showError(
        `No officials found for ZIP ${zip}. ` +
        `The data sources may be temporarily unavailable - please try again in a moment.`
      );
      return;
    }

    // Step 4: First paint - render immediately with what we have so far.
    _renderAll(officials, zip, geo, district, voterInfo);
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });

    // Step 5: Background enrichment - statewide execs (Wikidata) and per-official
    // FEC/Congress/OpenStates data. Officials are enriched in place, so once both
    // finish we just re-render with the same (now-fuller) array. Neither blocks first paint.
    const statewidePromise = StatewideAPI.getOfficials(geo.stateAbbr).then(statewideOfficials => {
      if (statewideOfficials.length) officials.splice(federalOfficials.length, 0, ...statewideOfficials);
    });
    const enrichPromise = Promise.all(officials.map(o => Promise.all([
      FECAPI.enrich(o),
      CongressAPI.enrich(o),
      OpenStatesAPI.enrich(o),
    ])));

    Promise.all([statewidePromise, enrichPromise]).then(() => {
      const activeLevel = document.querySelector('.tab-pill.active')?.dataset.level;
      _renderAll(officials, zip, geo, district, voterInfo);
      if (activeLevel && activeLevel !== 'All') {
        const btn = document.querySelector(`.tab-pill[data-level="${CSS.escape(activeLevel)}"]`);
        if (btn) UI.filterByLevel(activeLevel, btn);
      }
    });
  }

  function _renderAll(officials, zip, geo, district, voterInfo) {
    UI.renderResults(officials, zip, geo);
    UI.renderDistrictPanel(geo);
    const currentOfficials = officials.filter(o => !o.historical);
    UI.renderSampleBallot(currentOfficials, zip, geo);
    _lastBallot = { officials: currentOfficials, zip, geo };
    UI.renderCivicTools(geo, voterInfo);

    // Render ballot measures if the Google Civic API returned any
    const ballotMeasures = CivicInfo.extractBallotMeasures(voterInfo);
    if (ballotMeasures.length) UI.renderBallotMeasures(ballotMeasures);

    // Render down-ballot candidate contests (county, judicial, school board, etc.)
    const candidateContests = CivicInfo.extractCandidateContests(voterInfo);
    if (candidateContests.length) UI.renderCandidateContests(candidateContests);

    _updateMeta(geo.city, geo.stateAbbr, zip);
    MapView.init(currentOfficials, geo, district);
  }

  function _updateMeta(city, stateAbbr, zip) {
    const t = `ZIP ${zip} - ${city}, ${stateAbbr} Representatives | LocalVotes`;
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
