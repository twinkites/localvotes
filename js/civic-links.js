// civic-links.js - state voter registration, polling place lookups, and election dates.
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

  // Registration status check ("am I registered?") - state-specific lookup tools.
  // null = no statewide online tool found; falls back to USA.gov's aggregator.
  const STATUS_URLS = {
    AL: 'https://myinfo.alabamavotes.gov/',
    AK: 'https://myvoterinformation.alaska.gov/',
    AZ: 'https://my.arizona.vote/',
    AR: 'https://www.voterview.ar-nova.org/',
    CA: 'https://voterstatus.sos.ca.gov/',
    CO: 'https://www.coloradosos.gov/voter/pages/pub/olvr/findVoterReg.xhtml',
    CT: 'https://portaldir.ct.gov/sots/LookUp.aspx',
    DE: 'https://ivote.de.gov/',
    DC: 'https://apps.dcboe.org/VRS',
    FL: 'https://registration.elections.myflorida.com/CheckVoterStatus',
    GA: 'https://mvp.sos.ga.gov/s/',
    HI: 'https://olvr.hawaii.gov/',
    ID: 'https://voteidaho.gov/',
    IL: 'https://ova.elections.il.gov/Status.aspx',
    IN: 'https://indianavoters.in.gov/',
    IA: 'https://sos.iowa.gov/amiregistered',
    KS: 'https://myvoteinfo.voteks.org/VoterView',
    KY: 'https://vrsws.sos.ky.gov/vic/',
    LA: 'https://voterportal.sos.la.gov/',
    ME: 'https://www.maine.gov/portal/government/edemocracy/voter_lookup.php',
    MD: 'https://voterservices.elections.maryland.gov/votersearch',
    MA: 'https://www.sec.state.ma.us/voterregistrationsearch/',
    MI: 'https://mvic.sos.state.mi.us/Voter/Index',
    MN: 'https://mnvotes.sos.mn.gov/VoterStatus.aspx',
    MS: 'https://www.sos.ms.gov/yall-vote',
    MO: 'https://s1.sos.mo.gov/elections/voterlookup/',
    MT: 'https://app.mt.gov/voterinfo/',
    NE: 'https://www.votercheck.necvr.ne.gov/',
    NV: 'https://www.nvsos.gov/votersearch/',
    NH: 'https://app.sos.nh.gov/voterinformation',
    NJ: 'https://voter.svrs.nj.gov/registration-check',
    NM: 'https://voterportal.servis.sos.state.nm.us/',
    NY: 'https://voterlookup.elections.ny.gov/',
    NC: 'https://www.ncsbe.gov/voting/voter-lookup',
    ND: null, // ND has no voter registration; no true "status" analog to link to
    OH: 'https://voterlookup.ohiosos.gov/',
    OK: 'https://okvoterportal.okelections.gov/',
    OR: 'https://sos.oregon.gov/voting/pages/myvote.aspx',
    PA: 'https://www.pavoterservices.pa.gov/pages/voterregistrationstatus.aspx',
    RI: 'https://vote.sos.ri.gov/',
    SC: 'https://vrems.scvotes.sc.gov/',
    SD: 'https://vip.sdsos.gov/',
    TN: 'https://tnmap.tn.gov/voterlookup/',
    TX: 'https://teamrv-mvp.sos.texas.gov/',
    UT: 'https://vote.utah.gov/voter-registration-portal/',
    VT: 'https://mvp.vermont.gov/',
    VA: 'https://vote.elections.virginia.gov/VoterInformation/Lookup/status',
    WA: 'https://voter.votewa.gov/',
    WV: 'https://apps.sos.wv.gov/Elections/Voter/AmIRegisteredToVote',
    WI: 'https://myvote.wi.gov/',
    WY: null, // no statewide online lookup found; registration verification is by county clerk only
  };

  // Absentee/mail ballot tracking tools - state-specific where the state runs its own
  // (often the BallotTrax/Ballot Scout vendor, on a state-branded subdomain/portal).
  // null = no unified statewide tool found (handled per-county); falls back to USA.gov.
  const TRACK_URLS = {
    AL: 'https://myinfo.alabamavotes.gov/voterview',
    AK: 'https://myvoterinformation.alaska.gov/',
    AZ: 'https://my.arizona.vote/AbsenteeTracker.aspx',
    AR: 'https://portal.arkansas.gov/service/ar-absentee-ballot-search/',
    CA: 'https://wheresmyballot.sos.ca.gov/',
    CO: 'https://ballottrax.coloradosos.gov/voter/',
    CT: 'https://portaldir.ct.gov/sots/LookUp.aspx',
    DE: 'https://ivote.de.gov/',
    DC: 'https://votedc.ballottrax.net/voter/',
    FL: null, // no unified statewide tracker; handled per-county by Supervisors of Elections
    GA: 'https://mvp.sos.ga.gov/s/',
    HI: 'https://hawaii.ballottrax.net/voter/',
    ID: 'https://voteidaho.gov/',
    IL: null, // no unified statewide tracker; handled per-county
    IN: 'https://indianavoters.in.gov/',
    IA: 'https://apps.sos.iowa.gov/elections/absenteeballotstatus/absentee/search',
    KS: 'https://myvoteinfo.voteks.org/VoterView',
    KY: 'https://vrsws.sos.ky.gov/vic/',
    LA: 'https://voterportal.sos.la.gov/',
    ME: 'https://absenteeballotrequest.sos.maine.gov/BallotTracker/BallotTracker',
    MD: 'https://voterservices.elections.maryland.gov/votersearch',
    MA: 'https://www.sec.state.ma.us/wheredoivotema/track/trackmyballot.aspx',
    MI: 'https://mvic.sos.state.mi.us/Voter/Index',
    MN: 'https://mnvotes.sos.mn.gov/abstatus/index',
    MS: null, // no statewide tracker found; contact county circuit clerk
    MO: 'https://voteroutreach.sos.mo.gov/portal',
    MT: 'https://votemt.gov/',
    NE: 'https://www.votercheck.necvr.ne.gov/',
    NV: 'https://myballot.nv.gov/',
    NH: 'https://www.voteinnh.org/votetracker', // state-partnered nonprofit site, not .gov
    NJ: 'https://voter.svrs.nj.gov/registration-check',
    NM: 'https://www.sos.nm.gov/trackmyballot/',
    NY: 'https://voterlookup.elections.ny.gov/',
    NC: 'https://northcarolina.ballottrax.net/voter/',
    ND: 'https://vip.sos.nd.gov/AbsenteeTracker.aspx',
    OH: 'https://usoav.ohiosos.gov/',
    OK: 'https://okvoterportal.okelections.gov/',
    OR: 'https://sos.oregon.gov/voting/pages/myvote.aspx',
    PA: 'https://www.pavoterservices.pa.gov/pages/ballottracking.aspx',
    RI: 'https://ballottrax.sos.ri.gov/voter/',
    SC: 'https://vrems.scvotes.sc.gov/',
    SD: 'https://vip.sdsos.gov/',
    TN: 'https://tnmap.tn.gov/voterlookup/',
    TX: 'https://teamrv-mvp.sos.texas.gov/BallotTrackerApp/',
    UT: 'https://vote.utah.gov/track-my-ballot/',
    VT: 'https://mvp.vermont.gov/',
    VA: 'https://app.enhancedvoting.com/voter/virginia/bt/track', // Ballot Scout vendor domain, not .gov - verify still state-sanctioned
    WA: 'https://voter.votewa.gov/',
    WV: 'https://apps.sos.wv.gov/Elections/voter/absenteeballottracking',
    WI: 'https://myvote.wi.gov/',
    WY: null, // no statewide tracker found; contact county clerk
  };

  // Public financial disclosure ("Statement of Financial Interests") search portals,
  // run by each state's ethics commission. Terminology varies by state (Financial
  // Disclosure, Statement of Economic Interest, etc.). Falls back to NCSL's ethics
  // program hub, which links out to every state's ethics commission.
  // null = state has no financial-disclosure requirement for elected officials at all.
  // Where a state has no live public search database, the value points to that state's
  // official informational/records-request page instead (see inline notes).
  const FINANCIAL_DISCLOSURE_URLS = {
    AL: 'https://ethics.alabama.gov/soei.aspx',
    AK: 'https://apoc.doa.alaska.gov/filer-resources/financial-disclosure/',
    AZ: 'https://azsos.gov/elections/campaign-finance-reporting/officeholder-financial-disclosure-statements',
    AR: 'https://ethics-disclosures.sos.arkansas.gov/',
    CA: 'https://form700search.fppc.ca.gov/',
    CO: 'https://www.sos.state.co.us/pubs/elections/CampaignFinance/requestCopy.html', // no online search DB; requested via email from SOS
    CT: 'https://portal.ct.gov/Ethics/Public-Official/POSE-Filings/Statements-of-Financial-Interests-Reports',
    DE: 'https://depic.delaware.gov/financial-disclosure/', // informational page; records released via FOIA request
    DC: 'https://efiler.bega.dc.gov/FDSSearch',
    FL: 'https://disclosure.floridaethics.gov/PublicSearch/Filings',
    GA: 'https://media.ethics.ga.gov/search/Financial/Financial_ByName.aspx',
    HI: 'https://hawaiiethics.my.site.com/public/s/',
    ID: null, // Idaho has no financial-interest disclosure system for elected officials
    IL: 'https://apps.ilsos.gov/economicinterest/',
    IN: 'https://www.in.gov/ig/search/search-disclosures/',
    IA: 'https://webapp.iecdb.iowa.gov/pfd',
    KS: 'https://kssos.org/elections/ssi/help/ssi_help_page.html', // filed with SOS; no live public search DB found
    KY: 'https://apps.klec.ky.gov/',
    LA: 'https://ethics.la.gov/PFDisclosure/SearchByName.aspx',
    ME: 'https://www.maine.gov/ethics/financial-statements',
    MD: 'https://efds.ethics.maryland.gov/',
    MA: 'https://www.sfi.eth.mass.gov/Public/PublicHomePage.aspx', // official SFI portal; has had intermittent outages
    MI: 'https://www.michigan.gov/sos/elections/disclosure/personal-financial-disclosure',
    MN: 'https://cfb.mn.gov/citizen-resources/board-programs/overview/government-officials-disclosure/',
    MS: 'https://www.ethics.webapps.ms.gov/SearchSEIForm.aspx',
    MO: 'https://www.mec.mo.gov/MEC/PFD/Home.aspx',
    MT: 'https://politicalpractices.mt.gov/Featured-Online-Services/',
    NE: 'https://nadc.nebraska.gov/view-campaign-filings-personal-financial-disclosures-potential-conflicts-lobbying-reports-and-more',
    NV: 'https://www.nvsos.gov/soscandidateservices/anonymousaccess/cefdsearchuu/search.aspx',
    NH: 'https://15a.sos.nh.gov',
    NJ: 'https://www3-elec.mwg.state.nj.us/ELEC_AGAA/candidate_pfd.aspx',
    NM: 'https://www.sos.nm.gov/candidate-and-campaigns/search-public-information-data/financial-disclosures/',
    NY: 'https://ethics.ny.gov/financial-disclosure-statements-elected-officials',
    NC: 'https://ethicssei.nc.gov/Tools/Search?id=SEI',
    ND: 'https://www.ethicscommission.nd.gov/', // no annual FD filing requirement for sitting officials currently; informational only
    OH: 'https://ethics.ohio.gov/fds/index.html', // records-request based; no live public search portal found
    OK: 'https://oklahoma.gov/ethics/state-officers-and-employees/financial-disclosure.html',
    OR: 'https://www.oregon.gov/ogec/public-records/pages/seis.aspx',
    PA: 'https://www.pa.gov/agencies/ethics/ethics-search/ethics-elibrary',
    RI: 'https://ethics.ri.gov/financial-disclosure',
    SC: 'https://ethicsfiling.sc.gov/public/home',
    SD: 'https://sdsos.gov/elections-voting/financial-interest-statements/default.aspx', // not consistently in a live searchable DB
    TN: 'https://apps.tn.gov/conflict/',
    TX: 'https://www.ethics.state.tx.us/search/', // main TEC search portal; no stable deep link to PFS-by-name confirmed
    UT: 'https://disclosures.utah.gov/Search/PublicSearch',
    VT: 'https://sos.vermont.gov/elections/election-info-resources/candidates',
    VA: 'https://ethicssearch.dls.virginia.gov/', // gated by CAPTCHA but functional
    WA: 'https://www.pdc.wa.gov/political-disclosure-reporting-data/browse-search-data/financial-affairs-statements',
    WV: 'https://ethics.wv.gov/financial-disclosure-statements-0',
    WI: 'https://ethics.wi.gov/Pages/Ethics/StatementsOfEconomicInterests.aspx',
    WY: 'https://sos.wyo.gov/Elections/Ethics.aspx', // no live searchable DB; SOS posts individual PDF forms
  };

  function get(stateAbbr) {
    return {
      registerUrl:   REG_URLS[stateAbbr]                  || 'https://vote.gov/register',
      pollUrl:       POLL_URLS[stateAbbr]                 || 'https://vote.gov/find-your-polling-place',
      statusUrl:     STATUS_URLS[stateAbbr]                || 'https://www.usa.gov/confirm-voter-registration',
      trackUrl:      TRACK_URLS[stateAbbr]                 || 'https://www.usa.gov/track-mail-in-ballot',
      disclosureUrl: FINANCIAL_DISCLOSURE_URLS[stateAbbr]  || 'https://www.ncsl.org/ethics',
    };
  }

  return { get };
})();
