// Single Firebase entry point for RunRealm3. Every screen imports { db } (and
// auth helpers) from here — do NOT call initializeApp/initializeFirestore
// anywhere else, or config changes will drift between copies.
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore, getFirestore, doc, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import {
  initializeAuth, getAuth, getReactNativePersistence,
  onAuthStateChanged, signInAnonymously,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateUserId } from './lib/geo';

// This config is public by design (it identifies the project, it doesn't grant
// access) — firestore.rules is the actual security boundary. See SECURITY.md.
const firebaseConfig = {
  apiKey: "AIzaSyBmt-7ejRkjjlNNWvGILlHhouvLwhgN8C4",
  authDomain: "runrealm3-63bc3.firebaseapp.com",
  projectId: "runrealm3-63bc3",
  storageBucket: "runrealm3-63bc3.firebasestorage.app",
  messagingSenderId: "358048866655",
  appId: "1:358048866655:web:2152bd778ffc0a71afd6ea",
  measurementId: "G-4F56HGM34Q"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Firestore's default WebChannel transport is unreliable in React Native
// (repeated "RPC 'Listen' stream transport errored" → offline mode), so force
// long-polling, which is the documented fix for Firebase JS SDK on RN.
// try/catch so Fast Refresh re-runs don't throw "Firestore already initialized".
let db;
try {
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch {
  db = getFirestore(app);
}

// Auth needs explicit AsyncStorage persistence on RN, otherwise the anonymous
// user is forgotten on every app restart (memory persistence) and each launch
// would mint a brand-new identity. Same try/catch guard for Fast Refresh.
let auth;
try {
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  auth = getAuth(app);
}

// AsyncStorage keys. 'userId' is the pre-auth Runner-XXXX id — kept (read-only)
// so existing installs carry their friendly name over to the auth identity.
const LEGACY_ID_KEY = 'userId';
const DISPLAY_NAME_KEY = 'displayName';

// Resolves once Auth has restored (or failed to restore) a persisted session.
function getInitialUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// Every user gets a users/{uid} doc holding their friendly display name:
// - existing installs keep their old Runner-XXXX from AsyncStorage,
// - fresh installs get a newly generated one.
// The name is cached locally so it survives offline launches without
// regenerating, and the users doc is also where the Cloud Function looks up
// pushToken.
async function ensureUserProfile(uid) {
  const cached = await AsyncStorage.getItem(DISPLAY_NAME_KEY).catch(() => null);
  if (cached) return cached;

  const userRef = doc(db, 'users', uid);
  let displayName = null;
  try {
    const snapshot = await getDoc(userRef);
    if (snapshot.exists()) displayName = snapshot.data().displayName ?? null;
  } catch {
    // offline — fall through and pick a name locally; the setDoc below will
    // sync whenever Firestore is reachable again.
  }

  if (!displayName) {
    const legacyId = await AsyncStorage.getItem(LEGACY_ID_KEY).catch(() => null);
    displayName = legacyId || generateUserId();
    setDoc(userRef, { displayName, createdAt: serverTimestamp() }, { merge: true })
      .catch(() => {});
  }

  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName).catch(() => {});
  return displayName;
}

// Idempotent sign-in: safe to await from multiple screens. Resolves to
// { uid, displayName }. On failure the promise is cleared so the next call
// retries instead of caching the error forever.
let signInPromise = null;
function ensureSignedIn() {
  if (!signInPromise) {
    signInPromise = (async () => {
      let user = await getInitialUser();
      if (!user) ({ user } = await signInAnonymously(auth));
      const displayName = await ensureUserProfile(user.uid);
      return { uid: user.uid, displayName };
    })().catch((error) => {
      signInPromise = null;
      throw error;
    });
  }
  return signInPromise;
}

export { app, db, auth, ensureSignedIn };
