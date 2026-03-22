// Copy this file to config.js and fill in your API keys.
// config.js is gitignored - never commit real keys.
//
// For GitHub Pages deployment, add each key as a repository secret:
// Settings → Secrets and variables → Actions → New repository secret

const CONFIG = {
  // Required: OpenStates API key (state legislators by location)
  // Free tier: 500 req/day - register at https://openstates.org/accounts/signup/
  OPENSTATES_API_KEY: 'YOUR_OPENSTATES_API_KEY',

  // Recommended: ProPublica Congress API key (federal senators + House reps)
  // Free - register at https://www.propublica.org/datastore/api/propublica-congress-api
  PROPUBLICA_API_KEY: 'YOUR_PROPUBLICA_API_KEY',

  // Optional: FEC API key (federal campaign finance totals)
  // Free - register at https://api.data.gov/signup/
  FEC_API_KEY: 'YOUR_FEC_API_KEY',

  // Optional: Congress.gov API key (sponsored legislation for federal officials)
  // Free - register at https://api.congress.gov/sign-up/
  CONGRESS_API_KEY: 'YOUR_CONGRESS_API_KEY',
};
