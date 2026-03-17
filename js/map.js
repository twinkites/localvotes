const MapView = (() => {
  let _map    = null;
  let _marker = null;
  let _officials = [];
  let _geo       = null;

  // Called after every successful search to store fresh data.
  // Destroys any existing map so the next show() re-creates it at the new location.
  function init(officials, geo) {
    _officials = officials;
    _geo       = geo;
    if (_map) {
      _map.remove();
      _map    = null;
      _marker = null;
    }
  }

  // Switch to map view.
  function show() {
    _setToggle('map');
    document.getElementById('map-container').classList.remove('hidden');
    document.getElementById('officials-grid').classList.add('hidden');
    document.querySelector('.filter-bar').classList.add('hidden');

    if (!_geo) return;

    // Defer one tick so the browser reflows the container after removing
    // 'hidden' (display:none → block). Leaflet reads offsetWidth/Height on
    // init — if it runs before reflow it gets 0×0 and renders nothing.
    setTimeout(() => {
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

        // Open on hover (desktop); stays open until user closes it
        _marker.on('mouseover', () => _marker.openPopup());
        _marker.openPopup();
      } else {
        // Map already built — just re-size (was hidden) and reopen popup
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
      _map    = null;
      _marker = null;
    }
    _officials = [];
    _geo       = null;
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

  function _buildPopup() {
    if (!_officials.length) return '<p style="padding:8px">No officials found.</p>';

    const LEVEL_ORDER = ['Federal', 'State', 'County', 'City/Town', 'District', 'Special District'];

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

  function _partyColor(party) {
    if (!party) return '#718096';
    const p = party.toLowerCase();
    if (p.includes('democrat')) return '#3490dc';
    if (p.includes('republican')) return '#e3342f';
    if (p.includes('green')) return '#38a169';
    if (p.includes('libertarian')) return '#d69e2e';
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
