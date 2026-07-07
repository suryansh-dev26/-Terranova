import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image, Modal, TextInput,
  StatusBar, ActivityIndicator, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, uploadAvatar, signOutUser, deleteAccountAndData } from './firebase';
import { getUserColor } from './lib/geo';
import { invalidateUserDirectory } from './lib/userDirectory';
import { useAuth } from './auth/AuthProvider';
import { useTheme } from './theme/ThemeProvider';
import { useNotification } from './NotificationContext';
import { NAME_MIN, NAME_MAX } from './screens/DisplayNameScreen';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function ProfileScreen() {
  const { theme, preference, setPreference } = useTheme();
  const { notify } = useNotification();
  const { user, profile, isGuest, refreshProfile, applyProfileUpdate, setShowSignIn } = useAuth();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const userId = user?.uid ?? null;
  const displayName = profile?.displayName ?? null;

  const [stats, setStats] = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (userId) loadProfileStats(userId);
  }, [userId]);

  const loadProfileStats = async (uid) => {
    try {
      setLoading(true);
      // Runs saved before the auth migration are keyed by the old Runner-XXXX
      // id (still in AsyncStorage) — include them so stats/streak carry over.
      const legacyId = await AsyncStorage.getItem('userId').catch(() => null);
      const ownIds = legacyId && legacyId !== uid ? [uid, legacyId] : [uid];

      const [runsSnap, terrSnap] = await Promise.all([
        getDocs(query(collection(db, 'runs'), where('userId', 'in', ownIds))),
        getDocs(query(collection(db, 'territories'), where('userId', 'in', ownIds))),
      ]);

      const runs = runsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const territories = terrSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const totalDistance = runs.reduce((sum, r) => sum + (r.distance || 0), 0);
      const totalArea = territories.reduce((sum, t) => sum + (t.area || 0), 0);
      const totalRuns = runs.length;
      const bestRun = runs.reduce((max, r) => Math.max(max, r.area || 0), 0);

      // Sort runs by date (newest first) for streak + recent + member-since.
      const dated = runs
        .map(r => ({ ...r, date: r.createdAt?.toDate ? r.createdAt.toDate() : null }))
        .filter(r => r.date)
        .sort((a, b) => b.date - a.date);

      const memberSince = dated.length ? dated[dated.length - 1].date : null;
      const streak = computeStreak(dated.map(r => r.date));

      setStats({ totalDistance, totalArea, totalRuns, bestRun, streak, memberSince });
      setRecentRuns(dated.slice(0, 3));
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  // Consecutive calendar days (ending today or yesterday) with >= 1 run.
  const computeStreak = (dates) => {
    if (!dates.length) return 0;
    const dayKey = (d) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.getTime();
    };
    const days = new Set(dates.map(dayKey));
    const ONE_DAY = 86400000;
    const today = dayKey(new Date());

    // Streak must include today or yesterday, otherwise it's broken.
    let cursor;
    if (days.has(today)) cursor = today;
    else if (days.has(today - ONE_DAY)) cursor = today - ONE_DAY;
    else return 0;

    let streak = 0;
    while (days.has(cursor)) {
      streak += 1;
      cursor -= ONE_DAY;
    }
    return streak;
  };

  // ── Profile editing ──

  const changePhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        notify.error('Photo access denied — allow it in Settings to change your picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.length) return;
      setUploadingPhoto(true);
      await uploadAvatar(result.assets[0].uri);
      await refreshProfile();
      invalidateUserDirectory();
      notify.success('Profile photo updated!');
    } catch (error) {
      notify.error(`Couldn't update photo: ${error?.message ?? 'try again.'}`);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const openNameEditor = () => {
    setNameDraft(displayName ?? '');
    setEditingName(true);
  };

  const nameDraftTrimmed = nameDraft.trim();
  const nameValid = nameDraftTrimmed.length >= NAME_MIN && nameDraftTrimmed.length <= NAME_MAX;

  const saveName = async () => {
    if (!nameValid) {
      notify.error(`Display name must be ${NAME_MIN}–${NAME_MAX} characters.`);
      return;
    }
    try {
      setSavingName(true);
      await applyProfileUpdate({ displayName: nameDraftTrimmed });
      setEditingName(false);
      notify.success('Display name updated!');
    } catch (error) {
      notify.error(`Couldn't save name: ${error?.message ?? 'try again.'}`);
    } finally {
      setSavingName(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Your runs and territories stay on your account — sign back in anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => signOutUser().catch((e) => notify.error(e?.message ?? 'Sign out failed.')),
        },
      ],
    );
  };

  // Play Store data-deletion requirement: two-step confirm, then the
  // deleteUserData Cloud Function purges everything server-side. The auth
  // gate takes over (sign-in screen) once the account is gone.
  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete account and data?',
      'This permanently deletes your runs, territories, and profile from RunRealm. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete everything', style: 'destructive', onPress: deleteAccount },
      ],
    );
  };

  const deleteAccount = async () => {
    try {
      setDeleting(true);
      await deleteAccountAndData();
      notify.success('All your data has been deleted.');
    } catch (error) {
      notify.error(`Couldn't delete data: ${error?.message ?? 'try again later.'}`);
      setDeleting(false);
    }
  };

  // ── Formatting ──

  const formatDistance = (meters) => {
    if (!meters) return '0 m';
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatArea = (sqm) => {
    if (!sqm) return '0 m²';
    if (sqm < 10000) return `${sqm.toLocaleString()} m²`;
    return `${(sqm / 1000000).toFixed(4)} km²`;
  };

  const formatDate = (date) => {
    if (!date) return '—';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatTime = (secs) => {
    const m = Math.floor((secs || 0) / 60).toString().padStart(2, '0');
    const s = ((secs || 0) % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.bg} />
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const avatarColor = getUserColor(userId).hex;
  const initial = (displayName || '?').charAt(0).toUpperCase();

  const STAT_CARDS = [
    { label: 'TOTAL DISTANCE', value: formatDistance(stats?.totalDistance), emoji: '🏃' },
    { label: 'AREA OWNED', value: formatArea(stats?.totalArea), emoji: '🗺️' },
    { label: 'TOTAL RUNS', value: `${stats?.totalRuns ?? 0}`, emoji: '✅' },
    { label: 'BEST RUN', value: formatArea(stats?.bestRun), emoji: '🏆' },
    { label: 'CURRENT STREAK', value: `${stats?.streak ?? 0} day${stats?.streak === 1 ? '' : 's'}`, emoji: '🔥' },
    { label: 'MEMBER SINCE', value: formatDate(stats?.memberSince), emoji: '📅' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.bg} />

      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>Your running stats 📊</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity */}
        <View style={styles.identity}>
          <TouchableOpacity
            onPress={changePhoto}
            disabled={uploadingPhoto}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            {profile?.photoURL ? (
              <Image source={{ uri: profile.photoURL }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              {uploadingPhoto
                ? <ActivityIndicator size="small" color={theme.onPrimary} />
                : <Text style={styles.avatarEditGlyph}>✎</Text>}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={openNameEditor}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Edit display name"
          >
            <Text style={styles.username}>{displayName ?? 'Unknown'} <Text style={styles.editHint}>✎</Text></Text>
          </TouchableOpacity>
          {user?.email ? <Text style={styles.emailText}>{user.email}</Text> : null}
          <Text style={styles.usernameSub}>
            {stats?.totalRuns ?? 0} run{stats?.totalRuns === 1 ? '' : 's'} · {formatArea(stats?.totalArea)}
            {isGuest ? ' · Guest' : ''}
          </Text>
        </View>

        {/* 2x3 stats grid */}
        <View style={styles.grid}>
          {STAT_CARDS.map((card) => (
            <View key={card.label} style={styles.statCard}>
              <Text style={styles.statEmoji}>{card.emoji}</Text>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                {card.value}
              </Text>
              <Text style={styles.statLabel}>{card.label}</Text>
            </View>
          ))}
        </View>

        {/* Recent runs */}
        <Text style={styles.sectionTitle}>Recent Runs</Text>
        {recentRuns.length === 0 ? (
          <View style={styles.emptyRecent}>
            <Text style={styles.emptyEmoji}>🏃</Text>
            <Text style={styles.emptyText}>No runs yet!</Text>
            <Text style={styles.emptySubText}>Complete a run to see it here.</Text>
          </View>
        ) : (
          recentRuns.map((run) => (
            <View key={run.id} style={styles.runCard}>
              <View style={styles.runTop}>
                <Text style={styles.runDate}>{formatDate(run.date)}</Text>
                <View style={styles.timeBlock}>
                  <Text style={styles.miniLabel}>TIME</Text>
                  <Text style={styles.timeValue}>{formatTime(run.time)}</Text>
                </View>
              </View>
              <View style={styles.runDivider} />
              <View style={styles.runStats}>
                <View>
                  <Text style={styles.miniLabel}>DISTANCE</Text>
                  <Text style={styles.miniValue}>{formatDistance(run.distance)}</Text>
                </View>
                <View>
                  <Text style={styles.miniLabel}>AREA</Text>
                  <Text style={styles.miniValue}>{formatArea(run.area)}</Text>
                </View>
              </View>
            </View>
          ))
        )}

        {/* Settings */}
        <Text style={styles.sectionTitle}>Settings</Text>
        <View style={styles.settingCard}>
          <Text style={styles.settingLabel}>Theme</Text>
          <View style={styles.themeOptions} accessibilityRole="radiogroup">
            {THEME_OPTIONS.map((option) => {
              const selected = preference === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.themeOption, selected && styles.themeOptionActive]}
                  onPress={() => setPreference(option.value)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.label} theme`}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.themeOptionText, selected && styles.themeOptionTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {isGuest ? (
          <TouchableOpacity
            style={styles.settingCard}
            onPress={() => setShowSignIn(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Sign in or create account"
          >
            <Text style={styles.upgradeLabel}>Sign in or create account</Text>
            <Text style={styles.dangerChevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.settingCard}
            onPress={handleSignOut}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text style={styles.settingLabel}>Sign out</Text>
            <Text style={styles.dangerChevron}>›</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.settingCard}
          onPress={confirmDeleteAccount}
          disabled={deleting}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Delete my account and data"
        >
          <Text style={styles.dangerLabel}>
            {deleting ? 'Deleting your data…' : 'Delete my account and data'}
          </Text>
          {deleting
            ? <ActivityIndicator color={theme.danger} size="small" />
            : <Text style={styles.dangerChevron}>›</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* Display-name editor */}
      <Modal
        visible={editingName}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingName(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit display name</Text>
            <TextInput
              style={styles.modalInput}
              value={nameDraft}
              onChangeText={setNameDraft}
              maxLength={NAME_MAX}
              autoFocus
              autoCapitalize="none"
              accessibilityLabel="Display name"
            />
            <Text style={styles.modalCounter}>
              {nameDraftTrimmed.length}/{NAME_MAX}
              {nameDraftTrimmed.length < NAME_MIN ? ` — at least ${NAME_MIN}` : ''}
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEditingName(false)} disabled={savingName}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSave, (!nameValid || savingName) && styles.modalSaveDisabled]}
                onPress={saveName}
                disabled={!nameValid || savingName}
              >
                {savingName
                  ? <ActivityIndicator size="small" color={theme.onPrimary} />
                  : <Text style={styles.modalSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (t) => {
  const CARD_SHADOW = {
    shadowColor: t.shadowSoft,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  };

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.bg,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 64,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.hairline,
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      color: t.text,
      letterSpacing: -0.6,
    },
    subtitle: {
      fontSize: 13,
      color: t.textMuted,
      fontWeight: '500',
      marginTop: 2,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 120,
    },

    // Identity
    identity: {
      alignItems: 'center',
      marginBottom: 24,
    },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
      ...CARD_SHADOW,
    },
    avatarImage: {
      width: 84,
      height: 84,
      borderRadius: 42,
      marginBottom: 12,
      backgroundColor: t.surfaceAlt,
    },
    avatarEditBadge: {
      position: 'absolute',
      right: -2,
      bottom: 10,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: t.bg,
    },
    avatarEditGlyph: {
      color: t.onPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    avatarText: {
      fontSize: 36,
      fontWeight: '800',
      color: t.onPrimary,
    },
    username: {
      fontSize: 22,
      fontWeight: '800',
      color: t.text,
      letterSpacing: -0.4,
    },
    editHint: {
      fontSize: 14,
      color: t.textMuted,
    },
    emailText: {
      fontSize: 12,
      color: t.textMuted,
      fontWeight: '500',
      marginTop: 2,
    },
    usernameSub: {
      fontSize: 13,
      color: t.textMuted,
      fontWeight: '500',
      marginTop: 3,
    },

    // Stats grid
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    statCard: {
      width: '48%',
      backgroundColor: t.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 12,
      ...CARD_SHADOW,
    },
    statEmoji: {
      fontSize: 20,
      marginBottom: 8,
    },
    statValue: {
      fontSize: 18,
      fontWeight: '800',
      color: t.primary,
      letterSpacing: -0.4,
    },
    statLabel: {
      fontSize: 8,
      color: t.textMuted,
      fontWeight: '700',
      letterSpacing: 0.8,
      marginTop: 4,
    },

    // Sections
    sectionTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: t.text,
      letterSpacing: -0.3,
      marginTop: 8,
      marginBottom: 12,
    },
    runCard: {
      backgroundColor: t.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 10,
      ...CARD_SHADOW,
    },
    runTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    runDate: {
      fontSize: 14,
      fontWeight: '700',
      color: t.text,
    },
    timeBlock: { alignItems: 'flex-end' },
    timeValue: {
      fontSize: 18,
      fontWeight: '800',
      color: t.primary,
      letterSpacing: -0.4,
    },
    runDivider: {
      height: 1,
      backgroundColor: t.border,
      marginVertical: 12,
    },
    runStats: {
      flexDirection: 'row',
      gap: 24,
    },
    miniLabel: {
      fontSize: 8,
      color: t.textMuted,
      fontWeight: '700',
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    miniValue: {
      fontSize: 13,
      fontWeight: '700',
      color: t.textStrong,
    },

    // Settings
    settingCard: {
      backgroundColor: t.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      ...CARD_SHADOW,
    },
    settingLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: t.text,
    },
    upgradeLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: t.primary,
    },
    themeOptions: {
      flexDirection: 'row',
      backgroundColor: t.surfaceAlt,
      borderRadius: 10,
      padding: 3,
      gap: 2,
    },
    themeOption: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    themeOptionActive: {
      backgroundColor: t.surface,
      shadowColor: t.shadowSoft,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    themeOptionText: {
      fontSize: 12,
      fontWeight: '600',
      color: t.textDim,
    },
    themeOptionTextActive: {
      color: t.primary,
      fontWeight: '700',
    },
    dangerLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: t.danger,
    },
    dangerChevron: {
      fontSize: 18,
      fontWeight: '700',
      color: t.textMuted,
    },

    // Name editor modal
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
    },
    modalCard: {
      width: '100%',
      backgroundColor: t.surface,
      borderRadius: 18,
      padding: 20,
      gap: 8,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: t.text,
      letterSpacing: -0.3,
    },
    modalInput: {
      backgroundColor: t.bg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      fontSize: 16,
      fontWeight: '600',
      color: t.text,
    },
    modalCounter: {
      fontSize: 11,
      color: t.textMuted,
      textAlign: 'right',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 18,
      marginTop: 4,
    },
    modalCancel: {
      fontSize: 14,
      fontWeight: '600',
      color: t.textDim,
    },
    modalSave: {
      backgroundColor: t.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 20,
      minWidth: 74,
      alignItems: 'center',
    },
    modalSaveDisabled: { opacity: 0.55 },
    modalSaveText: {
      color: t.onPrimary,
      fontSize: 14,
      fontWeight: '700',
    },

    // States
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    loadingText: { color: t.textMuted, marginTop: 12, fontSize: 14 },
    emptyRecent: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 32,
      gap: 6,
    },
    emptyEmoji: { fontSize: 40, marginBottom: 8 },
    emptyText: { color: t.text, fontSize: 18, fontWeight: '700' },
    emptySubText: { color: t.textMuted, fontSize: 14 },
  });
};
