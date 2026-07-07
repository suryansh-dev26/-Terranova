// Single Firebase entry point for RunRealm3. Every screen imports { db } (and
// auth/account helpers) from here — do NOT call initializeApp/initializeFirestore
// anywhere else, or config changes will drift between copies.
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore, getFirestore, collection, doc, getDoc, getDocs,
  query, where, limit, setDoc, serverTimestamp,
} from 'firebase/firestore';
import {
  initializeAuth, getAuth, getReactNativePersistence,
  onAuthStateChanged, signInAnonymously, signOut,
  GoogleAuthProvider, signInWithCredential,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { generateUserId } from './lib/geo';

// This config is public by design (it identifies the project, it doesn't grant
// access) — firestore.rules / storage.rules are the security boundary.
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

const storage = getStorage(app);
const functionsInstance = getFunctions(app);

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
// - Google accounts are seeded from { displayName, email, photoURL },
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

// Fresh read (bypasses cache) — used after edits/migration.
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

// Avatar upload: Storage path users/{uid}/avatar.jpg (owner-writable per
// storage.rules), then the download URL is saved to users/{uid}.photoURL.
async function uploadAvatar(localUri) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const response = await fetch(localUri);
  const blob = await response.blob();
  const avatarRef = storageRef(storage, `users/${user.uid}/avatar.jpg`);
  await uploadBytes(avatarRef, blob, { contentType: 'image/jpeg' });
  const photoURL = await getDownloadURL(avatarRef);
  await updateProfileFields({ photoURL });
  return photoURL;
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

// Before switching from a guest session to a real account, capture proof of
// the guest identity (its ID token, valid ~1h). migrateGuestData verifies it
// server-side, so users can only import data they actually own.
let guestSession = null;

async function stashGuestSession() {
  const user = auth.currentUser;
  if (!user || !user.isAnonymous) return;
  try {
    const token = await user.getIdToken();
    const legacyId = await AsyncStorage.getItem(LEGACY_ID_KEY).catch(() => null);
    guestSession = { uid: user.uid, token, legacyId };
  } catch {
    guestSession = null;
  }
}

const peekGuestSession = () => guestSession;
const dropGuestSession = () => { guestSession = null; };

// Quick public-read probe: does the stashed guest identity own any docs?
// Decides whether the "Import my guest data?" prompt is worth showing.
async function guestHasData(guest) {
  const ids = guest.legacyId && guest.legacyId !== guest.uid
    ? [guest.uid, guest.legacyId]
    : [guest.uid];
  try {
    for (const collectionName of ['runs', 'territories']) {
      const snap = await getDocs(
        query(collection(db, collectionName), where('userId', 'in', ids), limit(1)),
      );
      if (!snap.empty) return true;
    }
  } catch {}
  return false;
}

// Rewrites the guest's docs onto the current (real) account via the
// migrateGuestData Cloud Function, then discards the stash.
async function importGuestData(guest) {
  try {
    await httpsCallable(functionsInstance, 'migrateGuestData')({
      guestIdToken: guest.token,
      legacyId: guest.legacyId,
    });
  } finally {
    dropGuestSession();
    clearCachedProfile(guest.uid);
  }
}

async function signInWithGoogleIdToken(idToken) {
  await stashGuestSession();
  return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

async function signInWithEmail(email, password) {
  await stashGuestSession();
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

async function signUpWithEmail(email, password) {
  await stashGuestSession();
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

async function signOutUser() {
  dropGuestSession();
  await signOut(auth);
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

// ─── Account deletion ───────────────────────────────────────────────────────

// Play Store data-deletion requirement: the deleteUserData Cloud Function
// purges the caller's runs, territories, and profile server-side (Admin SDK),
// then deletes the auth account. Afterwards we drop every local trace; the
// AuthGate takes over and shows the sign-in screen.
async function deleteAccountAndData() {
  const { uid } = await ensureSignedIn();
  const legacyId = await AsyncStorage.getItem(LEGACY_ID_KEY).catch(() => null);
  await httpsCallable(functionsInstance, 'deleteUserData')({ legacyId });
  dropGuestSession();
  await AsyncStorage.multiRemove([LEGACY_ID_KEY, LEGACY_NAME_KEY]).catch(() => {});
  await clearCachedProfile(uid);
  // The server already deleted the auth user, so the local session token is
  // dead either way — signOut just clears it faster.
  await signOut(auth).catch(() => {});
}

export {
  app, db, auth, storage,
  ensureSignedIn, ensureUserProfile, fetchProfile, updateProfileFields, uploadAvatar,
  signInWithGoogleIdToken, signInWithEmail, signUpWithEmail, resetPassword, signOutUser,
  peekGuestSession, dropGuestSession, guestHasData, importGuestData,
  getGoogleAuthConfig, deleteAccountAndData,
};
