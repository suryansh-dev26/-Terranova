import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { toLngLat } from '../lib/geo';
import useRunSession, { LOOP_MIN_POINTS } from '../hooks/useRunSession';
import MapCanvas from '../components/MapCanvas';
import BottomSheet from '../components/BottomSheet';
import { useTheme } from '../theme/ThemeProvider';
import { useNotification } from '../NotificationContext';

const MAP_TYPE_CYCLE = ['standard', 'satellite', 'terrain'];
const mapTypeLabel = (t) =>
  t === 'standard' ? '🛣️' : t === 'satellite' ? '🛰️' : '⛰️';

export default function HomeScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [savedTerritories, setSavedTerritories] = useState([]);
  // Manual map-type control. An explicit mode keeps the user on a lightweight
  // 'standard' map and only loads satellite/terrain tiles on demand.
  const [mapType, setMapType] = useState('standard');

  const cameraRef = useRef(null);
  const lastRegionRef = useRef(null);

  const {
    isRunning, elapsedSeconds, routeCoords, totalDistance, location,
    distanceToStart, loopDetected, area, dominationMsg, saveStatus,
    userId, displayName, start, stop,
  } = useRunSession({ territories: savedTerritories, cameraRef, lastRegionRef });

  const { notify } = useNotification();

  // ── In-app "territory attacked" alert ──
  // Push notifications are off (Spark plan — no Cloud Functions). While the
  // app is open, this diff of the shared territory feed replaces them: if one
  // of MY territories disappears or shrinks, someone attacked it. Real push
  // can be re-enabled by upgrading to Blaze and restoring the
  // notifyTerritoryAttack Cloud Function (see git history for its code).
  const attackStateRef = useRef({ userId: null, suppress: false });
  attackStateRef.current = { userId, suppress: isRunning || saveStatus === 'Saving...' };
  const ownTerritoriesRef = useRef(null);
  const skipNextDiffRef = useRef(false);

  // Our own save rearranges our territories (delete + merged re-add); the
  // first snapshot after it completes reflects that, not an enemy attack.
  useEffect(() => {
    if (saveStatus && saveStatus !== 'Saving...') skipNextDiffRef.current = true;
  }, [saveStatus]);

  const detectTerritoryAttack = (territories) => {
    const { userId: uid, suppress } = attackStateRef.current;
    if (!uid) return;
    const mine = new Map(
      territories.filter(t => t.userId === uid).map(t => [t.id, t.area ?? 0]),
    );
    const previous = ownTerritoriesRef.current;
    ownTerritoriesRef.current = mine;
    if (!previous || suppress) return;
    if (skipNextDiffRef.current) { skipNextDiffRef.current = false; return; }
    for (const [id, prevArea] of previous) {
      if (!mine.has(id)) {
        notify.warning('⚔️ Your territory was captured! Run it back!');
        return;
      }
      if ((mine.get(id) ?? 0) < prevArea) {
        notify.warning('✂️ Someone cut into your territory!');
        return;
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Tracks the last applied data so the polling fallback below doesn't cause
    // needless re-renders when nothing changed.
    let lastSig = '';

    const applyDocs = (docs) => {
      const seen = new Set();
      const data = docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => {
          if (!t.id || !t.polygon || seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
      const sig = data
        .map(t => `${t.id}:${t.area ?? ''}:${t.polygon?.length ?? 0}`)
        .join('|');
      if (sig === lastSig) return; // no change → skip update
      lastSig = sig;
      setSavedTerritories(data);
      detectTerritoryAttack(data);
    };

    // Realtime listener — works on iOS. On Android the Firestore "Listen"
    // stream (Firebase JS SDK) often can't hold a connection, so we ALSO poll
    // with getDocs below (one-shot reads work reliably on React Native).
    const unsubscribe = onSnapshot(
      collection(db, 'territories'),
      (snapshot) => { if (!cancelled) applyDocs(snapshot.docs); },
      (error) =>
        console.warn('territories realtime listener failed; polling fallback active:', error?.message)
    );

    // getDocs fallback: fetch immediately, then refresh periodically. This is
    // what makes territories load/stay fresh on Android where onSnapshot fails.
    const fetchOnce = async () => {
      try {
        const snap = await getDocs(collection(db, 'territories'));
        if (!cancelled) applyDocs(snap.docs);
      } catch (e) {
        // transient/offline — next interval will retry
      }
    };
    fetchOnce();
    const pollId = setInterval(fetchOnce, 15000);

    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(pollId);
    };
  }, []);

  const handleRegionChange = (e) => {
    // MapLibre's onRegionDidChange gives { center: [lng, lat], zoom, ... }.
    // Store the center so the compass button can recenter when GPS is absent.
    const center = e?.nativeEvent?.center;
    if (center) lastRegionRef.current = { longitude: center[0], latitude: center[1] };
  };

  const cycleMapType = () => {
    setMapType((prev) => {
      const idx = MAP_TYPE_CYCLE.indexOf(prev);
      return MAP_TYPE_CYCLE[(idx + 1) % MAP_TYPE_CYCLE.length];
    });
  };

  // Compass button — recenter on the user (or last region) and reorient to north.
  const recenterNorth = () => {
    if (!cameraRef.current) return;
    const center = location
      ? toLngLat(location)
      : lastRegionRef.current
        ? toLngLat(lastRegionRef.current)
        : null;
    if (!center) return;
    cameraRef.current.easeTo({ center, bearing: 0, pitch: isRunning ? 45 : 0, duration: 500 });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={theme.statusBarStyle} translucent backgroundColor="transparent" />

      {/* ── Full-bleed map ── */}
      <MapCanvas
        mapType={mapType}
        territories={savedTerritories}
        userId={userId}
        routeCoords={routeCoords}
        location={location}
        isRunning={isRunning}
        cameraRef={cameraRef}
        onRegionChange={handleRegionChange}
      />

      {/* ── Floating top bar ── */}
      <SafeAreaView style={styles.topSafe} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <BlurView intensity={70} tint={theme.blurTint} style={styles.brandPill}>
            <Text style={styles.logo}>RunRealm</Text>
            <Text style={styles.userIdText}>{displayName ?? 'Loading…'}</Text>
          </BlurView>
          <View style={styles.navButtons}>
            <TouchableOpacity activeOpacity={0.7} onPress={recenterNorth} accessibilityRole="button" accessibilityLabel="Recenter map">
              <BlurView intensity={70} tint={theme.blurTint} style={styles.iconBtn}>
                <Text style={styles.iconGlyph}>🧭</Text>
              </BlurView>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7} onPress={cycleMapType} accessibilityRole="button" accessibilityLabel="Change map type">
              <BlurView intensity={70} tint={theme.blurTint} style={styles.iconBtn}>
                <Text style={styles.iconGlyph}>{mapTypeLabel(mapType)}</Text>
              </BlurView>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Live status chip ── */}
        <View style={styles.statusChipRow} pointerEvents="box-none">
          {isRunning ? (
            <BlurView intensity={75} tint={theme.blurTint} style={styles.statusChip}>
              <View style={styles.liveDot} />
              <Text style={styles.statusChipTextActive}>Recording run</Text>
            </BlurView>
          ) : (
            <BlurView intensity={75} tint={theme.blurTint} style={styles.statusChip}>
              <Text style={styles.statusChipText}>{savedTerritories.length} territories nearby</Text>
            </BlurView>
          )}
        </View>

        {/* ── Loop distance pill ── */}
        {isRunning && routeCoords.length > LOOP_MIN_POINTS && distanceToStart !== null && (
          <View style={styles.loopPillRow} pointerEvents="box-none">
            <BlurView intensity={75} tint={theme.blurTint} style={styles.statusChip}>
              <Text style={[styles.loopPillText, distanceToStart < 50 && styles.loopPillTextClose]}>
                🎯 {Math.round(distanceToStart)} m to close loop
              </Text>
            </BlurView>
          </View>
        )}
      </SafeAreaView>

      {/* ── Floating bottom sheet ── */}
      <BottomSheet
        isRunning={isRunning}
        elapsedSeconds={elapsedSeconds}
        totalDistance={totalDistance}
        location={location}
        loopDetected={loopDetected}
        dominationMsg={dominationMsg}
        area={area}
        saveStatus={saveStatus}
        onStart={start}
        onStop={stop}
      />
    </View>
  );
}

const createStyles = (t) => {
  const SHADOW = Platform.select({
    ios: {
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
    },
    android: { elevation: 6 },
  });

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.mapBg,
    },

    // ── Top floating bar ──
    topSafe: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    brandPill: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 22,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.mapOverlay,
      ...SHADOW,
    },
    logo: {
      fontSize: 18,
      fontWeight: '800',
      color: t.text,
      letterSpacing: -0.4,
    },
    userIdText: {
      fontSize: 10,
      color: t.textDim,
      fontWeight: '600',
      marginTop: 1,
      letterSpacing: 0.2,
    },
    navButtons: {
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
    },
    iconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.mapOverlay,
      ...SHADOW,
    },
    iconGlyph: { fontSize: 18 },

    // ── Status chip ──
    statusChipRow: {
      alignItems: 'center',
      marginTop: 12,
    },
    statusChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: 18,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.mapOverlay,
      ...SHADOW,
    },
    liveDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: t.danger,
    },
    statusChipText: {
      fontSize: 12,
      color: t.textStrong,
      fontWeight: '600',
    },
    statusChipTextActive: {
      fontSize: 12,
      color: t.dangerStrong,
      fontWeight: '700',
    },
    loopPillRow: {
      alignItems: 'center',
      marginTop: 8,
    },
    loopPillText: {
      fontSize: 12,
      color: t.textStrong,
      fontWeight: '700',
    },
    loopPillTextClose: {
      color: t.success,
    },
  });
};
