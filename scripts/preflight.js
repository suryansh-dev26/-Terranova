#!/usr/bin/env node
// Play Store submission preflight for RunRealm3.
// Usage: node scripts/preflight.js   (exits non-zero if any check fails)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const EXPECTED_PACKAGE = 'com.suryansh.runrealm';
const BLOCKED_PERMISSIONS = [
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
];

// App source that ships in the JS bundle (console.log check). Tests, scripts,
// and docs are exempt.
const APP_SOURCE_DIRS = ['screens', 'components', 'hooks', 'theme', 'lib', 'auth'];
const APP_SOURCE_FILES = [
  'App.js', 'firebase.js', 'NotificationContext.js',
  'HistoryScreen.js', 'LeaderboardScreen.js', 'ProfileScreen.js', 'index.js',
];

const listAppSources = () => {
  const files = APP_SOURCE_FILES.filter(exists);
  for (const dir of APP_SOURCE_DIRS) {
    if (!exists(dir)) continue;
    for (const entry of fs.readdirSync(path.join(root, dir))) {
      if (entry.endsWith('.js') && !entry.endsWith('.test.js')) {
        files.push(path.join(dir, entry));
      }
    }
  }
  return files;
};

const checks = [
  {
    name: `Package id is ${EXPECTED_PACKAGE} (no com.anonymous.*)`,
    run: () => {
      const app = JSON.parse(read('app.json')).expo;
      if (app.android.package !== EXPECTED_PACKAGE) {
        return `android.package is ${app.android.package}`;
      }
      if (app.ios && app.ios.bundleIdentifier !== EXPECTED_PACKAGE) {
        return `ios.bundleIdentifier is ${app.ios.bundleIdentifier}`;
      }
      if (read('app.json').includes('com.anonymous')) {
        return 'app.json still mentions com.anonymous';
      }
      if (exists('android/app/build.gradle') &&
          !read('android/app/build.gradle').includes(`applicationId '${EXPECTED_PACKAGE}'`)) {
        return 'android/app/build.gradle applicationId mismatch — rerun npx expo prebuild -p android --clean';
      }
      return null;
    },
  },
  {
    name: 'Scary permissions blocked (WRITE_EXTERNAL_STORAGE, SYSTEM_ALERT_WINDOW)',
    run: () => {
      const app = JSON.parse(read('app.json')).expo;
      const blocked = (app.android && app.android.blockedPermissions) || [];
      const missing = BLOCKED_PERMISSIONS.filter((p) => !blocked.includes(p));
      if (missing.length) return `not in blockedPermissions: ${missing.join(', ')}`;
      if (exists('android/app/src/main/AndroidManifest.xml')) {
        const manifest = read('android/app/src/main/AndroidManifest.xml');
        for (const perm of BLOCKED_PERMISSIONS) {
          const re = new RegExp(`${perm}"\\s+tools:node="remove"`);
          if (manifest.includes(perm) && !re.test(manifest)) {
            return `${perm} present in manifest without tools:node="remove" — rerun prebuild`;
          }
        }
      }
      return null;
    },
  },
  {
    name: 'firestore.rules present and wired into firebase.json',
    run: () => {
      if (!exists('firestore.rules')) return 'firestore.rules missing';
      const fb = JSON.parse(read('firebase.json'));
      if (!fb.firestore || fb.firestore.rules !== 'firestore.rules') {
        return 'firebase.json does not reference firestore.rules';
      }
      return null;
    },
  },
  {
    name: 'Privacy policy present (docs/privacy.md + docs/privacy.html)',
    run: () => {
      if (!exists('docs/privacy.md')) return 'docs/privacy.md missing';
      if (!exists('docs/privacy.html')) return 'docs/privacy.html missing';
      return null;
    },
  },
  {
    name: 'Version set (versionName 1.0.0, versionCode int) + EAS autoIncrement',
    run: () => {
      const app = JSON.parse(read('app.json')).expo;
      if (!/^\d+\.\d+\.\d+$/.test(app.version)) return `expo.version is ${app.version}`;
      if (!Number.isInteger(app.android.versionCode)) return 'android.versionCode not set';
      const eas = JSON.parse(read('eas.json'));
      if (eas.build.production.autoIncrement !== true) {
        return 'eas.json production.autoIncrement is not true';
      }
      return null;
    },
  },
  {
    name: 'No console.log in app source (warn/error allowed)',
    run: () => {
      const offenders = [];
      for (const file of listAppSources()) {
        const lines = read(file).split('\n');
        lines.forEach((line, i) => {
          if (/console\.log\(/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
      }
      return offenders.length ? offenders.join(', ') : null;
    },
  },
  {
    name: 'Unit tests pass (npm test)',
    run: () => {
      const result = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8' });
      if (result.status !== 0) {
        const tail = (result.stdout || '').split('\n').slice(-8).join('\n');
        return `npm test exited ${result.status}\n${tail}`;
      }
      return null;
    },
  },
];

console.log('\nRunRealm Play Store preflight');
console.log('─'.repeat(60));

let failures = 0;
for (const check of checks) {
  let problem;
  try {
    problem = check.run();
  } catch (error) {
    problem = error.message;
  }
  if (problem) {
    failures += 1;
    console.log(`❌ ${check.name}`);
    console.log(`   → ${problem}`);
  } else {
    console.log(`✅ ${check.name}`);
  }
}

console.log('─'.repeat(60));
if (failures) {
  console.log(`${failures} check(s) failed. Fix before building.\n`);
  process.exit(1);
}
console.log('All checks passed. Build with:');
console.log('  eas build -p android --profile production');
console.log('  eas submit -p android --latest\n');
