// Pure geometry / GPS / territory helpers for RunRealm3.
//
// These were extracted verbatim from App.js so they can be unit-tested in
// isolation (they have no React Native / Firebase dependencies — only @turf/turf,
// which works under both Metro and plain Node). App.js imports from here, and
// lib/geo.test.js tests this same module, so the tests exercise the real app logic.
//
// Authored as CommonJS so `node --test` can require it with no Babel/Jest setup,
// while Metro/Babel interop lets App.js use ESM `import { ... } from './lib/geo'`.

const turf = require('@turf/turf');

// ─── Distance / formatting ──────────────────────────────────────────────────

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (val) => (val * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

// MapLibre uses GeoJSON [longitude, latitude] order (the reverse of
// expo-location's { latitude, longitude }).
function toLngLat(c) {
  return [c.longitude, c.latitude];
}

function calculateArea(coords) {
  if (coords.length < 3) return 0;
  const toRad = (val) => (val * Math.PI) / 180;
  const R = 6371000;
  const origin = coords[0];
  const points = coords.map(c => ({
    x: R * toRad(c.longitude - origin.longitude) * Math.cos(toRad(origin.latitude)),
    y: R * toRad(c.latitude - origin.latitude),
  }));
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
}

function formatArea(sqMeters) {
  if (sqMeters < 10000) return `${Math.round(sqMeters)} m²`;
  return `${(sqMeters / 10000).toFixed(2)} ha`;
}

// ─── User id / color ────────────────────────────────────────────────────────

function generateUserId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'Runner-';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const COLOR_PALETTE = [
  { hex: '#ef4444', r: 239, g: 68,  b: 68  },
  { hex: '#f97316', r: 249, g: 115, b: 22  },
  { hex: '#eab308', r: 234, g: 179, b: 8   },
  { hex: '#22c55e', r: 34,  g: 197, b: 94  },
  { hex: '#14b8a6', r: 20,  g: 184, b: 166 },
  { hex: '#3b82f6', r: 59,  g: 130, b: 246 },
  { hex: '#8b5cf6', r: 139, g: 92,  b: 246 },
  { hex: '#ec4899', r: 236, g: 72,  b: 153 },
  { hex: '#06b6d4', r: 6,   g: 182, b: 212 },
  { hex: '#f43f5e', r: 244, g: 63,  b: 94  },
];

function getUserColor(userId) {
  if (!userId) return COLOR_PALETTE[6];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

// ─── Polygon geometry ───────────────────────────────────────────────────────

function isPointInPolygon(point, polygon) {
  const { latitude: px, longitude: py } = point;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].latitude;
    const yi = polygon[i].longitude;
    const xj = polygon[j].latitude;
    const yj = polygon[j].longitude;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getPolygonCenter(polygon) {
  const lat = polygon.reduce((sum, p) => sum + p.latitude, 0) / polygon.length;
  const lng = polygon.reduce((sum, p) => sum + p.longitude, 0) / polygon.length;
  return { latitude: lat, longitude: lng };
}

// ─── GPS validation / smoothing ─────────────────────────────────────────────

function isValidGPSPoint(newCoord, lastCoord, accuracy) {
  if (accuracy && accuracy > 25) return false;
  if (!lastCoord) return true;
  const dist = getDistanceMeters(
    lastCoord.latitude, lastCoord.longitude,
    newCoord.latitude, newCoord.longitude
  );
  if (dist > 50) return false;
  if (dist < 5) return false;
  return true;
}

function smoothPoint(last, current) {
  if (!last) return current;
  return {
    latitude: (last.latitude + current.latitude) / 2,
    longitude: (last.longitude + current.longitude) / 2,
  };
}

// ─── Turf helpers (territory capture) ───────────────────────────────────────

function toTurfPolygon(coords) {
  const ring = coords.map(c => [c.longitude, c.latitude]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return turf.polygon([ring]);
}

function fromTurfCoords(turfCoords) {
  return turfCoords.map(c => ({ latitude: c[1], longitude: c[0] }));
}

function getTurfConflict(newCoords, enemyTerritory) {
  try {
    const newPoly = toTurfPolygon(newCoords);
    const oldPoly = toTurfPolygon(enemyTerritory.polygon);
    const intersection = turf.intersect(turf.featureCollection([newPoly, oldPoly]));
    if (!intersection) return null;
    const remaining = turf.difference(turf.featureCollection([oldPoly, newPoly]));
    if (!remaining) {
      const oldArea = turf.area(oldPoly);
      const newArea = turf.area(newPoly);
      if (newArea >= oldArea * 0.9) return { action: 'delete', id: enemyTerritory.id };
      return null;
    }
    const geom = remaining.geometry;
    if (!geom) return null;
    let remainingCoords;
    if (geom.type === 'Polygon') {
      remainingCoords = fromTurfCoords(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      let largest = geom.coordinates[0];
      for (const part of geom.coordinates) {
        if (part[0].length > largest[0].length) largest = part;
      }
      remainingCoords = fromTurfCoords(largest[0]);
    } else {
      return null;
    }
    return { action: 'cut', id: enemyTerritory.id, newPolygon: remainingCoords };
  } catch (e) {
    console.error('Turf conflict error:', e);
    return null;
  }
}

module.exports = {
  getDistanceMeters,
  formatDistance,
  toLngLat,
  calculateArea,
  formatArea,
  generateUserId,
  COLOR_PALETTE,
  getUserColor,
  isPointInPolygon,
  getPolygonCenter,
  isValidGPSPoint,
  smoothPoint,
  toTurfPolygon,
  fromTurfCoords,
  getTurfConflict,
};
