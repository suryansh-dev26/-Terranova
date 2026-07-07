import { useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { useNotification } from '../NotificationContext';
import { useTheme } from '../theme/ThemeProvider';

export const NAME_MIN = 3;
export const NAME_MAX = 20;

// Shown once, after a first email sign-in: pick the name other runners see.
// Default suggestion is the part of the email before the @.
export default function DisplayNameScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { notify } = useNotification();
  const { user, applyProfileUpdate } = useAuth();

  const suggestion = (user?.email ?? '').split('@')[0].slice(0, NAME_MAX);
  const [name, setName] = useState(suggestion);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;

  const save = async () => {
    if (!valid) {
      notify.error(`Display name must be ${NAME_MIN}–${NAME_MAX} characters.`);
      return;
    }
    try {
      setSaving(true);
      await applyProfileUpdate({ displayName: trimmed, email: user?.email ?? null });
      // AuthGate re-renders into the app once needsDisplayName clears.
    } catch (error) {
      notify.error(`Couldn't save name: ${error?.message ?? 'try again.'}`);
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.bg} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Pick your runner name</Text>
          <Text style={styles.subtitle}>
            This is what other runners see on the map and leaderboard.
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            autoFocus
            autoCapitalize="none"
            accessibilityLabel="Display name"
          />
          <Text style={styles.counter}>
            {trimmed.length}/{NAME_MAX}{trimmed.length < NAME_MIN ? ` — at least ${NAME_MIN}` : ''}
          </Text>
          <TouchableOpacity
            style={[styles.button, (!valid || saving) && styles.buttonDisabled]}
            onPress={save}
            disabled={!valid || saving}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Save display name"
          >
            {saving
              ? <ActivityIndicator color={theme.onPrimary} />
              : <Text style={styles.buttonText}>Let's run</Text>}
          </TouchableOpacity>
        </View>
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
  card: {
    paddingHorizontal: 28,
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: t.textMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 17,
    fontWeight: '600',
    color: t.text,
  },
  counter: {
    fontSize: 12,
    color: t.textMuted,
    textAlign: 'right',
  },
  button: {
    backgroundColor: t.primary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: {
    color: t.onPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
});
