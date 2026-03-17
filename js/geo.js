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

  /**
   * Reverse-geocodes coordinates to a ZIP code.
   * Tries the Census geocoder first; falls back to Nominatim (OpenStreetMap).
   *
   * Why two sources: the Census /locations/coordinates endpoint requires the
   * point to be near a road. Firefox's network-based geolocation is coarser
   * than Chrome's and often returns coordinates in a field or park, causing
   * the Census endpoint to return no address matches. Nominatim handles any
   * coordinate and reliably returns a postal code.
   */
  async function reverseGeocodeToZip(lat, lng) {
    return (await _censusReverseGeocode(lat, lng))
        || (await _nominatimReverseGeocode(lat, lng));
  }

  async function _censusReverseGeocode(lat, lng) {
    try {
      const url =
        `https://geocoding.geo.census.gov/geocoder/locations/coordinates` +
        `?x=${lng}&y=${lat}&benchmark=Public_AR_Current&format=json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const match = data.result?.addressMatches?.[0];
      if (!match) return null;
      const { zip, city, state } = match.addressComponents || {};
      if (!zip) return null;
      return { zip, city: city || '', state: state || '' };
    } catch {
      return null;
    }
  }

  // Fallback: Nominatim (OpenStreetMap reverse geocoder — free, no key).
  // Usage policy: max 1 req/s, must not scrape. One call per user action is fine.
  async function _nominatimReverseGeocode(lat, lng) {
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse` +
        `?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
      if (!res.ok) return null;
      const data = await res.json();
      const addr = data.address;
      if (!addr) return null;
      const zip = (addr.postcode || '').replace(/\s/g, '').slice(0, 5);
      if (!/^\d{5}$/.test(zip)) return null;
      const city  = addr.city || addr.town || addr.village || addr.county || '';
      const state = addr.state || '';
      return { zip, city, state };
    } catch {
      return null;
    }
  }

  // Returns { congressionalDistrict, county } for the given coordinates.
  // Uses getCongressionalDistrict (Census geocoder) for district + TIGERweb layer 2 for county.
  async function getGeoContext(lat, lng) {
    const [district, county] = await Promise.allSettled([
      getCongressionalDistrict(lat, lng),
      _queryCounty(lat, lng),
    ]);
    return {
      congressionalDistrict: district.status === 'fulfilled' ? district.value : null,
      county: county.status === 'fulfilled' ? county.value : null,
    };
  }

  async function _queryCounty(lat, lng) {
    const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer';
    for (const layer of [2, 84, 86]) {
      try {
        const params = new URLSearchParams({
          geometry:       `${lng},${lat}`,
          geometryType:   'esriGeometryPoint',
          inSR:           '4326',
          spatialRel:     'esriSpatialRelIntersects',
          outFields:      'BASENAME,NAME',
          returnGeometry: 'false',
          f:              'json',
        });
        const r = await fetch(`${TIGERWEB}/${layer}/query?${params}`);
        if (!r.ok) continue;
        const data = await r.json();
        const attr = data.features?.[0]?.attributes;
        if (attr) return attr.BASENAME || attr.NAME || null;
      } catch { continue; }
    }
    return null;
  }

  return { lookupZip, getCongressionalDistrict, getGeoContext, reverseGeocodeToZip };
})();
