const GeoAPI = (() => {
  async function lookupZip(zip) {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) throw new Error(`ZIP code "${zip}" not found. Please check and try again.`);
    const data = await res.json();
    const place = data.places[0];
    return {
      lat: parseFloat(place.latitude),
      lng: parseFloat(place.longitude),
      city: place['place name'],
      state: place['state'],
      stateAbbr: place['state abbreviation'],
    };
  }

  // Returns congressional district number string (e.g. "05") or null
  async function getCongressionalDistrict(lat, lng) {
    try {
      const url =
        `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` +
        `?x=${lng}&y=${lat}` +
        `&benchmark=Public_AR_Current&vintage=Current_Districts&layers=54&format=json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const geos = data.result?.geographies || {};
      // Census may label the layer differently depending on current congress
      const districts =
        geos['119th Congressional Districts'] ||
        geos['118th Congressional Districts'] ||
        geos['Congressional Districts'] ||
        [];
      if (!districts.length) return null;
      // Field name also varies; try the known ones
      return (
        districts[0].CD119FP ||
        districts[0].CD118FP ||
        districts[0].DISTRICT ||
        districts[0].DISTRICTID ||
        null
      );
    } catch {
      return null;
    }
  }

  return { lookupZip, getCongressionalDistrict };
})();
