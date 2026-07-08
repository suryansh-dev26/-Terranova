// Single Firebase entry point for RunRealm3. Every screen imports { db } (and
// auth/account helpers) from here — do NOT call initializeApp/initializeFirestore
// anywhere else, or config changes will drift between copies.
//
// Spark-plan constraint: this app uses NO Cloud Functions and NO Firebase
// Storage. Account deletion runs client-side (see deleteAccountAndData),
// avatars come from the Google account's photoURL, and there is no
// guest-data migration or push notification backend.
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore, getFirestore, collection, doc, getDoc, getDocs,
  query, where, limit, setDoc, deleteDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import {
  initializeAuth, getAuth, getReactNativePersistence,
  onAuthStateChanged, signInAnonymously, signOut,
  GoogleAuthProvider, signInWithCredential,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { generateUserId } from './lib/geo';

// This config is public by design (it identifies the project, it doesn't grant
// access) — firestore.rules is the security boundary.
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

// Auth needs explicit AsyncStorage persistence on RN, otherwise the session is
// forgotten on every app restart. Same try/catch guard for Fast Refresh.
let auth;
try {
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  auth = getAuth(app);
}

// AsyncStorage keys. 'userId' is the pre-auth Runner-XXXX id and 'displayName'
// the pre-accounts global name cache — both read-only legacy inputs now.
// Profiles are cached per-uid so switching accounts can't leak names across.
const LEGACY_ID_KEY = 'userId';
const LEGACY_NAME_KEY = 'displayName';
const profileCacheKey = (uid) => `profile:${uid}`;

// Drop null/undefined fields — firestore.rules reject e.g. a null photoURL,
// and Firestore treats missing and null differently anyway.
const compactProfile = (fields) => {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
};

const readCachedProfile = async (uid) => {
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeCachedProfile = async (uid, profile) => {
  const compact = compactProfile({
    displayName: profile.displayName,
    email: profile.email,
    photoURL: profile.photoURL,
    country: profile.country,
    region: profile.region,
    city: profile.city,
  });
  await AsyncStorage.setItem(profileCacheKey(uid), JSON.stringify(compact)).catch(() => {});
  return compact;
};

const clearCachedProfile = (uid) =>
  AsyncStorage.removeItem(profileCacheKey(uid)).catch(() => {});

// Resolves once Auth has restored (or failed to restore) a persisted session.
function getInitialUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// ─── Profiles (users/{uid}) ─────────────────────────────────────────────────

// Returns the user's profile, creating it when needed:
// - guests get a friendly Runner-XXXX (kept from pre-auth installs if present),
// - Google accounts are seeded from { displayName, email, photoURL } — the
//   photo is the Google one; there is no in-app upload on the Spark plan,
// - email accounts without a name yet get { needsDisplayName: true } and the
//   AuthGate shows the pick-a-name step before entering the app.
async function ensureUserProfile(user) {
  const uid = user.uid;
  const userRef = doc(db, 'users', uid);

  const cached = await readCachedProfile(uid);
  if (cached && cached.displayName) return cached;

  try {
    const snapshot = await getDoc(userRef);
    if (snapshot.exists() && snapshot.data().displayName) {
      return writeCachedProfile(uid, snapshot.data());
    }
  } catch {
    // offline — fall through to local/provider data; setDoc below syncs later.
  }

  if (user.isAnonymous) {
    const legacyName = await AsyncStorage.getItem(LEGACY_NAME_KEY).catch(() => null);
    const legacyId = await AsyncStorage.getItem(LEGACY_ID_KEY).catch(() => null);
    const displayName = legacyName || legacyId || generateUserId();
    setDoc(userRef, { displayName, createdAt: serverTimestamp() }, { merge: true })
      .catch(() => {});
    return writeCachedProfile(uid, { displayName });
  }

  if (user.displayName) {
    const profile = compactProfile({
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
    });
    setDoc(userRef, { ...profile, createdAt: serverTimestamp() }, { merge: true })
      .catch(() => {});
    return writeCachedProfile(uid, profile);
  }

  // Email first sign-in: no display name anywhere yet.
  return { displayName: null, email: user.email ?? null, needsDisplayName: true };
}

// Fresh read (bypasses cache) — used after edits.
async function fetchProfile(uid) {
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) return null;
  return writeCachedProfile(uid, snapshot.data());
}

// Merge-write profile fields for the current user and refresh the cache.
async function updateProfileFields(fields) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const compact = compactProfile(fields);
  await setDoc(doc(db, 'users', user.uid), compact, { merge: true });
  const cached = (await readCachedProfile(user.uid)) || {};
  return writeCachedProfile(user.uid, { ...cached, ...compact });
}

// ─── Sign-in flows ──────────────────────────────────────────────────────────

// Guest flow (and the pre-accounts default): ensure some signed-in user,
// anonymous if nothing is persisted. Concurrent callers share one attempt;
// nothing is memoized across calls so sign-out/sign-in can't serve stale uids.
let inflightSignIn = null;
function ensureSignedIn() {
  if (!inflightSignIn) {
    inflightSignIn = (async () => {
      let user = auth.currentUser;
      if (!user) user = await getInitialUser();
      if (!user) ({ user } = await signInAnonymously(auth));
      const profile = await ensureUserProfile(user);
      return { uid: user.uid, displayName: profile.displayName };
    })().finally(() => { inflightSignIn = null; });
  }
  return inflightSignIn;
}

// NOTE: signing in from a guest session starts a fresh account. There is no
// guest-data migration on the Spark plan (it needed a Cloud Function to
// rewrite doc ownership); the SignInScreen warns guests before they proceed.
function signInWithGoogleIdToken(idToken) {
  return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

function signUpWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

function signOutUser() {
  return signOut(auth);
}

// Google OAuth client ids live in app.json extra.googleAuth — they're created
// in the Google Cloud console and safe to ship in the binary. When they're
// blank the Google button renders disabled with a setup hint.
function getGoogleAuthConfig() {
  const extra =
    (Constants.expoConfig && Constants.expoConfig.extra) ||
    (Constants.manifest2 && Constants.manifest2.extra) || {};
  const config = extra.googleAuth || {};
  const hasAnyClientId = Boolean(
    config.webClientId || config.iosClientId || config.androidClientId,
  );
  return { ...config, enabled: hasAnyClientId };
}

// ─── Account deletion (client-side, Spark plan) ─────────────────────────────

// Play Store data-deletion requirement without Cloud Functions: the client
// purges everything it owns under the owner-delete rules (runs, territories,
// users/{uid} — add badges/challenges here when those collections ship),
// then deletes the auth account itself.
const PURGE_BATCH = 400;

async function deleteAccountAndData() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const uid = user.uid;

  for (const collectionName of ['runs', 'territories']) {
    // Batched deletes, looping until the query drains (500-write batch cap).
    for (;;) {
      const snap = await getDocs(query(
        collection(db, collectionName),
        where('userId', '==', uid),
        limit(PURGE_BATCH),
      ));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      if (snap.size < PURGE_BATCH) break;
    }
  }
  await deleteDoc(doc(db, 'users', uid));

  await AsyncStorage.multiRemove([LEGACY_ID_KEY, LEGACY_NAME_KEY]).catch(() => {});
  await clearCachedProfile(uid);

  // Deleting the auth record can demand a recent sign-in (Firebase client
  // policy, typically for older Google/email sessions). The data is already
  // gone either way — report back so the UI can say "sign in again to finish
  // removing the account".
  try {
    await user.delete(); // also signs out → AuthGate shows the sign-in screen
    return { authDeleted: true };
  } catch {
    await signOut(auth).catch(() => {});
    return { authDeleted: false };
  }
}

export {
  app, db, auth,
  ensureSignedIn, ensureUserProfile, fetchProfile, updateProfileFields,
  signInWithGoogleIdToken, signInWithEmail, signUpWithEmail, resetPassword, signOutUser,
  getGoogleAuthConfig, deleteAccountAndData,
};
