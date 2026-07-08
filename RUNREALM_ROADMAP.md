# RunRealm 3 — Ship-Ready Roadmap

Audit + gap analysis + Play Store plan + ready-to-paste Fable 5 prompts.
Last reviewed: 2026‑07‑05.

---

## 1. What you actually have (honest snapshot)

**Stack:** Expo SDK 54, RN 0.81, React 19, MapLibre (OpenFreeMap + ESRI + OpenTopoMap — no Google Maps bill), Firebase JS SDK 12, `@turf/turf` 7, `expo-location`, `expo-blur`, React Navigation 7, one Cloud Function.

**Working today:**

- GPS tracking with accuracy filter, jump‑guard, midpoint smoothing (`lib/geo.js`).
- Live route drawing, live distance, auto‑pan camera, 3D pitch while running.
- **Auto loop detection** (>20 pts, >300 m, <30 m to start) → auto‑stops and captures. This is nicer than most Zombies‑Run/Turf‑Wars clones.
- Territory capture with turf `union` / `intersect` / `difference`, including "cut" and "delete" of enemy polygons — a real domination engine, not a demo.
- Firestore with `experimentalForceLongPolling` (correct fix for the RN + WebChannel bug you already found), `onSnapshot` + 15 s `getDocs` fallback for Android.
- Anonymous device‑local ID (`Runner‑XXXX` in AsyncStorage), hashed to a color palette.
- Global leaderboard by total area.
- Profile screen with 6 stat cards + calendar streak logic + recent runs.
- History screen sorted by date.
- In‑app toast/notification system with proper animations, a11y roles, and duration control.
- Cloud Function `notifyTerritoryAttack` that pings owner via Expo push when their territory is deleted.
- Real unit tests on the geo module (`node --test`).
- Clean Instagram‑style floating BlurView UI, dark map + light chrome.

That's a lot. This is not a toy — it's a real app that needs a haircut, not a rewrite.

---

## 2. Gap vs the original prompt (what's missing)

| # | Prompt feature | Status | Notes |
|---|---|---|---|
| 1 | GPS run tracking | ✅ Done | Nothing to add. |
| 2 | Map + live path | ✅ Done | Uses MapLibre + OSM instead of Google Maps — better (free, keyless). Update UI copy to stop saying "Google Maps". |
| 3 | Territory capture | ✅ Done | Actually exceeds the prompt (cut/delete enemy). |
| 4a | Global leaderboard | ✅ Done | — |
| 4b | Country leaderboard | ❌ Missing | Need to store `country` on run/user. |
| 4c | City leaderboard | ❌ Missing | Reverse‑geocode last known point via `expo-location`. |
| 5 | Profile | ✅ Mostly | No editable name/avatar; achievements not surfaced. |
| 6a | Daily challenges | ❌ Missing | E.g. "run 3 km today". |
| 6b | Streak | ✅ Done | — |
| 6c | Badges + levels | ❌ Missing | Only the streak counter exists. |
| UI | Dark mode | ❌ Missing | `userInterfaceStyle: "light"` in app.json. Add system‑following theme. |
| UI | Modern polish | ✅ Done | The BlurView UI is genuinely good. |
| Tech | Explain logic | ✅ Done | Comments in `App.js` and `lib/geo.js` are excellent. |

**Also removed but shipped in prompt spirit:** `expo-notifications` was ripped out of `App.js` (Expo Go SDK 53+ push limitation). The Cloud Function still assumes it exists. Re‑enable in a dev build (not Expo Go) — see prompts below.

---

## 3. MIT/Harvard‑level polish audit

Ranked by blast radius. Fix P0 before Play Store. P1 before scaling past 100 users. P2 is craft.

### P0 — Ship‑blockers

1. **Firestore is wide open.** No `firestore.rules` file. Anyone with your `apiKey` (which is in git) can read/write/delete every doc. This alone will fail an MIT‑style review and will get griefed within days of launch.
2. **Anyone can spoof any `userId`.** The client picks its own ID and writes it into `runs.userId`. Without auth, one user can wipe another's territory by writing garbage docs. You need real auth (Firebase Anonymous Auth is enough — no signup UX cost, but ties an ID to the Firebase user).
3. **Package name is `com.anonymous.RunRealm3`.** Play Store rejects `com.anonymous.*`. Pick a permanent ID like `com.suryansh.runrealm` — **it cannot be changed after first upload.**
4. **No signing keystore committed / documented.** EAS can manage it, but you must generate it once and back up the credentials.
5. **Two unnecessary Android permissions** in the manifest: `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`. Both look scary in the Play Store listing and force extra Data‑Safety justification. Drop them.
6. **No privacy policy URL.** Play Store requires one because you collect precise location. Host a one‑page policy (GitHub Pages works).
7. **Version 1.0.0 / versionCode 1.** Fine for first upload, but confirm `eas.json` `production.autoIncrement` is doing the increment.
8. **Firebase config duplicated** in `App.js` and `LeaderboardScreen.js`. Any future field/change will drift.
9. **`getUserColor` and the color palette are copy‑pasted** in `ProfileScreen.js` — same drift risk.

### P1 — Quality bar for "elite"

10. **App.js is 1072 lines.** Split: `screens/HomeScreen.js`, `hooks/useRunSession.js`, `firebase.js`, `styles/theme.js`. Also gives you a place to put dark mode.
11. **No top‑level ErrorBoundary.** You only wrap the map. One bad render anywhere else crashes the whole app.
12. **No crash reporting or analytics.** Add Sentry (free tier) or Firebase Crashlytics — an MIT reviewer will ask "how do you know what breaks in the field?"
13. **No offline queue.** If Firestore is unreachable when a user stops a run, the run is silently lost. Persist to AsyncStorage, retry on next launch.
14. **Battery.** `timeInterval: 1000, distanceInterval: 2, BestForNavigation` is a battery firehose. Add a screen‑off / paused mode.
15. **Server‑side anti‑cheat.** Right now a user can `addDoc` a `route` of two teleporting points and claim a giant area. Add a Cloud Function that recomputes area from `route` on write, rejects impossible pace/area.
16. **Foreground‑service notice.** If a run tracks with the screen off, current setup will be killed by Android's Doze. Either (a) declare a foreground service with a persistent notification, or (b) explicitly document "keep screen on to track" and use `expo-keep-awake`.
17. **No i18n.** All strings in‑line. A `strings.js` file (even without translation) is a step up.
18. **TypeScript.** Strictly optional, but adopting it — even just for `lib/geo.ts` — signals seriousness. Turf and RN both ship types.
19. **Accessibility sweep.** Labels on start/stop button, map region, tab bar. You already do this in `NotificationContext.js` — nice — extend the pattern.
20. **README** is 1 line. Add a real one with architecture diagram + screenshots.

### P2 — Craft polish

21. **Loop detection threshold** is a magic tuple (`>20 pts && >300 m && <30 m`). Extract to `LOOP_MIN_POINTS`, `LOOP_MIN_DISTANCE`, `LOOP_CLOSE_RADIUS` constants at the top of `App.js`.
22. **Territory unit** is inconsistent: `formatArea` in `App.js/lib/geo.js` uses `ha`; `LeaderboardScreen`/`ProfileScreen` use `km²`. Pick one.
23. **`isValidGPSPoint` drops points with `dist < 5`.** Combined with `ROUTE_MIN_DISTANCE = 5`, you're double‑filtering. Fine, but noteworthy.
24. **`generateUserId` uses `Math.random()`** — collision chance is small but nonzero. If you're moving to real auth (P0 #2), this becomes moot.
25. **`memory-reel*.mp4` (200 MB!) and 5 `.apk` files (~460 MB total) are checked into the repo.** Add to `.gitignore`, remove with `git filter‑repo`. Not a Play Store issue, just hygiene.

---

## 4. Play Store publishing plan

### Prereqs (do these once)

- [ ] Google Play Console account, $25 one‑time. Personal or organization — **organization is easier** for the tester rule below.
- [ ] Permanent package ID chosen (e.g. `com.suryansh.runrealm`).
- [ ] Privacy policy URL live.
- [ ] App icon (512×512 PNG), feature graphic (1024×500 PNG), 2–8 screenshots per form factor.
- [ ] Short description (80 chars), full description (4000 chars).
- [ ] Google keystore backed up somewhere safe (or "let Google manage" via Play App Signing — recommended).

### Build + upload flow (EAS)

```
# 1. Rotate the applicationId in app.json + android/app/build.gradle
# 2. Build an AAB (Play Store format)
eas build -p android --profile production
# 3. Submit
eas submit -p android --latest
```

### Data safety form (fill it this way)

- Location → Precise + Approximate; used for App functionality (Fitness/health tracking); shared with no third parties (you use Firebase, but Firebase is a processor, not a recipient — declare it as such).
- Personal identifier → the anonymous `Runner‑XXXX`. If you add Firebase Anonymous Auth (recommended), declare `Firebase Anonymous Auth UID` as a User ID collected for App functionality.
- Data is encrypted in transit: yes.
- Users can request data deletion: **you must build this.** Add a "Delete my data" button in Profile that calls a Cloud Function to purge the user's runs + territories.

### Closed testing (this is the 2024+ requirement)

Google now requires new personal developer accounts to run **closed testing with 12+ testers for 14 consecutive days** before the app is eligible for production. Organization accounts don't have this rule. If you're on a personal account:

1. Create a Google Group `runrealm-testers@googlegroups.com`.
2. Add 12+ testers as members.
3. Set that group as the tester list on the "Closed testing" track.
4. Publish a closed‑testing release. Each tester must opt in and keep the app installed for the 14 days to count.

### Where to find testers

- **r/AlphaandBetaUsers** and **r/TestMyApp** — post a screenshot + Play Store opt‑in link.
- **BetaList**, **TestFlight forums** (they take Android beta posts too).
- **Discord**: "AndroidBeta", "Beta Testers United".
- **Your own network**: 12 friends is enough. Ask each to install and open once a day for two weeks — that's all Google actually checks.
- The Play Console has a built‑in "Find testers" service now (paid, ~$40 for 20 testers × 14 days). Fastest option.

---

## 5. Concrete Fable 5 prompts to paste into Claude Code

Each prompt is self‑contained. Run them in order — dependencies are noted. Use `--model claude-fable-5` (or select Fable 5 in the picker) so you're using the model you asked for.

### Prompt A — P0 security lockdown (do first, ~1 hr)

```
Do a security lockdown pass on RunRealm3.

Goals:
1. Add firestore.rules that enforce:
   - runs: only readable by anyone (leaderboard needs it), writable only if
     request.auth.uid == request.resource.data.userId and the doc has fields
     userId (string), route (list<=10000), distance (int 0..1e8),
     area (int 0..1e10), time (int 0..1e6), createdAt (server timestamp).
   - territories: readable by anyone; create requires auth.uid == userId;
     update/delete only by owner OR by a Cloud Function using admin SDK.
   - all other paths default deny.
2. Migrate the app to Firebase Anonymous Auth. On first launch:
   signInAnonymously → store the resulting uid as our userId (replacing the
   current AsyncStorage 'Runner-XXXX'). Keep the color palette lookup working
   off the uid. Migrate existing local users by, on next launch, if we have an
   old 'Runner-XXXX' in AsyncStorage, write a users/{uid} doc that stores it as
   'displayName' so the leaderboard keeps showing the friendly name.
3. Extract firebase init into a single firebase.js and import from every screen.
   Delete the duplicated firebaseConfig block in LeaderboardScreen.js and the
   duplicated getUserColor block in ProfileScreen.js.
4. Update all Firestore reads/writes so they use the auth uid, not the local id.
5. Update the Cloud Function to look up push tokens under users/{uid}/pushToken
   instead of pushTokens/{ownerId}.
6. Write a short SECURITY.md documenting the rules and the threat model.

Do not touch UI. Preserve all animations. Run `npm test` at the end and make
sure lib/geo tests still pass.
```

### Prompt B — split App.js, add ErrorBoundary + dark mode (2 hr)

```
Refactor RunRealm3's App.js (1072 lines) into a cleaner tree without changing
behavior:

- screens/HomeScreen.js  (the current HomeScreen component)
- hooks/useRunSession.js (startRun, stopRun, GPS watcher, loop detection, all
  the refs) — expose { isRunning, elapsedSeconds, routeCoords, totalDistance,
  location, distanceToStart, loopDetected, area, dominationMsg, start, stop }
- components/MapCanvas.js (MapGL + layers + MapErrorBoundary)
- components/BottomSheet.js (the stats + Start/Stop card)
- theme/ThemeProvider.js — a light/dark theme provider that follows
  Appearance.getColorScheme() by default, with a toggle stored in AsyncStorage.
  Replace every hardcoded color in App.js/HomeScreen/History/Leaderboard/Profile
  with theme tokens (bg, surface, text, textDim, primary, danger, mapOverlay).
- App.js becomes a thin shell: <ThemeProvider><ErrorBoundary>…</ErrorBoundary></ThemeProvider>

Add a top-level RootErrorBoundary that shows a friendly "Something went wrong —
tap to restart" screen instead of a white screen of death.

Set app.json userInterfaceStyle to "automatic". Add a "Theme" row in
ProfileScreen with System / Light / Dark options.

Keep every existing style pixel-identical in light mode. Dark mode should use
#0b0f1a bg, #111827 surface, #e5e7eb text, #6366f1 primary. Test on both.
```

### Prompt C — Country + City leaderboards (1 hr, needs Prompt A)

```
Extend the leaderboard in RunRealm3.

1. When a run is saved, reverse-geocode the last GPS point with
   Location.reverseGeocodeAsync and store { country: 'IN', region: 'Rajasthan',
   city: 'Jaipur' } on the run doc AND on the users/{uid} doc.
2. In LeaderboardScreen, add a segmented control at the top: Global | Country |
   City. Country/City default to the current user's location.
3. Aggregate territory area per user for the selected scope. Show empty state
   ("Be the first runner in Jaipur!") when the scope has no data.
4. Add Firestore composite indexes if needed. Include instructions in the PR
   description for creating them.
5. Cache reverse-geocode results locally so we don't re-hit the API on every
   run.

Do not regress the Global tab. Keep the top-3 emoji medal styling.
```

### Prompt D — Daily challenges + badges + levels (2 hr)

```
Add gamification to RunRealm3 per the original product spec.

1. Daily challenges:
   - challenges/{yyyy-mm-dd} doc, seeded by a Cloud Function scheduled at
     00:00 UTC. Types: distance (2/3/5 km), area (5000/10000 m²), loops (1/2).
   - HomeScreen bottom sheet shows today's challenge with a live progress ring.
   - On completion, write users/{uid}/challenges/{date} = { completedAt } and
     grant XP.
2. XP + levels: every challenge = 100 XP, every km = 20 XP, every 1000 m²
   captured = 10 XP. Level = floor(sqrt(XP / 100)). Show level + progress bar
   on ProfileScreen.
3. Badges: define a static list in lib/badges.js (First Run, Marathon Runner
   [42.195 km lifetime], Empire Builder [1 km² total], Untouchable [7-day
   streak], Cartographer [runs in 3 different cities], Loop Master [10 loops]).
   Evaluate after every run save; write earned badges to users/{uid}/badges.
4. New ProfileScreen sections: "Level X" ring, "Today's Challenge" card,
   "Badges" grid (locked ones grayscale).

Use the theme tokens from Prompt B. Write unit tests for the level formula and
each badge predicate in lib/badges.test.js.
```

### Prompt E — Anti-cheat + offline queue + battery (1.5 hr)

```
Harden RunRealm3 for real-world use.

1. Server-side validation Cloud Function: onCreate for runs/{id}:
   - recompute distance from route with haversine, area from route with turf.
   - reject (delete + log) if (a) pace < 3 min/km (world record territory),
     (b) area/distance ratio implies teleport, (c) route has < 5 points.
   - stamp validated: true when it passes.
   - Update leaderboard aggregation to only include validated runs.
2. Offline queue: if saveRunToFirestore fails, push the payload to
   AsyncStorage 'pendingRuns'. On next app foreground with network, drain the
   queue oldest-first. Show a small "Syncing 2 runs…" chip when non-empty.
3. Battery: expose a "Battery saver" toggle in ProfileScreen.
   - ON: watchPositionAsync with Accuracy.Balanced, timeInterval 3000,
     distanceInterval 5.
   - OFF (default): current settings.
   Also expo-keep-awake while a run is in progress so Doze doesn't kill it.

Write unit tests for the validation function using firebase-functions-test.
```

### Prompt F — Play Store submission prep (1 hr, do last)

```
Prepare RunRealm3 for a first Google Play Store submission.

1. Rename applicationId from com.anonymous.RunRealm3 to com.suryansh.runrealm
   in app.json, android/app/build.gradle, and MainApplication package path.
   Also update the Android package folder structure.
2. In android/app/src/main/AndroidManifest.xml, DELETE:
   - android.permission.WRITE_EXTERNAL_STORAGE
   - android.permission.SYSTEM_ALERT_WINDOW
   Keep the location + internet + vibrate perms.
3. Add a 'Delete my account and data' row in ProfileScreen that calls a new
   Cloud Function `deleteUserData` which purges runs, territories, badges,
   challenges, and the users/{uid} doc for the caller. Confirm dialog before
   firing.
4. Write a privacy policy at docs/privacy.md covering: data collected (precise
   location, anonymous user id, run stats), how it's used (leaderboard,
   territory map), storage (Firebase), sharing (none), user rights (delete),
   contact email. Also emit as docs/privacy.html for hosting on GitHub Pages.
5. Write a store listing at docs/store-listing.md with:
   - Short description (80 chars max)
   - Full description (4000 chars, punchy)
   - "What's new" for v1.0.0
6. Bump versionCode to 1, versionName to "1.0.0". Confirm eas.json
   production.autoIncrement is 'true'.
7. Print a submission checklist to the console via `node scripts/preflight.js`
   that checks: package id changed, permissions trimmed, firestore.rules
   present, privacy.md present, no console.log in production build, tests pass.

Do not build — I'll run `eas build -p android --profile production` myself.
```

### Prompt G — Optional: TypeScript migration (2 hr, elite polish)

```
Migrate RunRealm3 to TypeScript incrementally.

1. Add tsconfig.json with strict: true, jsx: react-native, noEmit: true.
2. Rename lib/geo.js → lib/geo.ts with proper types (LatLng, TurfPolygon,
   TerritoryConflict). Keep the test file as .test.ts using node --test with
   tsx.
3. Rename firebase.js → firebase.ts.
4. Add types/models.ts with Run, Territory, User, Badge, Challenge.
5. Leave screens as .js for now — they can migrate later.
6. Update package.json test script to use tsx.

Do not change any runtime behavior.
```

---

## 6. Suggested execution order

1. **Prompt A** (security) — this weekend. Non‑negotiable before any tester sees it.
2. **Prompt B** (refactor + dark mode).
3. **Prompt F** (Play Store prep) + set up Play Console + upload first closed‑testing build. Start the 14‑day clock **immediately** — you can keep coding while the timer runs.
4. **Prompt C** (country/city leaderboards) — in parallel with the 14 days.
5. **Prompt D** (challenges + badges).
6. **Prompt E** (anti‑cheat + offline).
7. **Prompt G** (TS) — polish, optional.
8. Graduate to production, ship v1.0.0.

---

## 7. Extra suggestions you didn't ask for

- **Social**: add a "Follow" system (Firestore `users/{uid}/follows`) and a "friends only" leaderboard. This is the single biggest retention lever for turf‑capture games.
- **Share card**: on run complete, generate a shareable PNG of the map + stats (`react-native-view-shot` → `expo-sharing`). Free viral loop.
- **Notifications**: re‑enable `expo-notifications` in a dev build (Expo Go blocks it since SDK 53). Your Cloud Function already assumes this — it's currently a no‑op.
- **Screen recording**: you've got two 100 MB memory reel mp4s in the repo — clearly you've been making promo content. Use frames from those for the Play Store feature graphic.
- **Domain name**: buy `runrealm.app` for $12/yr and put the privacy policy + landing page there. Investors, testers, and Google all trust `runrealm.app/privacy` more than `github.io/…`.
