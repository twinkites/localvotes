const LocalOfficials = (() => {
  function q(str) {
    return encodeURIComponent(str);
  }

  function ddg(query) {
    return `https://duckduckgo.com/?q=${q(query)}`;
  }

  // Five local office categories, each with targeted DDG searches
  const OFFICE_GROUPS = [
    {
      title: 'Mayor & City Council',
      icon: '🏛️',
      description: 'Your city\'s chief executive and legislative body',
      searches: (city, state) => [
        { label: 'City council members', url: ddg(`"${city}" "${state}" city council members`) },
        { label: 'Mayor', url: ddg(`mayor "${city}" "${state}"`) },
        { label: 'City government website', url: ddg(`"${city}" "${state}" city government official site`) },
      ],
    },
    {
      title: 'School Board',
      icon: '🏫',
      description: 'Elected officials overseeing your local public schools',
      searches: (city, state) => [
        { label: 'School board members', url: ddg(`"${city}" "${state}" school board members`) },
        { label: 'Board of education', url: ddg(`"${city}" "${state}" board of education`) },
        { label: 'School district site', url: ddg(`"${city}" "${state}" school district official site`) },
      ],
    },
    {
      title: 'County Government',
      icon: '🏢',
      description: 'County commissioners, supervisors, and county-level officials',
      searches: (city, state) => [
        { label: 'County commissioners', url: ddg(`"${state}" county commissioners "${city}"`) },
        { label: 'Board of supervisors', url: ddg(`"${state}" board of supervisors "${city}"`) },
        { label: 'County clerk', url: ddg(`county clerk "${city}" "${state}"`) },
      ],
    },
    {
      title: 'Sheriff & District Attorney',
      icon: '⚖️',
      description: 'Local law enforcement and prosecutorial leadership',
      searches: (city, state) => [
        { label: 'County sheriff', url: ddg(`county sheriff "${city}" "${state}"`) },
        { label: 'District attorney', url: ddg(`district attorney "${city}" "${state}"`) },
        { label: 'Local judges', url: ddg(`local court judges "${city}" "${state}"`) },
      ],
    },
    {
      title: 'Special Districts',
      icon: '💧',
      description: 'Water boards, fire districts, library boards, transit authorities',
      searches: (city, state) => [
        { label: 'Water district board', url: ddg(`water district board "${city}" "${state}"`) },
        { label: 'Fire district board', url: ddg(`fire district board "${city}" "${state}"`) },
        { label: 'Library board of trustees', url: ddg(`library board trustees "${city}" "${state}"`) },
        { label: 'Transit authority board', url: ddg(`transit authority board "${city}" "${state}"`) },
      ],
    },
  ];

  // National resources — each verified working as of March 2026
  const NATIONAL_RESOURCES = [
    {
      name: 'USA.gov — Local Governments',
      url: 'https://www.usa.gov/local-governments',
      description: 'Official U.S. government hub linking to local government directories in every state',
    },
    {
      name: 'Vote411 (League of Women Voters)',
      url: 'https://www.vote411.org/',
      description: 'Non-partisan voter guide with ballot lookups and election information',
    },
    {
      name: 'Ballotpedia — Who Represents Me?',
      url: 'https://ballotpedia.org/Who_represents_me',
      description: 'Comprehensive encyclopedia of U.S. politics with elected official lookup by address',
    },
    {
      name: 'Common Cause',
      url: 'https://www.commoncause.org/find-your-representative/',
      description: 'Non-partisan tool for finding elected representatives at multiple levels',
    },
  ];

  // State-specific portals — only URLs verified working as of March 2026
  // Other states fall back to a targeted DDG search
  const STATE_PORTALS = {
    'CA': {
      name: 'California Secretary of State — Elections',
      url: 'https://www.sos.ca.gov/elections',
    },
    'IL': {
      name: 'Illinois State Board of Elections — District Locator',
      url: 'https://www.elections.il.gov/',
    },
    'PA': {
      name: 'Pennsylvania Voting & Elections Resources',
      url: 'https://www.pa.gov/en/agencies/dos/resources/voting-and-elections-resources.html',
    },
  };

  function generate(geo) {
    const { city, state, stateAbbr } = geo;

    const groups = OFFICE_GROUPS.map(g => ({
      title: g.title,
      icon: g.icon,
      description: g.description,
      searches: g.searches(city, state),
    }));

    const statePortal = STATE_PORTALS[stateAbbr]
      ? { ...STATE_PORTALS[stateAbbr], verified: true }
      : {
          name: `Find Local Officials in ${state}`,
          url: ddg(`local elected officials "${city}" "${state}" official`),
          verified: false,
        };

    return { groups, resources: NATIONAL_RESOURCES, statePortal, city, state };
  }

  return { generate };
})();
