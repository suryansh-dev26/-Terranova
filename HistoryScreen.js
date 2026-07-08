import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  StatusBar, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from './firebase';
import { useTheme } from './theme/ThemeProvider';

export default function HistoryScreen({ navigation }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchRuns(); }, []);

  const fetchRuns = async () => {
    try {
      const q = query(collection(db, 'runs'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      setRuns(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.error('Error fetching runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown date';
    return timestamp.toDate().toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatDistance = (meters) => {
    if (!meters) return '—';
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const formatArea = (sqm) => {
    if (!sqm) return '—';
    if (sqm < 10000) return `${sqm.toLocaleString()} m²`;
    return `${(sqm / 10000).toFixed(2)} ha`;
  };

  const renderItem = ({ item, index }) => (
    <View style={[styles.card, index === 0 && styles.cardLatest]}>
      {index === 0 && (
        <View style={styles.latestBadge}>
          <Text style={styles.latestBadgeText}>Latest</Text>
        </View>
      )}
      <View style={styles.cardTop}>
        <View>
          <Text style={styles.runNumber}>Run #{runs.length - index}</Text>
          <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
        </View>
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>TIME</Text>
          <Text style={styles.timeValue}>{formatTime(item.time)}</Text>
        </View>
      </View>
      <View style={styles.cardDivider} />
      <View style={styles.cardStats}>
        <View style={styles.miniStat}>
          <Text style={styles.miniStatLabel}>DISTANCE</Text>
          <Text style={styles.miniStatValue}>{formatDistance(item.distance)}</Text>
        </View>
        <View style={styles.miniStat}>
          <Text style={styles.miniStatLabel}>AREA</Text>
          <Text style={styles.miniStatValue}>{formatArea(item.area)}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.bg} />

      <View style={styles.header}>
        <Text style={styles.title}>Run History</Text>
        <Text style={styles.headerSub}>{runs.length} {runs.length === 1 ? 'run' : 'runs'} logged</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={styles.loadingText}>Loading runs...</Text>
        </View>
      ) : runs.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🏃</Text>
          <Text style={styles.emptyText}>No runs yet!</Text>
          <Text style={styles.emptySubText}>Complete a run to see it here.</Text>
        </View>
      ) : (
        <FlatList
          data={runs}
          keyExtractor={item => item.id}
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
  headerSub: {
    fontSize: 13,
    color: t.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
  list: {
    padding: 16,
    paddingBottom: 120,
    gap: 10,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 10,
    shadowColor: t.shadowSoft,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardLatest: {
    borderColor: t.latestBorder,
    backgroundColor: t.latestBg,
  },
  latestBadge: {
    alignSelf: 'flex-start',
    backgroundColor: t.primarySoft,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 20,
    marginBottom: 10,
  },
  latestBadgeText: {
    fontSize: 10,
    color: t.primary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  runNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: t.text,
    marginBottom: 3,
  },
  date: {
    fontSize: 12,
    color: t.textMuted,
    fontWeight: '400',
  },
  timeBlock: { alignItems: 'flex-end' },
  timeLabel: {
    fontSize: 8,
    color: t.textMuted,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  timeValue: {
    fontSize: 22,
    fontWeight: '800',
    color: t.primary,
    letterSpacing: -0.5,
  },
  cardDivider: {
    height: 1,
    backgroundColor: t.border,
    marginVertical: 12,
  },
  cardStats: {
    flexDirection: 'row',
    gap: 24,
  },
  miniStat: {},
  miniStatLabel: {
    fontSize: 8,
    color: t.textMuted,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  miniStatValue: {
    fontSize: 13,
    fontWeight: '700',
    color: t.textStrong,
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
