// Theme tokens for RunRealm3. Plain data with no React Native imports so it
// can be unit-tested under `node --test` (see tokens.test.js).
//
// Light values reproduce the pre-theme hardcoded palette EXACTLY — light mode
// must stay pixel-identical. Dark values follow the spec: #0b0f1a bg,
// #111827 surface, #e5e7eb text, #6366f1 primary.
//
// Core tokens: bg, surface, text, textDim, primary, danger, mapOverlay.
// The supporting tokens exist because the original palette used four distinct
// grays, two overlay-border opacities, and pastel toast tints that can't be
// collapsed into seven values without visibly changing light mode.

const light = {
  mode: 'light',

  // ── Core ──
  bg: '#ffffff',
  surface: '#ffffff',
  text: '#111827',
  textDim: '#6b7280',
  primary: '#6366f1',
  danger: '#ef4444',
  mapOverlay: 'rgba(255,255,255,0.5)',        // floating map-chrome border

  // ── Text shades ──
  textStrong: '#374151',
  textMuted: '#9ca3af',
  textFaint: '#d1d5db',
  onPrimary: '#ffffff',                        // text on primary/danger buttons

  // ── Accents ──
  primaryStrong: '#4338ca',
  primarySoft: '#eef2ff',
  primaryFaint: 'rgba(99,102,241,0.15)',
  dangerStrong: '#dc2626',
  dangerText: '#991b1b',
  success: '#16a34a',
  successText: '#166534',

  // ── Surfaces / lines ──
  surfaceAlt: '#f3f4f6',
  border: '#f3f4f6',
  hairline: '#eef0f3',
  divider: 'rgba(17,24,39,0.12)',
  placeholder: '#e5e7eb',                      // map-unavailable fallback
  latestBg: '#fafbff',                         // "Latest" run card highlight
  latestBorder: '#e0e7ff',

  // ── Map chrome ──
  mapBg: '#e8eaf0',
  mapOverlayStrong: 'rgba(255,255,255,0.6)',
  blurTint: 'light',
  statusBarStyle: 'dark-content',

  // ── Shadows ──
  shadow: '#0f172a',
  shadowSoft: '#000000',

  // ── Toast tints ──
  toastGold: 'rgba(254,243,199,0.55)',
  toastIndigo: 'rgba(224,231,255,0.55)',
  toastSuccess: 'rgba(220,252,231,0.55)',
  toastError: 'rgba(254,226,226,0.55)',
};

const dark = {
  mode: 'dark',

  // ── Core (per spec) ──
  bg: '#0b0f1a',
  surface: '#111827',
  text: '#e5e7eb',
  textDim: '#9ca3af',
  primary: '#6366f1',
  danger: '#ef4444',
  mapOverlay: 'rgba(255,255,255,0.12)',

  // ── Text shades ──
  textStrong: '#d1d5db',
  textMuted: '#6b7280',
  textFaint: '#4b5563',
  onPrimary: '#ffffff',

  // ── Accents ──
  primaryStrong: '#a5b4fc',
  primarySoft: 'rgba(99,102,241,0.18)',
  primaryFaint: 'rgba(99,102,241,0.25)',
  dangerStrong: '#f87171',
  dangerText: '#fca5a5',
  success: '#4ade80',
  successText: '#86efac',

  // ── Surfaces / lines ──
  surfaceAlt: '#1f2937',
  border: '#1f2937',
  hairline: '#1f2937',
  divider: 'rgba(229,231,235,0.14)',
  placeholder: '#1f2937',
  latestBg: '#151b2e',
  latestBorder: '#312e81',

  // ── Map chrome ──
  mapBg: '#0b0f1a',
  mapOverlayStrong: 'rgba(255,255,255,0.15)',
  blurTint: 'dark',
  statusBarStyle: 'light-content',

  // ── Shadows ──
  shadow: '#000000',
  shadowSoft: '#000000',

  // ── Toast tints ──
  toastGold: 'rgba(113,63,18,0.45)',
  toastIndigo: 'rgba(49,46,129,0.45)',
  toastSuccess: 'rgba(20,83,45,0.45)',
  toastError: 'rgba(127,29,29,0.45)',
};

module.exports = { light, dark };
