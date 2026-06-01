import * as turf from '@turf/turf';
import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  SafeAreaView, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, Polygon } from 'react-native-maps';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, getDocs,
  deleteDoc, doc, updateDoc, serverTimestamp, onSnapshot,
} from 'firebase/firestore';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HistoryScreen from './HistoryScreen';
import LeaderboardScreen from './LeaderboardScreen';

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
const db = getFirestore(app);
const Stack = createNativeStackNavigator();

// ─── Helper Functions ─────────────────────────────────────────────────────────

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (val) => (val * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function calculateArea(coords) {
  if (coords.length < 3) return 0;
  const toRad = (val) => (val * Math.PI) / 180;
  const R = 6371000;
  const origin = coords[0];
  const points = coords.map(c => ({
    x: R * toRad(c.longitude - origin.longitude) * Math.cos(toRad(origin.latitude)),
    y: R * toRad(c.latitude - origin.latitude),
  }));
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
}

function formatArea(sqMeters) {
  if (sqMeters < 10000) return `${Math.round(sqMeters)} m²`;
  return `${(sqMeters / 10000).toFixed(2)} ha`;
}

function generateUserId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'Runner-';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function isPointInPolygon(point, polygon) {
  const { latitude: px, longitude: py } = point;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].latitude;
    const yi = polygon[i].longitude;
    const xj = polygon[j].latitude;
    const yj = polygon[j].longitude;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getPolygonCenter(polygon) {
  const lat = polygon.reduce((sum, p) => sum + p.latitude, 0) / polygon.length;
  const lng = polygon.reduce((sum, p) => sum + p.longitude, 0) / polygon.length;
  return { latitude: lat, longitude: lng };
}

function isValidGPSPoint(newCoord, lastCoord, accuracy) {
  if (accuracy && accuracy > 25) return false;
  if (!lastCoord) return true;
  const dist = getDistanceMeters(
    lastCoord.latitude, lastCoord.longitude,
    newCoord.latitude, newCoord.longitude
  );
  if (dist > 50) return false;
  if (dist < 5) return false;
  return true;
}

function smoothPoint(last, current) {
  if (!last) return current;
  return {
    latitude: (last.latitude + current.latitude) / 2,
    longitude: (last.longitude + current.longitude) / 2,
  };
}

const COLOR_PALETTE = [
  { hex: '#ef4444', r: 239, g: 68,  b: 68  },
  { hex: '#f97316', r: 249, g: 115, b: 22  },
  { hex: '#eab308', r: 234, g: 179, b: 8   },
  { hex: '#22c55e', r: 34,  g: 197, b: 94  },
  { hex: '#14b8a6', r: 20,  g: 184, b: 166 },
  { hex: '#3b82f6', r: 59,  g: 130, b: 246 },
  { hex: '#8b5cf6', r: 139, g: 92,  b: 246 },
  { hex: '#ec4899', r: 236, g: 72,  b: 153 },
  { hex: '#06b6d4', r: 6,   g: 182, b: 212 },
  { hex: '#f43f5e', r: 244, g: 63,  b: 94  },
];

function getUserColor(userId) {
  if (!userId) return COLOR_PALETTE[6];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

// ─── Turf Helpers ──────────────────────────────────────────────────────────────

function toTurfPolygon(coords) {
  const ring = coords.map(c => [c.longitude, c.latitude]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return turf.polygon([ring]);
}

function fromTurfCoords(turfCoords) {
  return turfCoords.map(c => ({ latitude: c[1], longitude: c[0] }));
}

function getTurfConflict(newCoords, enemyTerritory) {
  try {
    const newPoly = toTurfPolygon(newCoords);
    const oldPoly = toTurfPolygon(enemyTerritory.polygon);
    const intersection = turf.intersect(turf.featureCollection([newPoly, oldPoly]));
    if (!intersection) return null;
    const remaining = turf.difference(turf.featureCollection([oldPoly, newPoly]));
    if (!remaining) {
      const oldArea = turf.area(oldPoly);
      const newArea = turf.area(newPoly);
      if (newArea >= oldArea * 0.9) return { action: 'delete', id: enemyTerritory.id };
      return null;
    }
    const geom = remaining.geometry;
    if (!geom) return null;
    let remainingCoords;
    if (geom.type === 'Polygon') {
      remainingCoords = fromTurfCoords(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      let largest = geom.coordinates[0];
      for (const part of geom.coordinates) {
        if (part[0].length > largest[0].length) largest = part;
      }
      remainingCoords = fromTurfCoords(largest[0]);
    } else {
      return null;
    }
    return { action: 'cut', id: enemyTerritory.id, newPolygon: remainingCoords };
  } catch (e) {
    console.error('Turf conflict error:', e);
    return null;
  }
}

// ─── Render Territories ───────────────────────────────────────────────────────

function renderTerritories(territories, currentUserId, version) {
  const seen = new Set();
  return territories
    .filter(t => {
      if (!t.id || !t.polygon || t.polygon.length < 3 || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    })
    .map((territory) => {
      const isOwner = territory.userId === currentUserId;
      const color = getUserColor(territory.userId);
      const fillColor = isOwner
        ? 'rgba(99,102,241,0.12)'
        : `rgba(${color.r},${color.g},${color.b},0.10)`;
      const strokeColor = isOwner ? '#6366f1' : color.hex;
      return (
        <Polygon
          key={`${territory.id}-${version}`}
          coordinates={territory.polygon}
          fillColor={fillColor}
          strokeColor={strokeColor}
          strokeWidth={2}
        />
      );
    });
}

const ROUTE_MIN_DISTANCE = 5;
const DISTANCE_MIN_DISTANCE = 10;

// ─── Home Screen ──────────────────────────────────────────────────────────────

function HomeScreen({ navigation }) {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [saveStatus, setSaveStatus] = useState('');
  const [totalDistance, setTotalDistance] = useState(0);
  const [area, setArea] = useState(null);
  const [savedTerritories, setSavedTerritories] = useState([]);
  const [territoryVersion, setTerritoryVersion] = useState(0);
  const [userId, setUserId] = useState(null);
  const [dominationMsg, setDominationMsg] = useState('');
  const [isZoomedOut, setIsZoomedOut] = useState(false);

  const timerRef = useRef(null);
  const locationRef = useRef(null);
  const mapRef = useRef(null);
  const lastRoutePointRef = useRef(null);
  const lastDistancePointRef = useRef(null);
  const routeCoordsRef = useRef([]);

  useEffect(() => { loadUserId(); }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'territories'),
      (snapshot) => {
        const seen = new Set();
        const data = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => {
            if (!t.id || !t.polygon || seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          });
        setSavedTerritories([...data]);
        setTerritoryVersion(v => v + 1);
      },
      (error) => console.error('onSnapshot error:', error)
    );
    return () => unsubscribe();
  }, []);

  const loadUserId = async () => {
    try {
      let id = await AsyncStorage.getItem('userId');
      if (!id) {
        id = generateUserId();
        await AsyncStorage.setItem('userId', id);
      }
      setUserId(id);
    } catch {
      setUserId(generateUserId());
    }
  };

  const clearTerritories = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'territories'));
      await Promise.all(snapshot.docs.map(d => deleteDoc(doc(db, 'territories', d.id))));
    } catch (error) {
      console.error('Clear failed:', error);
    }
  };

  const handleRegionChange = (region) => {
    const zoomedOut = region.latitudeDelta > 50;
    setIsZoomedOut(zoomedOut);
  };

  const requestPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Location permission denied.');
      return false;
    }
    return true;
  };

  const startRun = async () => {
    const granted = await requestPermission();
    if (!granted) return;
    setElapsedSeconds(0);
    setLocation(null);
    setErrorMsg(null);
    setIsRunning(true);
    setRouteCoords([]);
    setSaveStatus('');
    setTotalDistance(0);
    setArea(null);
    setDominationMsg('');
    lastRoutePointRef.current = null;
    lastDistancePointRef.current = null;
    routeCoordsRef.current = [];

    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    locationRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 },
      (loc) => {
        const coords = loc.coords;
        const rawPoint = { latitude: coords.latitude, longitude: coords.longitude };
        if (!isValidGPSPoint(rawPoint, lastRoutePointRef.current, coords.accuracy)) return;
        const newPoint = smoothPoint(lastRoutePointRef.current, rawPoint);
        setLocation(coords);
        const distFromLastRoute = lastRoutePointRef.current
          ? getDistanceMeters(lastRoutePointRef.current.latitude, lastRoutePointRef.current.longitude, newPoint.latitude, newPoint.longitude)
          : Infinity;
        if (distFromLastRoute >= ROUTE_MIN_DISTANCE) {
          lastRoutePointRef.current = newPoint;
          setRouteCoords(prev => {
            const updated = [...prev, newPoint];
            routeCoordsRef.current = updated;
            return updated;
          });
        }
        if (lastDistancePointRef.current) {
          const d = getDistanceMeters(lastDistancePointRef.current.latitude, lastDistancePointRef.current.longitude, newPoint.latitude, newPoint.longitude);
          if (d >= DISTANCE_MIN_DISTANCE) {
            setTotalDistance(prev => prev + d);
            lastDistancePointRef.current = newPoint;
          }
        } else {
          lastDistancePointRef.current = newPoint;
        }
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: newPoint.latitude, longitude: newPoint.longitude,
            latitudeDelta: 0.005, longitudeDelta: 0.005,
          }, 500);
        }
      }
    );
  };

  const saveRunToFirestore = async (seconds, coords, distanceMeters, areaSqMeters) => {
    try {
      setSaveStatus('Saving...');
      await addDoc(collection(db, 'runs'), {
        userId, time: seconds, route: coords,
        distance: Math.round(distanceMeters),
        area: Math.round(areaSqMeters),
        createdAt: serverTimestamp(),
      });

      if (coords.length >= 3) {
        const closedPolygon = [...coords, coords[0]];
        let mergedPolygon = toTurfPolygon(closedPolygon);
        const myTerritories = savedTerritories.filter(t => t.userId === userId && t.polygon?.length >= 3);
        const myTerritoryIdsToDelete = [];

        for (const territory of myTerritories) {
          try {
            const oldPoly = toTurfPolygon(territory.polygon);
            const merged = turf.union(turf.featureCollection([mergedPolygon, oldPoly]));
            if (merged) { mergedPolygon = merged; myTerritoryIdsToDelete.push(territory.id); }
          } catch (e) {}
        }

        for (const id of myTerritoryIdsToDelete) {
          await deleteDoc(doc(db, 'territories', id));
        }

        const enemyTerritories = savedTerritories.filter(t => t.userId !== userId && t.polygon?.length >= 3);
        for (const territory of enemyTerritories) {
          try {
            const conflict = getTurfConflict(
              fromTurfCoords(mergedPolygon.geometry.type === 'Polygon'
                ? mergedPolygon.geometry.coordinates[0]
                : mergedPolygon.geometry.coordinates[0][0]),
              territory
            );
            if (!conflict) continue;
            if (conflict.action === 'delete') {
              await deleteDoc(doc(db, 'territories', conflict.id));
              setDominationMsg(`🏆 Fully captured ${territory.userId}'s territory!`);
            } else if (conflict.action === 'cut') {
              await updateDoc(doc(db, 'territories', conflict.id), {
                polygon: conflict.newPolygon,
                area: Math.round(calculateArea(conflict.newPolygon)),
              });
              setDominationMsg(`✂️ You cut into ${territory.userId}'s territory!`);
            }
          } catch (e) {}
        }

        let finalCoords;
        const geom = mergedPolygon.geometry;
        if (geom.type === 'Polygon') {
          finalCoords = fromTurfCoords(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
          let largest = geom.coordinates[0];
          for (const part of geom.coordinates) {
            if (part[0].length > largest[0].length) largest = part;
          }
          finalCoords = fromTurfCoords(largest[0]);
        } else {
          finalCoords = closedPolygon;
        }

        await addDoc(collection(db, 'territories'), {
          userId, polygon: finalCoords,
          area: Math.round(calculateArea(finalCoords)),
          createdAt: serverTimestamp(),
        });
      }
      setSaveStatus('Territory saved! ✓');
    } catch (error) {
      console.error('Error saving run:', error);
      setSaveStatus('Save failed. Check Firebase config.');
    }
  };

  const stopRun = () => {
    setIsRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (locationRef.current) { locationRef.current.remove(); locationRef.current = null; }
    Location.stopLocationUpdatesAsync().catch(() => {});
    const finalCoords = routeCoordsRef.current;
    if (finalCoords.length < 5) { setSaveStatus('Run too short to save!'); return; }
    const calculatedArea = calculateArea(finalCoords);
    setArea(calculatedArea);
    saveRunToFirestore(elapsedSeconds, finalCoords, totalDistance, calculatedArea);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationRef.current) locationRef.current.remove();
    };
  }, []);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>RunRealm</Text>
          <Text style={styles.userIdText}>{userId ?? 'Loading...'}</Text>
        </View>
        <View style={styles.navButtons}>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigation.navigate('History')}>
            <Text style={styles.navBtnText}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navBtn, styles.navBtnOutline]} onPress={clearTerritories}>
            <Text style={styles.navBtnIcon}>🗑</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navBtn, styles.navBtnOutline]} onPress={() => navigation.navigate('Leaderboard')}>
            <Text style={styles.navBtnIcon}>🏆</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Status pill ── */}
      <View style={styles.statusPillRow}>
        {isRunning
          ? <View style={styles.statusPillActive}><View style={styles.liveDot} /><Text style={styles.statusPillTextActive}>Run in progress</Text></View>
          : <View style={styles.statusPill}><Text style={styles.statusPillText}>{savedTerritories.length} territories on map</Text></View>
        }
      </View>

      {/* ── Map ── */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          mapType={isZoomedOut ? 'satellite' : 'standard'}
          onRegionChangeComplete={handleRegionChange}
          initialCamera={{
            center: { latitude: location?.latitude ?? 26.9124, longitude: location?.longitude ?? 75.7873 },
            pitch: 0, heading: 0, altitude: 10000000, zoom: 15,
          }}
          showsUserLocation={true}
        >
          {renderTerritories(savedTerritories, userId, territoryVersion)}
          {routeCoords.length > 1 && (
            <Polyline coordinates={routeCoords} strokeColor="#6366f1" strokeWidth={3} />
          )}
          {location && (
            <Marker
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              title="You are here"
              pinColor="#6366f1"
            />
          )}
        </MapView>
      </View>

      {/* ── Stats ── */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>TIME</Text>
          <Text style={styles.statValue}>{formatTime(elapsedSeconds)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>DISTANCE</Text>
          <Text style={styles.statValue}>{formatDistance(totalDistance)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>LAT</Text>
          <Text style={styles.statValue}>{location ? location.latitude.toFixed(3) : '—'}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>LNG</Text>
          <Text style={styles.statValue}>{location ? location.longitude.toFixed(3) : '—'}</Text>
        </View>
      </View>

      {/* ── Domination banner ── */}
      {dominationMsg !== '' && (
        <View style={styles.dominationBox}>
          <Text style={styles.dominationText}>{dominationMsg}</Text>
        </View>
      )}

      {/* ── Territory captured ── */}
      {area !== null && (
        <View style={styles.areaCard}>
          <View>
            <Text style={styles.areaLabel}>TERRITORY CAPTURED</Text>
            <Text style={styles.areaValue}>{formatArea(area)}</Text>
          </View>
          <Text style={styles.areaEmoji}>🏴</Text>
        </View>
      )}

      {/* ── Save status ── */}
      {saveStatus !== '' && (
        <View style={[styles.statusBox, saveStatus.includes('failed') ? styles.statusError : styles.statusSuccess]}>
          <Text style={[styles.statusText, saveStatus.includes('failed') ? styles.statusTextError : styles.statusTextSuccess]}>
            {saveStatus}
          </Text>
        </View>
      )}

      {/* ── Error ── */}
      {errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {/* ── Action button ── */}
      <View style={styles.buttonWrapper}>
        {!isRunning ? (
          <TouchableOpacity style={styles.startButton} onPress={startRun} activeOpacity={0.85}>
            <Text style={styles.startButtonText}>Start Run</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopRun} activeOpacity={0.85}>
            <Text style={styles.stopButtonText}>Stop Run</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── App Entry ────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="History" children={(props) => <HistoryScreen {...props} db={db} />} />
        <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 4,
  },
  logo: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  userIdText: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '500',
    marginTop: 1,
    letterSpacing: 0.2,
  },
  navButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  navBtnOutline: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
  },
  navBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  navBtnIcon: {
    fontSize: 14,
  },

  // Status pill
  statusPillRow: {
    marginBottom: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#f3f4f6',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  statusPillText: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  statusPillActive: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef2f2',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  statusPillTextActive: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '600',
  },

  // Map
  mapContainer: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  map: { width: '100%', height: '100%' },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  statLabel: {
    fontSize: 8,
    color: '#9ca3af',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },

  // Domination
  dominationBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 11,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#fde68a',
    flexDirection: 'row',
    alignItems: 'center',
  },
  dominationText: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: '600',
  },

  // Area card
  areaCard: {
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e0e7ff',
  },
  areaLabel: {
    fontSize: 9,
    color: '#6366f1',
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  areaValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#4338ca',
  },
  areaEmoji: {
    fontSize: 28,
  },

  // Status messages
  statusBox: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  statusError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  statusText: {
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  statusTextSuccess: { color: '#166534' },
  statusTextError: { color: '#991b1b' },

  // Error
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: '#991b1b', fontSize: 13, textAlign: 'center' },

  // Buttons
  buttonWrapper: {
    marginTop: 'auto',
    paddingBottom: 8,
  },
  startButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  stopButton: {
    backgroundColor: '#ffffff',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ef4444',
  },
  stopButtonText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});