import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  StatusBar, ActivityIndicator, Image, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { getUserColor } from './lib/geo';
import { getUserDirectory } from './lib/userDirectory';
import { getLastKnownPlace } from './lib/geocode';
import { useAuth } from './auth/AuthProvider';
import { useTheme } from './theme/ThemeProvider';

// Medal accents for the top 3 — deliberately NOT themed: gold/silver/bronze
// should look like gold/silver/bronze in both light and dark mode.
const RANK_META = [
  { emoji: '🥇', bg: '#fffbeb', border: '#fde68a', text: '#92400e', labelColor: '#d97706' },
  { emoji: '🥈', bg: '#f8fafc', border: '#e2e8f0', text: '#334155', labelColor: '#64748b' },
  { emoji: '🥉', bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', labelColor: '#ea580c' },
];

const SCOPES = [
  { value: 'global', label: 'Global' },
  { value: 'country', label: 'Country' },
  { value: 'city', label: 'City' },
];

export default function LeaderboardScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { profile } = useAuth();
  const [runs, setRuns] = useState([]);
  const [directory, setDirectory] = useState({});
  const [scope, setScope] = useState('global');
  const [lastPlace, setLastPlace] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRuns();
    // Fallback place for Country/City defaults when the profile doc hasn't
    // synced a location yet (written by the geocode cache after each run).
    getLastKnownPlace().then(setLastPlace).catch(() => {});
  }, []);

  const fetchRuns = async () => {
    try {
      // One full runs fetch serves all three scopes (filtering is local), and
      // the users directory (names/photos) is cached for an hour — switching
      // tabs costs zero extra Firestore reads.
      const [snapshot, userDirectory] = await Promise.all([
        getDocs(collection(db, 'runs')),
        getUserDirectory(),
      ]);
      setRuns(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setDirectory(userDirectory);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  // The user's own place decides what "Country" and "City" mean for them.
  const myPlace = profile?.country ? profile : lastPlace;

  const players = useMemo(() => {
    let scoped = runs;
    if (scope === 'country') {
      if (!myPlace?.country) return [];
      scoped = runs.filter(r => r.country === myPlace.country);
    } else if (scope === 'city') {
      if (!myPlace?.city) return [];
      scoped = runs.filter(r => r.country === myPlace.country && r.city === myPlace.city);
    }

    const grouped = {};
    scoped.forEach(run => {
      const uid = run.userId || 'Unknown';
      if (!grouped[uid]) grouped[uid] = { userId: uid, displayName: null, totalArea: 0, totalDistance: 0, runCount: 0 };
      // Denormalized name on the run doc is the fallback; legacy runs'
      // userId already IS the friendly Runner-XXXX.
      if (run.displayName) grouped[uid].displayName = run.displayName;
      grouped[uid].totalArea += run.area || 0;
      grouped[uid].totalDistance += run.distance || 0;
      grouped[uid].runCount += 1;
    });
    for (const player of Object.values(grouped)) {
      const entry = directory[player.userId];
      if (entry?.displayName) player.displayName = entry.displayName;
      player.photoURL = entry?.photoURL ?? null;
    }
    return Object.values(grouped).sort((a, b) => b.totalArea - a.totalArea);
  }, [runs, directory, scope, myPlace]);

  // Firestore stores the ISO code; the friendly country name only lives in
  // the local geocode cache — use it for copy when it matches.
  const countryLabel = myPlace?.countryName
    || (lastPlace && lastPlace.country === myPlace?.country ? lastPlace.countryName : null)
    || myPlace?.country;
  const placeLabel = scope === 'city' ? myPlace?.city : countryLabel;

  const subtitle = scope === 'global'
    ? 'Most territory captured 🏴'
    : placeLabel
      ? `Top runners in ${placeLabel} 🏴`
      : 'Most territory captured 🏴';

  const formatArea = (sqm) => {
    if (!sqm) return '0 m²';
    if (sqm < 10000) return `${sqm.toLocaleString()} m²`;
    return `${(sqm / 1000000).toFixed(4)} km²`;
  };

  const formatDistance = (meters) => {
    if (!meters) return '0 m';
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const renderItem = ({ item, index }) => {
    const meta = RANK_META[index] ?? null;
    const isTop3 = index < 3;

    return (
      <View style={[
        styles.card,
        isTop3 && { backgroundColor: meta.bg, borderColor: meta.border },
      ]}>
        {/* Rank */}
        <View style={[styles.rankWrap, isTop3 && { backgroundColor: meta.border }]}>
          {isTop3
            ? <Text style={styles.rankEmoji}>{meta.emoji}</Text>
            : <Text style={styles.rankNumber}>#{index + 1}</Text>
          }
        </View>

        {/* Avatar: real photo when the runner has one, color-letter otherwise */}
        {item.photoURL ? (
          <Image source={{ uri: item.photoURL }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: getUserColor(item.userId).hex }]}>
            <Text style={styles.avatarInitial}>
              {(item.displayName || item.userId).charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Info */}
        <View style={styles.infoBlock}>
          <Text style={[styles.userId, isTop3 && { color: meta.text }]}>{item.displayName || item.userId}</Text>
          <View style={styles.miniRow}>
            <Text style={styles.miniLabel}>{item.runCount} run{item.runCount !== 1 ? 's' : ''}</Text>
            <Text style={styles.miniDot}>·</Text>
            <Text style={styles.miniLabel}>{formatDistance(item.totalDistance)}</Text>
          </View>
        </View>

        {/* Area */}
        <View style={styles.areaBlock}>
          <Text style={styles.areaLabel}>AREA</Text>
          <Text style={[styles.areaValue, isTop3 && { color: meta.labelColor }]}>
            {formatArea(item.totalArea)}
          </Text>
        </View>
      </View>
    );
  };

  // Scoped tabs have two flavors of empty: "we don't know where you are yet"
  // (no run with a resolved location) and "your place has no runs yet".
  const renderEmpty = () => {
    if (scope !== 'global' && !(scope === 'city' ? myPlace?.city : myPlace?.country)) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>📍</Text>
          <Text style={styles.emptyText}>Where do you run?</Text>
          <Text style={styles.emptySubText}>
            Finish a run to unlock {scope === 'city' ? 'city' : 'country'} rankings.
          </Text>
        </View>
      );
    }
    if (scope !== 'global') {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🏴</Text>
          <Text style={styles.emptyText}>Be the first runner in {placeLabel}!</Text>
          <Text style={styles.emptySubText}>No territory captured here yet.</Text>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyEmoji}>🏆</Text>
        <Text style={styles.emptyText}>No runs yet!</Text>
        <Text style={styles.emptySubText}>Complete a run to appear here.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      {/* Scope selector */}
      <View style={styles.scopeRow}>
        <View style={styles.scopeControl} accessibilityRole="tablist">
          {SCOPES.map((option) => {
            const selected = scope === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.scopeOption, selected && styles.scopeOptionActive]}
                onPress={() => setScope(option.value)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityLabel={`${option.label} leaderboard`}
                accessibilityState={{ selected }}
              >
                <Text style={[styles.scopeText, selected && styles.scopeTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : players.length === 0 ? (
        renderEmpty()
      ) : (
        <FlatList
          data={players}
          keyExtractor={item => item.userId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (t) => StyleSheet.create({
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
  scopeRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  scopeControl: {
    flexDirection: 'row',
    backgroundColor: t.surfaceAlt,
    borderRadius: 12,
    padding: 3,
    gap: 2,
  },
  scopeOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  scopeOptionActive: {
    backgroundColor: t.surface,
    shadowColor: t.shadowSoft,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  scopeText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.textDim,
  },
  scopeTextActive: {
    color: t.primary,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 120,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 10,
    shadowColor: t.shadowSoft,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  rankWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rankEmoji: { fontSize: 18 },
  rankNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: t.textDim,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  avatarInitial: {
    fontSize: 14,
    fontWeight: '800',
    color: t.onPrimary,
  },
  infoBlock: { flex: 1 },
  userId: {
    fontSize: 14,
    fontWeight: '700',
    color: t.text,
    marginBottom: 3,
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniLabel: {
    fontSize: 11,
    color: t.textMuted,
    fontWeight: '400',
  },
  miniDot: {
    fontSize: 11,
    color: t.textFaint,
  },
  areaBlock: { alignItems: 'flex-end' },
  areaLabel: {
    fontSize: 8,
    color: t.textMuted,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  areaValue: {
    fontSize: 13,
    fontWeight: '700',
    color: t.primary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  loadingText: { color: t.textMuted, marginTop: 12, fontSize: 14 },
  emptyText: { color: t.text, fontSize: 18, fontWeight: '700' },
  emptySubText: { color: t.textMuted, fontSize: 14 },
});
