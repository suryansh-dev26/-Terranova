const test = require('node:test');
const assert = require('node:assert');
const { light, dark } = require('./tokens');

const CORE_TOKENS = ['bg', 'surface', 'text', 'textDim', 'primary', 'danger', 'mapOverlay'];

test('light and dark expose the same token keys', () => {
  assert.deepStrictEqual(Object.keys(light).sort(), Object.keys(dark).sort());
});

test('all core tokens exist in both themes', () => {
  for (const token of CORE_TOKENS) {
    assert.ok(token in light, `light.${token} missing`);
    assert.ok(token in dark, `dark.${token} missing`);
  }
});

test('dark theme matches the spec colors', () => {
  assert.strictEqual(dark.bg, '#0b0f1a');
  assert.strictEqual(dark.surface, '#111827');
  assert.strictEqual(dark.text, '#e5e7eb');
  assert.strictEqual(dark.primary, '#6366f1');
});

test('light theme keeps the original palette (pixel-identical light mode)', () => {
  assert.strictEqual(light.text, '#111827');
  assert.strictEqual(light.primary, '#6366f1');
  assert.strictEqual(light.danger, '#ef4444');
  assert.strictEqual(light.mapBg, '#e8eaf0');
  assert.strictEqual(light.blurTint, 'light');
});
