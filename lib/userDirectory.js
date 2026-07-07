import { collection, getDocs } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../firebase';

// uid → { displayName, photoURL } directory for leaderboards/toasts.
//
// Free-tier math: reading the users collection costs one read per user doc,
// so we do it at most once per hour per device (memory first, then an
// AsyncStorage snapshot that survives restarts). Profile edits call
// invalidateUserDirectory() so the editing device refreshes immediately;
// other devices catch up within the TTL.
const CACHE_KEY = 'userDirectory:v1';
const TTL_MS = 60 * 60 * 1000;

let memory = null;
let fetchedAt = 0;
let inflight = null;

const isFresh = (timestamp) => Date.now() - timestamp < TTL_MS;

async function fetchDirectory() {
  const snapshot = await getDocs(collection(db, 'users'));
  const directory = {};
  snapshot.docs.forEach((docSnap) => {
    const { displayName, photoURL } = docSnap.data();
    directory[docSnap.id] = {
      displayName: displayName ?? null,
      photoURL: photoURL ?? null,
    };
  });
  memory = directory;
  fetchedAt = Date.now();
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt, directory })).catch(() => {});
  return directory;
}

// Returns the cached directory, refreshing from Firestore only when stale.
// Errors degrade to the last known snapshot (or {}) — callers always render.
export async function getUserDirectory() {
  if (memory && isFresh(fetchedAt)) return memory;

  if (!memory) {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        memory = cached.directory || null;
        fetchedAt = cached.fetchedAt || 0;
        if (memory && isFresh(fetchedAt)) return memory;
      }
    } catch {}
  }

  if (!inflight) {
    inflight = fetchDirectory().finally(() => { inflight = null; });
  }
  try {
    return await inflight;
  } catch {
    return memory || {};
  }
}

// Call after any profile edit (name/photo) or guest-data import so the next
// leaderboard render refetches instead of serving the stale hour-old copy.
export function invalidateUserDirectory() {
  memory = null;
  fetchedAt = 0;
  AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
