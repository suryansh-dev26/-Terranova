import { Component, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as turf from '@turf/turf';
import { Map as MapGL, Camera, GeoJSONSource, Layer, Marker, UserLocation } from '@maplibre/maplibre-react-native';
import { getUserColor, toLngLat } from '../lib/geo';
import { useTheme } from '../theme/ThemeProvider';

// Basemap styles — all free & keyless (no signup, no billing, no card):
//   standard  → OpenFreeMap vector (OSM data), app-friendly CDN
//   satellite → ESRI World Imagery raster
//   terrain   → OpenTopoMap raster (contours + hillshade = "mountains")
// (We avoid OSM's raw raster servers, whose CDN resets bulk app tile traffic.)
const rasterStyle = (id, tiles, { maxzoom = 19, attribution = '' } = {}) => ({
  version: 8,
  sources: { [id]: { type: 'raster', tiles, tileSize: 256, maxzoom, attribution } },
  layers: [{ id, type: 'raster', source: id }],
});

const MAP_STYLES = {
  standard: 'https://tiles.openfreemap.org/styles/liberty',
  satellite: rasterStyle(
    'esri-satellite',
    ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    { maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  ),
  terrain: rasterStyle(
    'opentopo',
    [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    { maxzoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' },
  ),
};

// Catches JS render errors thrown inside the map subtree so the whole app
// doesn't hard-crash. Shows a plain placeholder in the map's place; the
// floating UI keeps working. NOTE: this only catches JavaScript exceptions,
// not true native crashes. Theme comes in as a prop (class components can't
// use the useTheme hook).
class MapErrorBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.warn('MapView render failed:', error && error.message, info && info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      const t = this.props.theme;
      return (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: t.placeholder, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <Text style={{ color: t.textDim, fontSize: 16 }}>Map unavailable</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// Build a GeoJSON FeatureCollection of territory polygons. Per-feature colors
// travel in `properties` and are read by the Layer paint via ['get', ...].
// Territory ink is intentionally NOT themed — user colors must look the same
// on every device regardless of theme.
function territoriesToFeatureCollection(territories, currentUserId) {
  const seen = new Set();
  const features = [];
  for (const territory of territories) {
    if (!territory.id || !territory.polygon || territory.polygon.length < 3 || seen.has(territory.id)) continue;
    seen.add(territory.id);
    const isOwner = territory.userId === currentUserId;
    const color = getUserColor(territory.userId);
    const fillColor = isOwner
      ? 'rgba(99,102,241,0.12)'
      : `rgba(${color.r},${color.g},${color.b},0.10)`;
    const strokeColor = isOwner ? '#6366f1' : color.hex;
    const ring = territory.polygon.map(toLngLat);
    // GeoJSON polygons must be closed (first point repeated at the end).
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    features.push({
      type: 'Feature',
      id: territory.id,
      properties: { fillColor, strokeColor },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}

// The full-bleed map: basemap, territory polygons, live route, start circle,
// and the "you are here" pin. Camera is owned by the parent via cameraRef so
// the run session can drive it.
export default function MapCanvas({
  mapType, territories, userId, routeCoords, location, isRunning,
  cameraRef, onRegionChange,
}) {
  const { theme } = useTheme();
  const mapRef = useRef(null);

  return (
    <MapErrorBoundary theme={theme}>
      <MapGL
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLES[mapType] || MAP_STYLES.standard}
        compass={false}
        logo={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        onRegionDidChange={onRegionChange}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [location?.longitude ?? 75.7873, location?.latitude ?? 26.9124],
            zoom: 15,
          }}
        />
        <UserLocation />

        {/* Territory polygons (one source, data-driven colors). */}
        <GeoJSONSource id="territories" data={territoriesToFeatureCollection(territories, userId)}>
          <Layer id="territories-fill" type="fill" paint={{ 'fill-color': ['get', 'fillColor'] }} />
          <Layer id="territories-line" type="line" paint={{ 'line-color': ['get', 'strokeColor'], 'line-width': 2 }} />
        </GeoJSONSource>

        {/* Start-point circle (30 m radius, built as a turf polygon). */}
        {isRunning && routeCoords.length > 0 && (
          <GeoJSONSource id="start-circle" data={turf.circle(toLngLat(routeCoords[0]), 0.03, { units: 'kilometers' })}>
            <Layer id="start-fill" type="fill" paint={{ 'fill-color': 'rgba(99,102,241,0.2)' }} />
            <Layer id="start-line" type="line" paint={{ 'line-color': '#6366f1', 'line-width': 2 }} />
          </GeoJSONSource>
        )}

        {/* Live route line. */}
        {routeCoords.length > 1 && (
          <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords.map(toLngLat) } }}>
            <Layer
              id="route-line"
              type="line"
              paint={{ 'line-color': '#6366f1', 'line-width': 4 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>
        )}

        {/* "You are here" pin. */}
        {location && (
          <Marker id="me" lngLat={[location.longitude, location.latitude]}>
            <View style={styles.mePin} />
          </Marker>
        )}
      </MapGL>
    </MapErrorBoundary>
  );
}

// Map ink (not theme chrome) — constant across light/dark.
const styles = StyleSheet.create({
  mePin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#6366f1',
    borderWidth: 2,
    borderColor: '#fff',
  },
});
