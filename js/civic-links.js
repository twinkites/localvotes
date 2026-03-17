// civic-links.js — state voter registration, polling place lookups, and election dates.
// URLs point to official state/federal government pages.

const CivicLinks = (() => {
  const REG_URLS = {
    AL: 'https://www.alabamavotes.gov/RegisterToVote.aspx',
    AK: 'https://voterregistration.alaska.gov/',
    AZ: 'https://my.arizona.vote/PortalList.aspx',
    AR: 'https://www.sos.arkansas.gov/elections/voter-information/register-to-vote',
    CA: 'https://registertovote.ca.gov/',
    CO: 'https://www.sos.state.co.us/voter/pages/pub/olvr/verifyNewVoter.xhtml',
    CT: 'https://voterregistration.ct.gov/',
    DE: 'https://ivote.de.gov/',
    FL: 'https://registertovoteflorida.gov/',
    GA: 'https://registertovote.sos.ga.gov/',
    HI: 'https://olvr.hawaii.gov/',
    ID: 'https://elections.sos.idaho.gov/ElectionLink/VoterRegistration/',
    IL: 'https://ova.elections.il.gov/',
    IN: 'https://indianavoters.in.gov/',
    IA: 'https://sos.iowa.gov/elections/voterinformation/voterregistration.html',
    KS: 'https://www.kdor.ks.gov/Apps/VoterReg/Default.aspx',
    KY: 'https://vrsws.sos.ky.gov/ovrweb/',
    LA: 'https://voterportal.sos.la.gov/',
    ME: 'https://www.maine.gov/sos/cec/elec/voter-info/voterguide.html',
    MD: 'https://voterservices.elections.maryland.gov/OnlineVoterRegistration/',
    MA: 'https://www.sec.state.ma.us/OVR/',
    MI: 'https://mvic.sos.state.mi.us/RegisterVoter',
    MN: 'https://mnvotes.sos.state.mn.us/VoterRegistration/',
    MS: 'https://www.sos.ms.gov/voter-registration',
    MO: 'https://s1.sos.mo.gov/elections/voterregistration/',
    MT: 'https://app.mt.gov/voterinfo/',
    NE: 'https://www.nebraska.gov/apps-sos-voter-registration/',
    NV: 'https://www.nvsos.gov/sosvoterservices/Registration/',
    NH: 'https://app.sos.nh.gov/vrs/',
    NJ: 'https://www.nj.gov/state/elections/vote-register-vote.shtml',
    NM: 'https://voterportal.servis.sos.state.nm.us/',
    NY: 'https://dmv.ny.gov/more-info/electronic-voter-registration-application',
    NC: 'https://www.ncsbe.gov/registering/how-register',
    ND: 'https://vip.sos.nd.gov/',
    OH: 'https://www.ohiosos.gov/elections/voters/voter-registration/',
    OK: 'https://www.voterportalok.gov/',
    OR: 'https://sos.oregon.gov/voting/pages/registration.aspx',
    PA: 'https://www.vote.pa.gov/Register-to-Vote/Pages/Register-to-Vote.aspx',
    RI: 'https://vote.sos.ri.gov/',
    SC: 'https://www.scvotes.gov/',
    SD: 'https://sdsos.gov/elections-voting/voting/register-to-vote/',
    TN: 'https://ovr.govote.tn.gov/',
    TX: 'https://www.votetexas.gov/register-to-vote/',
    UT: 'https://vote.utah.gov/',
    VT: 'https://mvp.vermont.gov/',
    VA: 'https://www.elections.virginia.gov/registration/',
    WA: 'https://voter.votewa.gov/WhereAreYou.aspx',
    WV: 'https://ovr.sos.wv.gov/',
    WI: 'https://myvote.wi.gov/en-us/RegisterToVote',
    WY: 'https://sos.wyo.gov/Elections/Voter/Default.aspx',
    DC: 'https://www.vote4dc.com/',
  };

  // State-specific polling place lookups; all others fall back to vote.gov
  const POLL_URLS = {
    CA: 'https://www.sos.ca.gov/elections/polling-place',
    FL: 'https://dos.fl.gov/elections/for-voters/polling-place/',
    GA: 'https://mvp.sos.ga.gov/',
    IL: 'https://www.illinoisvotes.gov/',
    MA: 'https://www.sec.state.ma.us/WhereDoIVoteWeb/WhereDoIVote',
    MI: 'https://mvic.sos.state.mi.us/',
    MN: 'https://pollingplace.sos.state.mn.us/',
    NC: 'https://vt.ncsbe.gov/PPLkup/',
    NY: 'https://www.elections.ny.gov/VotingPollingPlace.html',
    OH: 'https://www.ohiosos.gov/elections/voters/find-your-polling-location/',
    PA: 'https://www.vote.pa.gov/Voting-in-PA/Pages/Polling-Place-Information.aspx',
    TX: 'https://teamrv-mvp.sos.texas.gov/MVP/mvp.do',
    VA: 'https://www.elections.virginia.gov/citizen-portal/',
    WA: 'https://voter.votewa.gov/WhereAreYou.aspx',
    WI: 'https://myvote.wi.gov/en-us/FindMyPollingPlace',
  };

  const NEXT_ELECTION = {
    date: 'November 3, 2026',
    label: 'Midterm Elections',
    detail: 'All 435 House seats · 33 Senate seats · 36 governors',
  };

  function get(stateAbbr) {
    return {
      registerUrl: REG_URLS[stateAbbr] || 'https://vote.gov/register',
      pollUrl:     POLL_URLS[stateAbbr] || 'https://vote.gov/find-your-polling-place',
      election:    NEXT_ELECTION,
    };
  }

  return { get };
})();
