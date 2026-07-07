import { useEffect, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import * as Location from 'expo-location';
import {
  collection, addDoc, deleteDoc, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import { useNotification } from '../NotificationContext';
import {
  getDistanceMeters,
  calculateArea,
  isValidGPSPoint,
  smoothPoint,
  toTurfPolygon,
  fromTurfCoords,
  getTurfConflict,
  toLngLat,
} from '../lib/geo';

const ROUTE_MIN_DISTANCE = 5;
const DISTANCE_MIN_DISTANCE = 10;

// Auto loop detection: the run auto-stops and captures territory once the
// route has enough points, enough distance, and comes back near its start.
export const LOOP_MIN_POINTS = 20;
export const LOOP_MIN_DISTANCE = 300;
export const LOOP_CLOSE_RADIUS = 30;

// Everything about an active run: GPS watcher, timer, loop detection, and the
// save → merge-own → cut/capture-enemy → persist flow. UI-free by design.
//
// `territories` is the live territory list (owned by the screen's Firestore
// subscription); `cameraRef` / `lastRegionRef` let the session drive the map
// camera during a run and recenter on stop.
export default function useRunSession({ territories, cameraRef, lastRegionRef }) {
  const { notify } = useNotification();
  // Identity comes from the AuthProvider (the AuthGate guarantees a signed-in
  // user — guest or real — before any screen using this hook renders).
  const { user, profile } = useAuth();
  const userId = user?.uid ?? null;
  const displayName = profile?.displayName ?? null;
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [location, setLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [saveStatus, setSaveStatus] = useState('');
  const [totalDistance, setTotalDistance] = useState(0);
  const [area, setArea] = useState(null);
  const [dominationMsg, setDominationMsg] = useState('');
  const [loopDetected, setLoopDetected] = useState(false);
  const [distanceToStart, setDistanceToStart] = useState(null);

  const timerRef = useRef(null);
  const locationRef = useRef(null);
  const lastRoutePointRef = useRef(null);
  const lastDistancePointRef = useRef(null);
  const routeCoordsRef = useRef([]);
  const totalDistanceRef = useRef(0);
  const stopRunRef = useRef(null);
  const loopHandledRef = useRef(false);
  // Latest territories snapshot so the save/merge flow never reads a stale
  // closure (the GPS watcher and auto-loop stop outlive many renders).
  const territoriesRef = useRef(territories);
  territoriesRef.current = territories;
  // Same staleness guard for identity: the save flow runs from long-lived
  // callbacks, so it reads the ref, not the render-time values.
  const identityRef = useRef({ uid: userId, name: displayName });
  identityRef.current = { uid: userId, name: displayName };

  const requestPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      notify.error('Location permission denied — enable it in Settings to track runs.');
      return false;
    }
    return true;
  };

  const startRun = async () => {
    const granted = await requestPermission();
    if (!granted) return;
    setElapsedSeconds(0);
    setLocation(null);
    setIsRunning(true);
    setRouteCoords([]);
    setSaveStatus('');
    setTotalDistance(0);
    setArea(null);
    setDominationMsg('');
    setLoopDetected(false);
    setDistanceToStart(null);
    lastRoutePointRef.current = null;
    lastDistancePointRef.current = null;
    routeCoordsRef.current = [];
    totalDistanceRef.current = 0;
    loopHandledRef.current = false;

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
            totalDistanceRef.current += d;
            setTotalDistance(prev => prev + d);
            lastDistancePointRef.current = newPoint;
          }
        } else {
          lastDistancePointRef.current = newPoint;
        }

        // ── Auto loop detection ──
        const points = routeCoordsRef.current;
        if (points.length > 0) {
          const start = points[0];
          const distToStart = getDistanceMeters(start.latitude, start.longitude, newPoint.latitude, newPoint.longitude);
          setDistanceToStart(distToStart);

          const loopComplete =
            points.length > LOOP_MIN_POINTS &&
            totalDistanceRef.current > LOOP_MIN_DISTANCE &&
            distToStart < LOOP_CLOSE_RADIUS;

          if (loopComplete && !loopHandledRef.current) {
            loopHandledRef.current = true;
            setLoopDetected(true);
            // Reuse the existing stop / save / capture flow — no duplication.
            if (stopRunRef.current) stopRunRef.current();
            return;
          }
        }

        if (cameraRef?.current) {
          cameraRef.current.easeTo({
            center: toLngLat(newPoint),
            pitch: 45, bearing: 0, zoom: 18, duration: 500,
          });
        }
      }
    );
  };

  const saveRunToFirestore = async (seconds, coords, distanceMeters, areaSqMeters) => {
    try {
      setSaveStatus('Saving...');
      const { uid, name } = identityRef.current;
      if (!uid) throw new Error('Not signed in');
      await addDoc(collection(db, 'runs'), {
        userId: uid, displayName: name, time: seconds, route: coords,
        distance: Math.round(distanceMeters),
        area: Math.round(areaSqMeters),
        createdAt: serverTimestamp(),
      });

      if (coords.length >= 3) {
        const savedTerritories = territoriesRef.current ?? [];
        const closedPolygon = [...coords, coords[0]];
        let mergedPolygon = toTurfPolygon(closedPolygon);
        const myTerritories = savedTerritories.filter(t => t.userId === uid && t.polygon?.length >= 3);
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

        const enemyTerritories = savedTerritories.filter(t => t.userId !== uid && t.polygon?.length >= 3);
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
              setDominationMsg(`🏆 Fully captured ${territory.displayName || territory.userId}'s territory!`);
            } else if (conflict.action === 'cut') {
              await updateDoc(doc(db, 'territories', conflict.id), {
                polygon: conflict.newPolygon,
                area: Math.round(calculateArea(conflict.newPolygon)),
              });
              setDominationMsg(`✂️ You cut into ${territory.displayName || territory.userId}'s territory!`);
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
          userId: uid, displayName: name, polygon: finalCoords,
          area: Math.round(calculateArea(finalCoords)),
          createdAt: serverTimestamp(),
        });
      }
      setSaveStatus('Territory saved! ✓');
      notify.success('Territory saved!');
    } catch (error) {
      setSaveStatus('Save failed. Check Firebase config.');
      notify.error(`Couldn't save run: ${error?.message ?? 'check Firebase config.'}`);
    }
  };

  const stopRun = () => {
    setIsRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (locationRef.current) { locationRef.current.remove(); locationRef.current = null; }
    Location.stopLocationUpdatesAsync().catch(() => {});
    const recenter = location
      ? toLngLat(location)
      : lastRegionRef?.current
        ? toLngLat(lastRegionRef.current)
        : null;
    if (cameraRef?.current && recenter) {
      cameraRef.current.easeTo({ center: recenter, pitch: 0, zoom: 15, duration: 600 });
    }
    const finalCoords = routeCoordsRef.current;
    if (finalCoords.length < 5) { setSaveStatus('Run too short to save!'); return; }
    const calculatedArea = calculateArea(finalCoords);
    setArea(calculatedArea);
    saveRunToFirestore(elapsedSeconds, finalCoords, totalDistance, calculatedArea);
  };
  // Always point at the latest stopRun so the GPS watcher's auto-loop trigger
  // runs with current state instead of a stale closure.
  stopRunRef.current = stopRun;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationRef.current) locationRef.current.remove();
    };
  }, []);

  return {
    isRunning,
    elapsedSeconds,
    routeCoords,
    totalDistance,
    location,
    distanceToStart,
    loopDetected,
    area,
    dominationMsg,
    saveStatus,
    userId,
    displayName,
    start: startRun,
    stop: stopRun,
  };
}
