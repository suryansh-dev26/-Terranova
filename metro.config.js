const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The `functions/` directory holds Firebase Cloud Functions, which are
// server-only (Node.js) code. Its dependencies (firebase-functions) require
// Node built-ins like `async_hooks` that don't exist in React Native, so we
// keep Metro from crawling/bundling that directory into the app.
const functionsDir = path.resolve(__dirname, 'functions').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [new RegExp(`^${functionsDir}[/\\\\].*`)];

module.exports = config;
