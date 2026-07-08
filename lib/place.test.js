const test = require('node:test');
const assert = require('node:assert');
const { normalizePlace, placeDocFields, gridKey } = require('./place');

test('normalizePlace maps expo-location fields to { country, region, city }', () => {
  const place = normalizePlace({
    isoCountryCode: 'in',
    country: 'India',
    region: 'Rajasthan',
    city: 'Jaipur',
    district: 'Malviya Nagar',
  });
  assert.deepStrictEqual(place, {
    country: 'IN',
    region: 'Rajasthan',
    city: 'Jaipur',
    countryName: 'India',
  });
});

test('normalizePlace falls back through city → district → subregion', () => {
  const place = normalizePlace({
    isoCountryCode: 'IN',
    subregion: 'Jaipur Division',
  });
  assert.strictEqual(place.city, 'Jaipur Division');
  assert.strictEqual(place.region, 'Jaipur Division');
});

test('normalizePlace returns null without a country code', () => {
  assert.strictEqual(normalizePlace({ city: 'Nowhere' }), null);
  assert.strictEqual(normalizePlace(null), null);
  assert.strictEqual(normalizePlace({ isoCountryCode: '  ' }), null);
});

test('placeDocFields drops nulls and the local-only countryName', () => {
  const fields = placeDocFields({
    country: 'IN', region: null, city: 'Jaipur', countryName: 'India',
  });
  assert.deepStrictEqual(fields, { country: 'IN', city: 'Jaipur' });
  assert.deepStrictEqual(placeDocFields(null), {});
});

test('gridKey buckets nearby coords into ~1.1 km cells', () => {
  const a = { latitude: 26.91241, longitude: 75.78729 };
  const b = { latitude: 26.91456, longitude: 75.78901 }; // same block
  const c = { latitude: 26.99999, longitude: 75.78729 }; // different cell
  assert.strictEqual(gridKey(a), gridKey(b));
  assert.notStrictEqual(gridKey(a), gridKey(c));
});
