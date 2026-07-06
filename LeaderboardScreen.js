import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  StatusBar, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { useTheme } from './theme/ThemeProvider';

// Medal accents for the top 3 — deliberately NOT themed: gold/silver/bronze
// should look like gold/silver/bronze in both light and dark mode.
const RANK_META = [
  { emoji: '🥇', bg: '#fffbeb', border: '#fde68a', text: '#92400e', labelColor: '#d97706' },
  { emoji: '🥈', bg: '#f8fafc', border: '#e2e8f0', text: '#334155', labelColor: '#64748b' },
  { emoji: '🥉', bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', labelColor: '#ea580c' },
];

export default function LeaderboardScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAndGroupRuns(); }, []);

  const fetchAndGroupRuns = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'runs'));
      const runs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const grouped = {};
      runs.forEach(run => {
        const uid = run.userId || 'Unknown';
        if (!grouped[uid]) grouped[uid] = { userId: uid, displayName: null, totalArea: 0, totalDistance: 0, runCount: 0 };
        // Post-auth runs carry the friendly name; legacy runs' userId already
        // IS the friendly Runner-XXXX, so the render fallback covers them.
        if (run.displayName) grouped[uid].displayName = run.displayName;
        grouped[uid].totalArea += run.area || 0;
        grouped[uid].totalDistance += run.distance || 0;
        grouped[uid].runCount += 1;
      });
      setPlayers(Object.values(grouped).sort((a, b) => b.totalArea - a.totalArea));
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.subtitle}>Most territory captured 🏴</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : players.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🏆</Text>
          <Text style={styles.emptyText}>No runs yet!</Text>
          <Text style={styles.emptySubText}>Complete a run to appear here.</Text>
        </View>
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
