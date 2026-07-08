// The map uses MapLibre (@maplibre/maplibre-react-native) to render OpenStreetMap
// tiles directly — no Google Maps, no API key, no billing account. The MapLibre
// Expo config plugin wires up the native SDK during prebuild.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    '@maplibre/maplibre-react-native',
  ],
});
