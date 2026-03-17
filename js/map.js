const MapView = (() => {
  let _map              = null;
  let _marker           = null;
  let _officials        = [];
  let _geo              = null;
  let _boundaryLayers   = [];   // active Leaflet GeoJSON layers
  let _boundaryData     = null; // Promise resolving to { congressional, school }

  // State abbreviation → 2-digit FIPS code (for TIGERweb queries)
  const STATE_FIPS = {
    AL:'01', AK:'02', AZ:'04', AR:'05', CA:'06', CO:'08', CT:'09',
    DE:'10', DC:'11', FL:'12', GA:'13', HI:'15', ID:'16', IL:'17',
    IN:'18', IA:'19', KS:'20', KY:'21', LA:'22', ME:'23', MD:'24',
    MA:'25', MI:'26', MN:'27', MS:'28', MO:'29', MT:'30', NE:'31',
    NV:'32', NH:'33', NJ:'34', NM:'35', NY:'36', NC:'37', ND:'38',
    OH:'39', OK:'40', OR:'41', PA:'42', RI:'44', SC:'45', SD:'46',
    TN:'47', TX:'48', UT:'49', VT:'50', VA:'51', WA:'53', WV:'54',
    WI:'55', WY:'56',
  };

  const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer';

  // Called after every successful search. Destroys the old map and pre-fetches
  // district boundaries in the background so they're ready when show() is called.
  function init(officials, geo, congressionalDistrict) {
    _officials = officials;
    _geo       = geo;

    if (_map) {
      _map.remove();
      _map            = null;
      _marker         = null;
      _boundaryLayers = [];
    }

    // Start boundary fetch immediately so it can overlap with rendering time
    _boundaryData = _fetchBoundaries(geo, congressionalDistrict);
  }

  // Switch to map view.
  function show() {
    _setToggle('map');
    document.getElementById('map-container').classList.remove('hidden');
    document.getElementById('officials-grid').classList.add('hidden');
    document.querySelector('.filter-bar').classList.add('hidden');

    if (!_geo) return;

    // Defer one tick so the browser reflows the container (display:none → block)
    // before Leaflet reads its dimensions.
    setTimeout(async () => {
      if (!_map) {
        _map = L.map('map-container', { zoomControl: true })
                 .setView([_geo.lat, _geo.lng], 11);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
            'target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(_map);

        _marker = L.marker([_geo.lat, _geo.lng])
          .addTo(_map)
          .bindPopup(_buildPopup(), {
            maxWidth:  340,
            className: 'reps-popup',
            autoPan:   true,
          });

        _marker.on('mouseover', () => _marker.openPopup());
        _marker.openPopup();

        // Add district boundary layers — await the pre-fetched promise
        const boundaries = await _boundaryData;
        _addBoundaryLayers(boundaries);
      } else {
        _map.invalidateSize();
        _marker.openPopup();
      }
    }, 0);
  }

  // Switch back to card view.
  function showCards() {
    _setToggle('cards');
    document.getElementById('map-container').classList.add('hidden');
    document.getElementById('officials-grid').classList.remove('hidden');
    document.querySelector('.filter-bar').classList.remove('hidden');
  }

  // Full reset between searches.
  function reset() {
    showCards();
    if (_map) {
      _map.remove();
      _map            = null;
      _marker         = null;
      _boundaryLayers = [];
    }
    _officials    = [];
    _geo          = null;
    _boundaryData = null;
  }

  // ── District boundaries ────────────────────────────────────────────────────

  async function _fetchBoundaries(geo, congressionalDistrict) {
    const fips = STATE_FIPS[geo?.stateAbbr];
    if (!fips) return { congressional: null, school: null };

    const [cong, school] = await Promise.allSettled([
      _fetchCongressionalDistrict(fips, congressionalDistrict),
      _fetchSchoolDistrict(geo.lat, geo.lng),
    ]);

    return {
      congressional: cong.status   === 'fulfilled' ? cong.value   : null,
      school:        school.status === 'fulfilled' ? school.value : null,
    };
  }

  // Query TIGERweb for the user's congressional district polygon by GEOID.
  // Tries likely layer IDs in order — silently skips layers that return no data.
  async function _fetchCongressionalDistrict(stateFips, district) {
    if (!district) return null;
    const geoid = stateFips + String(district).padStart(2, '0');

    for (const layer of [54, 8, 6]) {
      try {
        const params = new URLSearchParams({
          where:          `GEOID='${geoid}'`,
          outFields:      'NAMELSAD,GEOID',
          returnGeometry: 'true',
          outSR:          '4326',
          f:              'geojson',
        });
        const res = await fetch(`${TIGERWEB}/${layer}/query?${params}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.features?.length) return data;
      } catch { continue; }
    }
    return null;
  }

  // Query TIGERweb for the school district polygon containing the given point.
  async function _fetchSchoolDistrict(lat, lng) {
    for (const layer of [14, 16, 18]) {
      try {
        const params = new URLSearchParams({
          geometry:       `${lng},${lat}`,
          geometryType:   'esriGeometryPoint',
          inSR:           '4326',
          spatialRel:     'esriSpatialRelIntersects',
          outFields:      'NAME,GEOID',
          returnGeometry: 'true',
          outSR:          '4326',
          f:              'geojson',
        });
        const res = await fetch(`${TIGERWEB}/${layer}/query?${params}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.features?.length) return data;
      } catch { continue; }
    }
    return null;
  }

  function _addBoundaryLayers(boundaries) {
    if (!_map || !boundaries) return;

    if (boundaries.congressional) {
      const label = boundaries.congressional.features[0]?.properties?.NAMELSAD || 'Congressional District';
      const layer = L.geoJSON(boundaries.congressional, {
        style: {
          color:       '#1a56db',
          weight:      2,
          opacity:     0.8,
          dashArray:   '7 5',
          fillColor:   '#1a56db',
          fillOpacity: 0.06,
        },
      }).bindTooltip(label, { sticky: true, className: 'boundary-tooltip' });
      layer.addTo(_map);
      _boundaryLayers.push(layer);
    }

    if (boundaries.school) {
      const label = boundaries.school.features[0]?.properties?.NAME || 'School District';
      const layer = L.geoJSON(boundaries.school, {
        style: {
          color:       '#276749',
          weight:      1.5,
          opacity:     0.7,
          dashArray:   '4 4',
          fillColor:   '#276749',
          fillOpacity: 0.04,
        },
      }).bindTooltip(label, { sticky: true, className: 'boundary-tooltip' });
      layer.addTo(_map);
      _boundaryLayers.push(layer);
    }
  }

  // ── Popup ──────────────────────────────────────────────────────────────────

  function _buildPopup() {
    if (!_officials.length) return '<p style="padding:8px">No officials found.</p>';

    const LEVEL_ORDER = ['Federal', 'State', 'County', 'City/Town', 'District', 'Special District', 'School Board'];

    const byLevel = {};
    _officials.forEach(o => {
      const lvl = o.level || 'Other';
      if (!byLevel[lvl]) byLevel[lvl] = [];
      byLevel[lvl].push(o);
    });

    const levels = [
      ...LEVEL_ORDER.filter(l => byLevel[l]),
      ...Object.keys(byLevel).filter(l => !LEVEL_ORDER.includes(l)),
    ];

    const total = _officials.length;
    let html = `<div class="rp-inner">`;
    html += `<div class="rp-header">
      <strong>${_esc(_geo.city)}, ${_esc(_geo.state)}</strong>
      <span class="rp-count">${total} rep${total !== 1 ? 's' : ''}</span>
    </div>`;

    for (const level of levels) {
      html += `<p class="rp-level">${_esc(level)}</p><ul class="rp-list">`;
      for (const o of byLevel[level]) {
        const partyDot = _partyColor(o.party);
        html += `<li>
          <span class="rp-dot" style="background:${partyDot}"></span>
          <span class="rp-name">${_esc(o.name)}</span>
          <span class="rp-office">${_esc(o.office)}</span>
        </li>`;
      }
      html += `</ul>`;
    }

    html += `</div>`;
    return html;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _setToggle(active) {
    const btnCards = document.getElementById('btn-cards');
    const btnMap   = document.getElementById('btn-map');
    if (!btnCards || !btnMap) return;
    btnCards.classList.toggle('active', active === 'cards');
    btnCards.setAttribute('aria-pressed', String(active === 'cards'));
    btnMap.classList.toggle('active', active === 'map');
    btnMap.setAttribute('aria-pressed', String(active === 'map'));
  }

  function _partyColor(party) {
    if (!party) return '#718096';
    const p = party.toLowerCase();
    if (p.includes('democrat'))   return '#3490dc';
    if (p.includes('republican')) return '#e3342f';
    if (p.includes('green'))      return '#38a169';
    if (p.includes('libertarian'))return '#d69e2e';
    return '#718096';
  }

  function _esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, show, showCards, reset };
})();
