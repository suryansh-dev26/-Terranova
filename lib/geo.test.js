// Real, runnable unit tests for RunRealm3's core logic.
// Run with:  npm test    (or: node --test)
//
// These exercise the SAME module App.js imports (lib/geo.js), so a green run
// means the real app logic behaves as asserted — distance, area, GPS filtering,
// color assignment, and the turf-based territory-capture engine.

const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('./geo');

// Float comparison helper (meters / areas aren't exact).
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ~${expected}, got ${actual} (tol ${tol})`);

// ─── getDistanceMeters (haversine) ──────────────────────────────────────────
test('getDistanceMeters: same point is 0', () => {
  assert.equal(geo.getDistanceMeters(26.9124, 75.7873, 26.9124, 75.7873), 0);
});

test('getDistanceMeters: 1° of latitude ≈ 111.19 km', () => {
  near(geo.getDistanceMeters(0, 0, 1, 0), 111194.9, 50, '1 degree lat');
});

test('getDistanceMeters: is symmetric', () => {
  const a = geo.getDistanceMeters(26.90, 75.78, 26.91, 75.79);
  const b = geo.getDistanceMeters(26.91, 75.79, 26.90, 75.78);
  near(a, b, 1e-6, 'symmetry');
});

test('getDistanceMeters: ~157 m for a small local hop', () => {
  // 0.001° lat + 0.001° lng near Jaipur
  const d = geo.getDistanceMeters(26.9124, 75.7873, 26.9134, 75.7883);
  near(d, 148, 8, 'small hop');
});

// ─── formatDistance ─────────────────────────────────────────────────────────
test('formatDistance: meters below 1 km', () => {
  assert.equal(geo.formatDistance(0), '0 m');
  assert.equal(geo.formatDistance(500), '500 m');
  assert.equal(geo.formatDistance(999), '999 m');
  assert.equal(geo.formatDistance(750.6), '751 m'); // rounds
});

test('formatDistance: km at/above 1 km', () => {
  assert.equal(geo.formatDistance(1000), '1.00 km');
  assert.equal(geo.formatDistance(1500), '1.50 km');
  assert.equal(geo.formatDistance(12345), '12.35 km');
});

// ─── calculateArea (shoelace on local projection) ───────────────────────────
test('calculateArea: < 3 points is 0', () => {
  assert.equal(geo.calculateArea([]), 0);
  assert.equal(geo.calculateArea([{ latitude: 0, longitude: 0 }]), 0);
  assert.equal(geo.calculateArea([{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }]), 0);
});

test('calculateArea: ~111m square ≈ 12,360 m² (open ring, auto-closed)', () => {
  const square = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.001 },
    { latitude: 0.001, longitude: 0.001 },
    { latitude: 0.001, longitude: 0 },
  ];
  near(geo.calculateArea(square), 12363, 200, '~111m square');
});

test('calculateArea: winding order does not affect magnitude (abs)', () => {
  const cw = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.001 },
    { latitude: 0.001, longitude: 0.001 },
    { latitude: 0.001, longitude: 0 },
  ];
  const ccw = [...cw].reverse();
  near(geo.calculateArea(cw), geo.calculateArea(ccw), 1e-3, 'abs area');
});

// ─── formatArea ─────────────────────────────────────────────────────────────
test('formatArea: m² below 1 ha, ha at/above', () => {
  assert.equal(geo.formatArea(0), '0 m²');
  assert.equal(geo.formatArea(5000), '5000 m²');
  assert.equal(geo.formatArea(9999), '9999 m²');
  assert.equal(geo.formatArea(10000), '1.00 ha');
  assert.equal(geo.formatArea(25000), '2.50 ha');
});

// ─── generateUserId ─────────────────────────────────────────────────────────
test('generateUserId: "Runner-" + 4 allowed chars, length 11', () => {
  const allowed = /^Runner-[A-Z0-9]{4}$/;
  for (let i = 0; i < 200; i++) {
    const id = geo.generateUserId();
    assert.match(id, allowed, `bad id: ${id}`);
    assert.equal(id.length, 11);
  }
});

// ─── getUserColor ───────────────────────────────────────────────────────────
test('getUserColor: empty/null returns the palette fallback (index 6)', () => {
  assert.deepEqual(geo.getUserColor(null), geo.COLOR_PALETTE[6]);
  assert.deepEqual(geo.getUserColor(''), geo.COLOR_PALETTE[6]);
  assert.deepEqual(geo.getUserColor(undefined), geo.COLOR_PALETTE[6]);
});

test('getUserColor: deterministic and always within palette', () => {
  const c1 = geo.getUserColor('Runner-AB12');
  const c2 = geo.getUserColor('Runner-AB12');
  assert.deepEqual(c1, c2, 'deterministic');
  for (const id of ['Runner-ZZZZ', 'Runner-0000', 'alice', 'bob', 'Runner-9XQ1']) {
    assert.ok(geo.COLOR_PALETTE.includes(geo.getUserColor(id)), `in palette for ${id}`);
  }
});

// ─── isPointInPolygon (ray casting) ─────────────────────────────────────────
// NOTE: this helper is currently UNUSED by App.js (dead code) — tested anyway.
test('isPointInPolygon: inside vs outside a unit square', () => {
  const square = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 1 },
    { latitude: 1, longitude: 1 },
    { latitude: 1, longitude: 0 },
  ];
  assert.equal(geo.isPointInPolygon({ latitude: 0.5, longitude: 0.5 }, square), true);
  assert.equal(geo.isPointInPolygon({ latitude: 2, longitude: 2 }, square), false);
  assert.equal(geo.isPointInPolygon({ latitude: -0.1, longitude: 0.5 }, square), false);
});

// ─── isValidGPSPoint ────────────────────────────────────────────────────────
test('isValidGPSPoint: rejects poor accuracy (> 25 m)', () => {
  assert.equal(geo.isValidGPSPoint({ latitude: 0, longitude: 0 }, null, 30), false);
});

test('isValidGPSPoint: first point (no last) accepted when accuracy ok', () => {
  assert.equal(geo.isValidGPSPoint({ latitude: 0, longitude: 0 }, null, 10), true);
  assert.equal(geo.isValidGPSPoint({ latitude: 0, longitude: 0 }, null, undefined), true);
});

test('isValidGPSPoint: rejects GPS jump (> 50 m) and noise (< 5 m)', () => {
  const last = { latitude: 0, longitude: 0 };
  // ~111 m away (0.001° lat) → jump → reject
  assert.equal(geo.isValidGPSPoint({ latitude: 0.001, longitude: 0 }, last, 10), false);
  // ~1.1 m away (0.00001° lat) → noise → reject
  assert.equal(geo.isValidGPSPoint({ latitude: 0.00001, longitude: 0 }, last, 10), false);
});

test('isValidGPSPoint: accepts a normal step (5–50 m)', () => {
  const last = { latitude: 0, longitude: 0 };
  // ~22 m away (0.0002° lat) → accept
  assert.equal(geo.isValidGPSPoint({ latitude: 0.0002, longitude: 0 }, last, 10), true);
});

test('isValidGPSPoint: documents accuracy === 0 passes the accuracy gate (0 is falsy)', () => {
  // Some devices report accuracy 0; the current `accuracy && accuracy > 25` skips the gate.
  assert.equal(geo.isValidGPSPoint({ latitude: 0.0002, longitude: 0 }, { latitude: 0, longitude: 0 }, 0), true);
});

// ─── smoothPoint ────────────────────────────────────────────────────────────
test('smoothPoint: returns current when no last point', () => {
  const cur = { latitude: 5, longitude: 7 };
  assert.deepEqual(geo.smoothPoint(null, cur), cur);
});

test('smoothPoint: averages last and current', () => {
  const out = geo.smoothPoint({ latitude: 0, longitude: 0 }, { latitude: 2, longitude: 4 });
  assert.deepEqual(out, { latitude: 1, longitude: 2 });
});

// ─── toTurfPolygon / fromTurfCoords roundtrip ───────────────────────────────
test('fromTurfCoords: maps [lng,lat] → {latitude,longitude}', () => {
  assert.deepEqual(geo.fromTurfCoords([[75.78, 26.91], [75.79, 26.92]]), [
    { latitude: 26.91, longitude: 75.78 },
    { latitude: 26.92, longitude: 75.79 },
  ]);
});

test('toTurfPolygon: closes the ring (first point repeated)', () => {
  const coords = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 1 },
    { latitude: 1, longitude: 1 },
  ];
  const poly = geo.toTurfPolygon(coords);
  const ring = poly.geometry.coordinates[0];
  assert.equal(ring.length, 4, 'open ring of 3 becomes closed ring of 4');
  assert.deepEqual(ring[0], ring[ring.length - 1], 'first === last');
});

// ─── getTurfConflict (territory capture engine) ─────────────────────────────
const square = (latMin, lngMin, latMax, lngMax) => [
  { latitude: latMin, longitude: lngMin },
  { latitude: latMin, longitude: lngMax },
  { latitude: latMax, longitude: lngMax },
  { latitude: latMax, longitude: lngMin },
];

test('getTurfConflict: no overlap → null', () => {
  const mine = square(0, 0, 0.002, 0.002);
  const enemy = { id: 'e1', polygon: square(0, 0.005, 0.002, 0.007) };
  assert.equal(geo.getTurfConflict(mine, enemy), null);
});

test('getTurfConflict: fully engulfing enemy (≥90%) → delete', () => {
  const enemy = { id: 'e1', polygon: square(0, 0, 0.002, 0.002) };
  const mine = square(-0.001, -0.001, 0.003, 0.003); // covers all of enemy
  const result = geo.getTurfConflict(mine, enemy);
  assert.ok(result, 'expected a conflict result');
  assert.equal(result.action, 'delete');
  assert.equal(result.id, 'e1');
});

test('getTurfConflict: partial overlap → cut, leaving the remainder', () => {
  const enemy = { id: 'e1', polygon: square(0, 0, 0.002, 0.002) };
  const mine = square(0, 0.001, 0.002, 0.003); // covers the right half, extends right
  const result = geo.getTurfConflict(mine, enemy);
  assert.ok(result, 'expected a conflict result');
  assert.equal(result.action, 'cut');
  assert.equal(result.id, 'e1');
  assert.ok(Array.isArray(result.newPolygon) && result.newPolygon.length >= 3, 'remainder polygon returned');
  // The remainder should be the LEFT half of the enemy (longitudes ≤ ~0.001).
  const maxLng = Math.max(...result.newPolygon.map(p => p.longitude));
  assert.ok(maxLng <= 0.00101, `remainder should be the left part, got maxLng=${maxLng}`);
});
