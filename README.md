# LocalVotes

**Know who represents you.**

LocalVotes is a fully static, client-side web app that looks up every elected official for any US ZIP code — from US Senators down to state legislators. For city councils, school boards, and special districts (which have no free API), it generates targeted search links and curated resources. No server required. No tracking. No ads.

We want to provide information to all voters. A project of Twin Kites LLC. 

Always available and sharable at: https://twinkites.github.io/localvotes

---

## What it does

- Enter a 5-digit ZIP code and see elected officials at the Federal and State levels.

- Filter results by government level using the pill tabs.

- Each official card shows name, office, party affiliation, phone, email, official website, and social media links.

- Federal legislators show ProPublica voting-record stats (party-line %, missed votes) and Congress.gov sponsored legislation when API keys are configured.

- State legislators include a direct link to their OpenStates profile (bills, votes, full bio).

- FEC campaign finance data (total raised/spent) is shown when available.

- A "Local Officials" section generates pre-filled search links for city council, school board, county government, sheriff, and special districts, plus links to verified national civic resources.

- Users can submit missing local officials via the built-in form (saved to Google Sheets).

- Results are bookmarkable — searches update the URL (`?zip=10001`) for sharing, posting to social media, etc.

- Features are added as available by a single developer (me), please be kind.

  

---

## Data sources

| Source | Coverage | Notes |
|--------|----------|-------|
| [api.zippopotam.us](https://api.zippopotam.us) | ZIP → lat/lng/state | Free, no key |
| [ProPublica Congress API](https://projects.propublica.org/api-docs/congress-api/) | Federal senators + House reps | Free, key recommended |
| [US Census Geocoder](https://geocoding.geo.census.gov) | Congressional district from coordinates | Free, no key |
| [OpenStates API](https://openstates.org/api/) | State legislators by location | Free (500 req/day), key required |
| [FEC API](https://api.open.fec.gov) | Federal campaign finance | Free, key required |
| [Congress.gov API](https://api.congress.gov) | Sponsored legislation | Free, key required |
| DuckDuckGo search links | Local officials (city, school board, etc.) | No API — targeted search links |

LocalVotes is an independent project not affiliated with any government agency. Always verify information through official government websites. No warrenty express or implied. 

---

## Project structure

```
localvotes/
├── .github/workflows/deploy.yml  # GitHub Actions deployment
├── index.html                    # Single-page app shell
├── config.example.js             # API key template (for your reference)
├── css/
│   └── style.css                 # All styles — mobile-first, CSS custom properties
└── js/
    ├── app.js           # Main controller — orchestrates search and enrichment
    ├── geo.js           # ZIP to lat/lng/state via api.zippopotam.us
    ├── federal.js       # Federal officials via ProPublica
    ├── openstates.js    # State legislators via OpenStates
    ├── congress.js      # Sponsored legislation via Congress.gov
    ├── fec.js           # Campaign finance via FEC
    ├── local.js         # Local official search links and resources
    ├── submit.js        # User submission modal → Google Sheets
    └── ui.js            # DOM rendering, card templates, filter logic
```

Scripts are loaded in dependency order at the bottom of `index.html`. No bundler or build step needed.

---

## License

MIT  © 2026 Twin Kites LLC
