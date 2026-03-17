const UI = (() => {
  const PARTY_COLORS = {
    'Democratic Party': '#3490dc',
    'Republican Party': '#e3342f',
    'Green Party': '#38a169',
    'Libertarian Party': '#d69e2e',
    'Independent': '#718096',
    'Nonpartisan': '#718096',
  };

  const LEVEL_COLORS = {
    'Federal': '#1a365d',
    'State': '#234e52',
    'County': '#744210',
    'City/Town': '#1a202c',
    'District': '#322659',
    'Neighborhood': '#1a202c',
    'Special District': '#702459',
  };

  // Escape HTML special characters in any API-sourced string before inserting into innerHTML
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // Validate that a URL uses http/https before putting it in an href
  function safeUrl(url) {
    if (!url) return '#';
    try {
      const u = new URL(url);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? url : '#';
    } catch {
      return '#';
    }
  }

  function getPartyColor(party) {
    if (!party) return '#718096';
    for (const [key, color] of Object.entries(PARTY_COLORS)) {
      if (party.toLowerCase().includes(key.toLowerCase().split(' ')[0])) return color;
    }
    return '#718096';
  }

  function formatCurrency(n) {
    if (!n) return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }

  function socialIcon(channel) {
    const icons = {
      Facebook: '📘', Twitter: '🐦', YouTube: '▶️',
      Instagram: '📷', LinkedIn: '💼', GooglePlus: '🔴',
    };
    return icons[channel.type] || '🔗';
  }

  function renderChannels(channels) {
    if (!channels?.length) return '';
    return `<div class="channels">
      ${channels.map(c => {
        const baseUrls = {
          Facebook: `https://facebook.com/`,
          Twitter: `https://twitter.com/`,
          YouTube: `https://youtube.com/`,
          Instagram: `https://instagram.com/`,
        };
        const base = baseUrls[c.type];
        const url = base ? base + encodeURIComponent(c.id) : '#';
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="channel-link" title="${esc(c.type)}">${socialIcon(c)} ${esc(c.type)}</a>`;
      }).join('')}
    </div>`;
  }

  function renderVotingRecord(vr) {
    if (!vr) return '';
    return `
      <div class="detail-section">
        <h4>Voting Record <span class="source-badge">ProPublica</span></h4>
        <div class="stat-row">
          <span class="stat-label">Votes with Party</span>
          <span class="stat-value">${esc(vr.votesWithPartyPct ?? 'N/A')}%</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Missed Votes</span>
          <span class="stat-value">${esc(vr.missedVotesPct ?? 'N/A')}%</span>
        </div>
        ${vr.url ? `<a href="${safeUrl(vr.url)}" target="_blank" rel="noopener noreferrer" class="detail-link">Full profile →</a>` : ''}
      </div>`;
  }

  function renderSponsoredBills(bills) {
    if (!bills?.length) return '';
    return `
      <div class="detail-section">
        <h4>Recently Sponsored Legislation <span class="source-badge">Congress.gov</span></h4>
        <ul class="bills-list">
          ${bills.slice(0, 6).map(b => {
            const action = b.latestAction
              ? (b.latestAction.length > 100 ? b.latestAction.slice(0, 100) + '…' : b.latestAction)
              : '';
            return `
            <li class="bill-item">
              <a href="${safeUrl(b.url)}" target="_blank" rel="noopener noreferrer" class="bill-link">
                <span class="bill-number">${esc(b.label)}</span>
                ${b.title ? `<span class="bill-title">${esc(b.title)}</span>` : ''}
              </a>
              <div class="bill-meta">
                ${b.introducedDate ? `Introduced ${esc(b.introducedDate)}` : ''}
                ${action ? ` · ${esc(action)}` : ''}
              </div>
            </li>`;
          }).join('')}
        </ul>
        ${bills.length > 6 ? `<p class="bills-more">Showing 6 of ${bills.length} bills</p>` : ''}
      </div>`;
  }

  function renderOpenStatesProfile(url) {
    if (!url) return '';
    return `
      <div class="detail-section">
        <h4>State Legislature Profile <span class="source-badge">OpenStates</span></h4>
        <a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer" class="detail-link">View full profile, bills &amp; votes →</a>
      </div>`;
  }

  function renderCampaignFinance(cf) {
    if (!cf) return '';
    return `
      <div class="detail-section">
        <h4>Campaign Finance <span class="source-badge">FEC</span></h4>
        <div class="stat-row">
          <span class="stat-label">Total Raised</span>
          <span class="stat-value">${formatCurrency(cf.totalRaised)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Total Spent</span>
          <span class="stat-value">${formatCurrency(cf.totalSpent)}</span>
        </div>
        <a href="${safeUrl(cf.fecUrl)}" target="_blank" rel="noopener noreferrer" class="detail-link">View FEC filing →</a>
      </div>`;
  }

  function renderOfficialCard(official) {
    const partyColor = getPartyColor(official.party);
    const levelColor = LEVEL_COLORS[official.level] || '#1a202c';
    const hasDetails = official.votingRecord || official.campaignFinance
      || official.sponsoredBills || official.openStatesProfile;
    const cardId = `official-${Math.random().toString(36).slice(2)}`;

    const addressStr = official.address[0]
      ? [official.address[0].line1, official.address[0].city, official.address[0].state]
          .filter(Boolean).map(esc).join(', ')
      : '';

    // Initials for avatar fallback — safe since we only take first chars
    const initials = official.name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('');

    return `
    <div class="official-card" data-level="${esc(official.level)}">
      <div class="party-bar" style="background:${partyColor}"></div>
      <div class="card-body">
        <div class="card-header">
          ${official.photoUrl
            ? `<img src="${safeUrl(official.photoUrl)}" alt="${esc(official.name)}" class="official-photo" onerror="this.style.display='none'">`
            : `<div class="official-avatar" style="background:${partyColor}">${esc(initials)}</div>`
          }
          <div class="card-title">
            <h3>${esc(official.name)}</h3>
            <p class="office-name">${esc(official.office)}</p>
            <div class="badges">
              <span class="badge level-badge" style="background:${levelColor}">${esc(official.level)}</span>
              <span class="badge party-badge" style="background:${partyColor}">${esc(official.party || 'Unknown')}</span>
            </div>
          </div>
        </div>

        <div class="card-contact">
          ${official.phones.length ? `<div class="contact-item">📞 <a href="tel:${esc(official.phones[0])}">${esc(official.phones[0])}</a></div>` : ''}
          ${official.emails.length ? `<div class="contact-item">✉️ <a href="mailto:${esc(official.emails[0])}">${esc(official.emails[0])}</a></div>` : ''}
          ${official.urls.length ? `<div class="contact-item">🌐 <a href="${safeUrl(official.urls[0])}" target="_blank" rel="noopener noreferrer">Official Website</a></div>` : ''}
          ${addressStr ? `<div class="contact-item">📍 ${addressStr}</div>` : ''}
          ${renderChannels(official.channels)}
        </div>

        ${hasDetails ? `
          <button class="expand-btn" data-card-id="${cardId}">
            View Policy &amp; Finance Data ▾
          </button>
          <div id="${cardId}" class="card-details hidden">
            ${renderVotingRecord(official.votingRecord)}
            ${renderSponsoredBills(official.sponsoredBills)}
            ${renderCampaignFinance(official.campaignFinance)}
            ${renderOpenStatesProfile(official.openStatesProfile)}
          </div>
        ` : ''}
      </div>
    </div>`;
  }

  function toggleDetails(id) {
    const el = document.getElementById(id);
    const btn = el?.previousElementSibling;
    if (!el) return;
    el.classList.toggle('hidden');
    if (btn) btn.textContent = el.classList.contains('hidden')
      ? 'View Policy & Finance Data ▾'
      : 'Hide Details ▴';
  }

  function renderLocalOfficials(localData) {
    const container = document.getElementById('local-officials-section');
    if (!container) return;

    const { groups, resources, statePortal, city, state } = localData;

    container.innerHTML = `<div class="container">
      <div class="local-section-header">
        <h2 class="section-title">Local Officials</h2>
        <p class="section-subtitle">
          No free API covers city councils, school boards, and special districts —
          but these targeted searches and resources will take you straight to the right place for
          <strong>${esc(city)}, ${esc(state)}</strong>.
        </p>
      </div>

      <div class="local-groups-grid">
        ${groups.map(g => `
          <div class="local-group-card">
            <div class="local-group-header">
              <span class="local-group-icon">${g.icon}</span>
              <div>
                <h3 class="local-group-title">${esc(g.title)}</h3>
                <p class="local-group-desc">${esc(g.description)}</p>
              </div>
            </div>
            <div class="local-searches">
              ${g.searches.map(s => `
                <a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer" class="search-link">
                  <span class="ddg-icon">🔍</span> ${esc(s.label)}
                </a>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="local-resources">
        <h3 class="resources-title">Trusted Resources</h3>
        <div class="resources-grid">
          <div class="resource-card state-portal">
            <div class="resource-name">
              ${statePortal.verified ? '✅' : '🔍'} ${esc(statePortal.name)}
            </div>
            <a href="${safeUrl(statePortal.url)}" target="_blank" rel="noopener noreferrer" class="resource-link">
              ${statePortal.verified ? 'Visit official portal →' : 'Search →'}
            </a>
          </div>
          ${resources.map(r => `
            <div class="resource-card">
              <div class="resource-name">${esc(r.name)}</div>
              <div class="resource-desc">${esc(r.description)}</div>
              <a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer" class="resource-link">Visit →</a>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;

    container.classList.remove('hidden');
  }

  function renderResults(officials, zip, geo) {
    const resultsSection = document.getElementById('results');
    const zipDisplay = document.getElementById('zip-display');
    const grid = document.getElementById('officials-grid');
    const levelCounts = {};

    officials.forEach(o => { levelCounts[o.level] = (levelCounts[o.level] || 0) + 1; });

    // textContent is XSS-safe for zip display
    zipDisplay.textContent = zip;

    // Build filter tabs using data attributes — no inline JS handlers
    const tabs = document.getElementById('level-tabs');
    const levels = ['All', ...Object.keys(levelCounts)];
    tabs.innerHTML = levels.map((l, i) =>
      `<button class="tab-pill ${i === 0 ? 'active' : ''}" data-level="${esc(l)}">
        ${esc(l)} ${l === 'All' ? `(${officials.length})` : `(${levelCounts[l]})`}
      </button>`
    ).join('');

    // Attach filter click handlers via addEventListener (safe, no eval)
    tabs.querySelectorAll('.tab-pill').forEach(btn => {
      btn.addEventListener('click', () => filterByLevel(btn.dataset.level, btn));
    });

    // Render all cards
    grid.innerHTML = officials.map(renderOfficialCard).join('');

    // Attach expand button handlers via addEventListener
    grid.querySelectorAll('.expand-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleDetails(btn.dataset.cardId));
    });

    resultsSection.classList.remove('hidden');

    if (geo) {
      const localData = LocalOfficials.generate(geo);
      renderLocalOfficials(localData);
    }
  }

  function filterByLevel(level, btn) {
    document.querySelectorAll('.tab-pill').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.official-card').forEach(card => {
      card.style.display = (level === 'All' || card.dataset.level === level) ? '' : 'none';
    });
  }

  function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
  }

  function showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg; // textContent, not innerHTML — safe
    el.classList.remove('hidden');
  }

  function hideError() {
    document.getElementById('error-msg').classList.add('hidden');
  }

  function reset() {
    document.getElementById('results').classList.add('hidden');
    document.getElementById('officials-grid').innerHTML = '';
    const local = document.getElementById('local-officials-section');
    if (local) { local.classList.add('hidden'); local.innerHTML = ''; }
    hideError();
  }

  return { renderResults, renderLocalOfficials, filterByLevel, toggleDetails, showLoading, showError, hideError, reset };
})();
