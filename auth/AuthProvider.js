import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import {
  auth, ensureSignedIn, ensureUserProfile, fetchProfile, updateProfileFields,
  peekGuestSession, dropGuestSession, guestHasData, importGuestData,
} from '../firebase';
import { useNotification } from '../NotificationContext';
import { invalidateUserDirectory } from '../lib/userDirectory';

// App-wide identity: the Firebase user plus their users/{uid} profile doc.
// The AuthGate in App.js renders sign-in / name-prompt / app based on this.
const AuthContext = createContext({
  user: undefined,
  profile: null,
  initializing: true,
  isGuest: false,
  needsDisplayName: false,
  showSignIn: false,
  setShowSignIn: () => {},
  continueAsGuest: async () => {},
  refreshProfile: async () => {},
  applyProfileUpdate: async () => {},
});

export function AuthProvider({ children }) {
  const { notify } = useNotification();
  // undefined = still restoring the persisted session; null = signed out.
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  // Lets a signed-in guest open the sign-in screen to upgrade their account.
  const [showSignIn, setShowSignIn] = useState(false);

  // Guard against out-of-order async resolutions when auth switches fast
  // (guest → Google fires two state changes back to back).
  const seqRef = useRef(0);
  const importPromptBusyRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      const seq = ++seqRef.current;
      setUser(nextUser ?? null);
      if (!nextUser) {
        setProfile(null);
        return;
      }
      setShowSignIn(false);
      try {
        const nextProfile = await ensureUserProfile(nextUser);
        if (seqRef.current === seq) setProfile(nextProfile);
      } catch (e) {
        if (seqRef.current === seq) setProfile(null);
      }
      if (!nextUser.isAnonymous) maybeOfferGuestImport(nextUser);
    });
    return unsubscribe;
  }, []);

  // "Import my guest data?" — offered once, right after a guest upgrades to a
  // real account, and only when the guest identity actually owns docs.
  const maybeOfferGuestImport = async (realUser) => {
    const guest = peekGuestSession();
    if (!guest || guest.uid === realUser.uid || importPromptBusyRef.current) return;
    importPromptBusyRef.current = true;
    try {
      if (!(await guestHasData(guest))) {
        dropGuestSession();
        return;
      }
      Alert.alert(
        'Import your guest data?',
        'Your runs and territories from the guest session can be moved to this account.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => dropGuestSession() },
          {
            text: 'Import',
            onPress: async () => {
              try {
                await importGuestData(guest);
                invalidateUserDirectory();
                notify.success('Guest data imported!');
              } catch (error) {
                notify.error(`Import failed: ${error?.message ?? 'try again later.'}`);
              }
            },
          },
        ],
      );
    } finally {
      importPromptBusyRef.current = false;
    }
  };

  const continueAsGuest = async () => {
    // ensureSignedIn signs in anonymously; onAuthStateChanged does the rest.
    await ensureSignedIn();
    setShowSignIn(false);
  };

  const refreshProfile = async () => {
    const current = auth.currentUser;
    if (!current) return;
    try {
      const fresh = await fetchProfile(current.uid);
      if (fresh) setProfile(fresh);
    } catch {
      // offline — keep what we have
    }
  };

  // Merge-write profile fields (display name, photo, email) and keep the
  // context + leaderboard directory in sync.
  const applyProfileUpdate = async (fields) => {
    await updateProfileFields(fields);
    setProfile((prev) => ({ ...(prev || {}), ...fields, needsDisplayName: false }));
    invalidateUserDirectory();
  };

  const value = useMemo(() => ({
    user: user === undefined ? undefined : user,
    profile,
    initializing: user === undefined,
    isGuest: Boolean(user && user.isAnonymous),
    needsDisplayName: Boolean(user && !user.isAnonymous && profile?.needsDisplayName),
    showSignIn,
    setShowSignIn,
    continueAsGuest,
    refreshProfile,
    applyProfileUpdate,
  }), [user, profile, showSignIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
