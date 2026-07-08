// Pure helpers for run locations — no React Native / Expo imports so
// `node --test` can exercise them directly (see place.test.js).
// The RN-side wrapper (geocode.js) handles the actual reverse-geocode call
// and AsyncStorage caching.

// Firestore docs store exactly { country, region, city } per the product
// spec — country as the ISO code ('IN'), region/city as display names.
// countryName is kept only in local caches for friendlier UI copy.
function normalizePlace(result) {
  if (!result) return null;
  const clean = (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  const country = clean(result.isoCountryCode);
  if (!country) return null;

  return {
    country: country.toUpperCase(),
    region: clean(result.region) || clean(result.subregion),
    city: clean(result.city) || clean(result.district) || clean(result.subregion),
    countryName: clean(result.country),
  };
}

// Only the fields that belong on Firestore docs (runs + users/{uid}).
// Nulls are dropped — rules validate present fields as strings.
function placeDocFields(place) {
  if (!place) return {};
  const fields = {};
  if (place.country) fields.country = place.country;
  if (place.region) fields.region = place.region;
  if (place.city) fields.city = place.city;
  return fields;
}

// ~1.1 km grid cells: two runs starting on the same block share a cache
// entry, so the geocoder is only hit when the user runs somewhere new.
function gridKey(coord) {
  return `${coord.latitude.toFixed(2)},${coord.longitude.toFixed(2)}`;
}

module.exports = { normalizePlace, placeDocFields, gridKey };
