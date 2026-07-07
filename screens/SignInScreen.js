import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import {
  getGoogleAuthConfig, signInWithGoogleIdToken,
  signInWithEmail, signUpWithEmail, resetPassword,
} from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import { useNotification } from '../NotificationContext';
import { useTheme } from '../theme/ThemeProvider';

// Closes the OAuth popup/browser tab when the redirect returns to the app.
WebBrowser.maybeCompleteAuthSession();

// Human messages for the Firebase auth error codes users actually hit.
const AUTH_ERRORS = {
  'auth/invalid-email': 'That email address doesn\'t look right.',
  'auth/user-not-found': 'No account with that email — try "Create account".',
  'auth/wrong-password': 'Wrong password. Use "Forgot password?" if needed.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'That email already has an account — sign in instead.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts — wait a bit and try again.',
  'auth/network-request-failed': 'No connection. Check your network and retry.',
};
const authErrorMessage = (error) =>
  AUTH_ERRORS[error?.code] ?? error?.message ?? 'Something went wrong — try again.';

// Own component so the useIdTokenAuthRequest hook only runs when client ids
// are configured (hooks can't be called conditionally, components can).
function GoogleSignInButton({ config, busy, setBusy, styles }) {
  const { notify } = useNotification();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: config.webClientId || undefined,
    iosClientId: config.iosClientId || undefined,
    androidClientId: config.androidClientId || undefined,
  });

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params?.id_token;
      if (!idToken) {
        notify.error('Google sign-in returned no credential — try again.');
        return;
      }
      (async () => {
        try {
          setBusy(true);
          await signInWithGoogleIdToken(idToken);
          // AuthProvider's onAuthStateChanged takes it from here.
        } catch (error) {
          notify.error(authErrorMessage(error));
        } finally {
          setBusy(false);
        }
      })();
    } else if (response.type === 'error') {
      notify.error('Google sign-in failed — try again.');
    }
  }, [response]);

  return (
    <TouchableOpacity
      style={[styles.primaryButton, (!request || busy) && styles.buttonDisabled]}
      onPress={() => promptAsync()}
      disabled={!request || busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
    >
      <Text style={styles.primaryButtonText}>Continue with Google</Text>
    </TouchableOpacity>
  );
}

export default function SignInScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { notify } = useNotification();
  const { user, continueAsGuest, setShowSignIn } = useAuth();

  const [step, setStep] = useState('options'); // 'options' | 'email'
  const [mode, setMode] = useState('signin');  // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const googleConfig = useMemo(() => getGoogleAuthConfig(), []);
  // Screen doubles as the "upgrade account" screen for signed-in guests.
  const isUpgrade = Boolean(user);

  const submitEmail = async () => {
    if (!email.trim() || !password) {
      notify.error('Enter an email and password.');
      return;
    }
    try {
      setBusy(true);
      if (mode === 'signup') await signUpWithEmail(email, password);
      else await signInWithEmail(email, password);
      // AuthProvider's onAuthStateChanged takes it from here (including the
      // pick-a-display-name step for first-time email users).
    } catch (error) {
      notify.error(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!email.trim()) {
      notify.error('Enter your email first, then tap "Forgot password?".');
      return;
    }
    try {
      setBusy(true);
      await resetPassword(email);
      notify.success('Password reset email sent — check your inbox.');
    } catch (error) {
      notify.error(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    try {
      setBusy(true);
      await continueAsGuest();
    } catch (error) {
      notify.error(authErrorMessage(error));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.bg} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {isUpgrade && (
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setShowSignIn(false)}
            accessibilityRole="button"
            accessibilityLabel="Close sign-in"
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </TouchableOpacity>
        )}

        <View style={styles.hero}>
          <Text style={styles.logo}>RunRealm</Text>
          <Text style={styles.tagline}>Run loops. Claim streets.</Text>
        </View>

        {step === 'options' ? (
          <View style={styles.card}>
            {googleConfig.enabled ? (
              <GoogleSignInButton
                config={googleConfig}
                busy={busy}
                setBusy={setBusy}
                styles={styles}
              />
            ) : (
              <View style={[styles.primaryButton, styles.buttonDisabled]}>
                <Text style={styles.primaryButtonText}>Continue with Google</Text>
                <Text style={styles.setupHint}>
                  Needs OAuth client ids in app.json → extra.googleAuth
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setStep('email')}
              disabled={busy}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Continue with Email"
            >
              <Text style={styles.secondaryButtonText}>Continue with Email</Text>
            </TouchableOpacity>

            {busy && <ActivityIndicator color={theme.primary} style={styles.spinner} />}

            {!isUpgrade && (
              <TouchableOpacity
                onPress={guest}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Continue as Guest"
              >
                <Text style={styles.guestLink}>Continue as Guest</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.formTitle}>
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={theme.textMuted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              accessibilityLabel="Email"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={theme.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'signup' ? 'new-password' : 'password'}
              accessibilityLabel="Password"
            />

            <TouchableOpacity
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
              onPress={submitEmail}
              disabled={busy}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {busy
                ? <ActivityIndicator color={theme.onPrimary} />
                : (
                  <Text style={styles.primaryButtonText}>
                    {mode === 'signup' ? 'Create account' : 'Sign in'}
                  </Text>
                )}
            </TouchableOpacity>

            <View style={styles.formLinks}>
              <TouchableOpacity onPress={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
                <Text style={styles.linkText}>
                  {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create account'}
                </Text>
              </TouchableOpacity>
              {mode === 'signin' && (
                <TouchableOpacity onPress={forgotPassword}>
                  <Text style={styles.linkText}>Forgot password?</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity onPress={() => setStep('options')}>
              <Text style={styles.guestLink}>← Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (t) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  flex: { flex: 1, justifyContent: 'center' },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 20,
    zIndex: 1,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { color: t.textDim, fontSize: 16, fontWeight: '700' },
  hero: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logo: {
    fontSize: 40,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 14,
    color: t.textMuted,
    fontWeight: '600',
    marginTop: 6,
  },
  card: {
    paddingHorizontal: 28,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: t.primary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: t.onPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: t.text,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: { opacity: 0.55 },
  setupHint: {
    color: t.onPrimary,
    fontSize: 10,
    marginTop: 4,
    opacity: 0.85,
  },
  guestLink: {
    color: t.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 16,
    textDecorationLine: 'underline',
  },
  spinner: { marginTop: 8 },
  formTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: t.text,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  input: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: t.text,
  },
  formLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  linkText: {
    color: t.primary,
    fontSize: 13,
    fontWeight: '600',
  },
});
