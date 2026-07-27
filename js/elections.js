// elections.js — 2026 election calendar data by state.
// Registration deadlines are computed from state law for the Nov 3, 2026 general election.
// Verify exact dates at your state's official election authority before acting on them.

const Elections = (() => {
  const GENERAL = {
    date: 'November 3, 2026',
    label: 'Midterm General Election',
    detail: 'All 435 House seats · 33 Senate seats · 36 governorships',
  };

  // Per-state data for the 2026 general election cycle.
  // regDeadline: voter registration deadline for Nov 3, 2026 general election.
  // sdr: true if same-day registration is available on or near Election Day.
  // earlyVoting: true if in-person early voting is offered.
  // vbm: true if all active voters automatically receive a mail ballot (universal VBM).
  // primaryDate: approximate date of the state's 2026 primary (where known).
  // primaryPast: true if the primary has already passed as of the deploy date.
  const STATE_INFO = {
    AL: { regDeadline: 'Oct 19, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 19, 2026',   primaryPast: true  },
    AK: { regDeadline: 'Oct 4, 2026',  sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Aug 18, 2026',   primaryPast: false },
    AZ: { regDeadline: 'Oct 5, 2026',  sdr: false, earlyVoting: true,  vbm: true,  primaryDate: 'Jul 28, 2026',   primaryPast: false },
    AR: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 19, 2026',   primaryPast: true  },
    CA: { regDeadline: 'Oct 19, 2026', sdr: true,  earlyVoting: true,  vbm: true,  primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    CO: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: true,  primaryDate: 'Jun 23, 2026',   primaryPast: false },
    CT: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Aug 11, 2026',   primaryPast: false },
    DE: { regDeadline: 'Oct 13, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Sep 8, 2026',    primaryPast: false },
    DC: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    FL: { regDeadline: 'Oct 5, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Aug 18, 2026',   primaryPast: false },
    GA: { regDeadline: 'Oct 6, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 19, 2026',   primaryPast: true  },
    HI: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: true,  primaryDate: 'Aug 8, 2026',    primaryPast: false },
    ID: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'May 19, 2026',   primaryPast: true  },
    IL: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Mar 17, 2026',   primaryPast: true  },
    IN: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 5, 2026',    primaryPast: true  },
    IA: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    KS: { regDeadline: 'Oct 13, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Aug 4, 2026',    primaryPast: false },
    KY: { regDeadline: 'Oct 5, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 19, 2026',   primaryPast: true  },
    LA: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Oct 10, 2026',   primaryPast: false },
    ME: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Jun 9, 2026',    primaryPast: true  },
    MD: { regDeadline: 'Oct 13, 2026', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Jul 21, 2026',   primaryPast: false },
    MA: { regDeadline: 'Oct 19, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Sep 1, 2026',    primaryPast: false },
    MI: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Aug 4, 2026',    primaryPast: false },
    MN: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Aug 11, 2026',   primaryPast: false },
    MS: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: false, vbm: false, primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    MO: { regDeadline: 'Oct 7, 2026',  sdr: false, earlyVoting: false, vbm: false, primaryDate: 'Aug 4, 2026',    primaryPast: false },
    MT: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    NE: { regDeadline: 'Oct 19, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 12, 2026',   primaryPast: true  },
    NV: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: true,  primaryDate: 'Jun 9, 2026',    primaryPast: true  },
    NH: { regDeadline: 'Election Day', sdr: true,  earlyVoting: false, vbm: false, primaryDate: 'Sep 8, 2026',    primaryPast: false },
    NJ: { regDeadline: 'Oct 13, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    NM: { regDeadline: 'Oct 6, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    NY: { regDeadline: 'Oct 9, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Jun 23, 2026',   primaryPast: false },
    NC: { regDeadline: 'Oct 9, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 5, 2026',    primaryPast: true  },
    ND: { regDeadline: 'No registration required', sdr: true, earlyVoting: true, vbm: false, primaryDate: 'Jun 9, 2026', primaryPast: true },
    OH: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 5, 2026',    primaryPast: true  },
    OK: { regDeadline: 'Oct 9, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Jun 16, 2026',   primaryPast: true  },
    OR: { regDeadline: 'Oct 13, 2026', sdr: true,  earlyVoting: false, vbm: true,  primaryDate: 'May 19, 2026',   primaryPast: true  },
    PA: { regDeadline: 'Oct 19, 2026', sdr: false, earlyVoting: false, vbm: false, primaryDate: 'May 19, 2026',   primaryPast: true  },
    RI: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Sep 8, 2026',    primaryPast: false },
    SC: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Jun 9, 2026',    primaryPast: true  },
    SD: { regDeadline: 'Oct 19, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Jun 2, 2026',    primaryPast: true  },
    TN: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Aug 4, 2026',    primaryPast: false },
    TX: { regDeadline: 'Oct 4, 2026',  sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Mar 3, 2026',    primaryPast: true  },
    UT: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: true,  primaryDate: 'Jun 23, 2026',   primaryPast: false },
    VT: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Aug 25, 2026',   primaryPast: false },
    VA: { regDeadline: 'Oct 12, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'Jun 16, 2026',   primaryPast: true  },
    WA: { regDeadline: 'Oct 26, 2026', sdr: false, earlyVoting: true,  vbm: true,  primaryDate: 'Aug 4, 2026',    primaryPast: false },
    WV: { regDeadline: 'Oct 13, 2026', sdr: false, earlyVoting: true,  vbm: false, primaryDate: 'May 12, 2026',   primaryPast: true  },
    WI: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Aug 11, 2026',   primaryPast: false },
    WY: { regDeadline: 'Election Day', sdr: true,  earlyVoting: true,  vbm: false, primaryDate: 'Aug 18, 2026',   primaryPast: false },
  };

  function get(stateAbbr) {
    const info = STATE_INFO[stateAbbr];
    if (!info) return null;
    const primaryMs = Date.parse(info.primaryDate);
    return {
      ...info,
      primaryPast: Number.isNaN(primaryMs) ? info.primaryPast : primaryMs < Date.now(),
    };
  }

  function getGeneral() {
    return GENERAL;
  }

  return { get, getGeneral };
})();
