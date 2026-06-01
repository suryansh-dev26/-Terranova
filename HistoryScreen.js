import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, SafeAreaView, StatusBar, ActivityIndicator,
} from 'react-native';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';

export default function HistoryScreen({ navigation, db }) {
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
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Run History</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#6366f1" size="large" />
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
  list: {
    padding: 16,
    gap: 10,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardLatest: {
    borderColor: '#e0e7ff',
    backgroundColor: '#fafbff',
  },
  latestBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#eef2ff',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 20,
    marginBottom: 10,
  },
  latestBadgeText: {
    fontSize: 10,
    color: '#6366f1',
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
    color: '#111827',
    marginBottom: 3,
  },
  date: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '400',
  },
  timeBlock: { alignItems: 'flex-end' },
  timeLabel: {
    fontSize: 8,
    color: '#9ca3af',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  timeValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#6366f1',
    letterSpacing: -0.5,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginVertical: 12,
  },
  cardStats: {
    flexDirection: 'row',
    gap: 24,
  },
  miniStat: {},
  miniStatLabel: {
    fontSize: 8,
    color: '#9ca3af',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  miniStatValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
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