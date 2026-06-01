import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, SafeAreaView, StatusBar, ActivityIndicator,
} from 'react-native';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBmt-7ejRkjjlNNWvGILlHhouvLwhgN8C4",
  authDomain: "runrealm3-63bc3.firebaseapp.com",
  projectId: "runrealm3-63bc3",
  storageBucket: "runrealm3-63bc3.firebasestorage.app",
  messagingSenderId: "358048866655",
  appId: "1:358048866655:web:2152bd778ffc0a71afd6ea",
  measurementId: "G-4F56HGM34Q"
};

const firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const RANK_META = [
  { emoji: '🥇', bg: '#fffbeb', border: '#fde68a', text: '#92400e', labelColor: '#d97706' },
  { emoji: '🥈', bg: '#f8fafc', border: '#e2e8f0', text: '#334155', labelColor: '#64748b' },
  { emoji: '🥉', bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', labelColor: '#ea580c' },
];

export default function LeaderboardScreen({ navigation }) {
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
        if (!grouped[uid]) grouped[uid] = { userId: uid, totalArea: 0, totalDistance: 0, runCount: 0 };
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
          <Text style={[styles.userId, isTop3 && { color: meta.text }]}>{item.userId}</Text>
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
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Leaderboard</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Subtitle */}
      <Text style={styles.subtitle}>Most territory captured 🏴</Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#6366f1" size="large" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  backBtn: { width: 60 },
  backText: {
    color: '#6366f1',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
    paddingVertical: 10,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  rankWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rankEmoji: { fontSize: 18 },
  rankNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  infoBlock: { flex: 1 },
  userId: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 3,
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '400',
  },
  miniDot: {
    fontSize: 11,
    color: '#d1d5db',
  },
  areaBlock: { alignItems: 'flex-end' },
  areaLabel: {
    fontSize: 8,
    color: '#9ca3af',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  areaValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6366f1',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  loadingText: { color: '#9ca3af', marginTop: 12, fontSize: 14 },
  emptyText: { color: '#111827', fontSize: 18, fontWeight: '700' },
  emptySubText: { color: '#9ca3af', fontSize: 14 },
});