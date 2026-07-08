import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizePlace, gridKey } from './place';

// Reverse-geocoding with an aggressive local cache: expo-location's
// reverseGeocodeAsync hits the platform geocoder (rate-limited, needs
// network), so results are cached per ~1.1 km grid cell forever — city
// boundaries don't move. The most recent result is also kept under a
// well-known key so the leaderboard can default to the user's own
// country/city without any lookup.
const CACHE_PREFIX = 'geocode:v1:';
const LAST_PLACE_KEY = 'lastKnownPlace:v1';

// Never let a slow geocoder hold up saving a run.
const GEOCODE_TIMEOUT_MS = 4000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('geocode timeout')), ms)),
  ]);

// Resolve a coordinate to { country, region, city, countryName } — cache
// first, geocoder second. Returns null when offline/denied/unresolvable;
// callers treat location as optional.
export async function getPlaceForCoord(coord) {
  if (!coord) return null;
  const cacheKey = CACHE_PREFIX + gridKey(coord);

  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const place = JSON.parse(cached);
      AsyncStorage.setItem(LAST_PLACE_KEY, cached).catch(() => {});
      return place;
    }
  } catch {}

  try {
    const results = await withTimeout(
      Location.reverseGeocodeAsync({
        latitude: coord.latitude,
        longitude: coord.longitude,
      }),
      GEOCODE_TIMEOUT_MS,
    );
    const place = normalizePlace(results && results[0]);
    if (!place) return null;
    const raw = JSON.stringify(place);
    AsyncStorage.setItem(cacheKey, raw).catch(() => {});
    AsyncStorage.setItem(LAST_PLACE_KEY, raw).catch(() => {});
    return place;
  } catch {
    return null;
  }
}

// The place from the most recent successful geocode (any session).
export async function getLastKnownPlace() {
  try {
    const raw = await AsyncStorage.getItem(LAST_PLACE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
