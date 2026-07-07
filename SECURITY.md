# RunRealm3 Security Model

Last updated: 2026-07 (real accounts: Google / email / guest).

## Identity

Users sign in with **Google**, **email/password**, or as a **guest**
(Firebase Anonymous Auth — also the default for pre-accounts installs). In
every case the auth `uid` is the canonical user id: all `runs` and
`territories` docs are keyed by it, and Firestore rules enforce that a client
can only write docs stamped with its own uid.

Display names are cosmetic. Guests get a generated `Runner-XXXX`; real
accounts use their Google name or a self-chosen name (client-enforced 3–20
chars). Names live in `users/{uid}.displayName` and are denormalized onto new
run/territory docs; leaderboards read names/photos from a cached `users`
directory.

**Guest → account upgrade:** when a guest signs in with a real account, the
client offers to import the guest's data. The `migrateGuestData` Cloud
Function requires the caller to present the guest session's still-valid ID
token as proof of ownership (verified with the Admin SDK, and the token must
be from an anonymous session) — a caller can never migrate an arbitrary uid's
data. After migration the guest auth account is deleted.

**Migration:** installs that predate auth had a self-assigned `Runner-XXXX` in
AsyncStorage (key `userId`). On the first authenticated launch that name is
written to `users/{uid}.displayName`, so the leaderboard keeps showing the
familiar name. Old docs keyed by the legacy id are *not* rewritten; the Profile
screen queries both ids (`userId in [uid, legacyId]`) so personal stats carry
over, but on the leaderboard legacy and new runs appear as separate entries
until a one-off admin migration rewrites old docs.

## Firestore rules (`firestore.rules`)

| Path | read | create | update | delete |
|---|---|---|---|---|
| `runs/{id}` | public | owner only, validated fields | never | never |
| `territories/{id}` | public | owner only, validated fields | any signed-in user, **shrink-only**, owner immutable | any signed-in user |
| `users/{uid}` | public | owner only | owner only | never |
| everything else | deny | deny | deny | deny |

Field validation on create:

- `runs`: exactly `userId, route, distance, area, time, createdAt`
  (+ optional `displayName`); `route` capped at 10 000 points; `distance`
  0–10⁸ m; `area` 0–10¹⁰ m²; `time` 0–10⁶ s; `createdAt` must be the server
  timestamp. Runs are append-only — no client can edit or delete a workout
  record after the fact.
- `territories`: exactly `userId, polygon, area, createdAt` (+ optional
  `displayName`); polygon ring 4–10 000 points; `area` 0–10¹⁰;
  server timestamp enforced.
- `users`: only `displayName` (1–50 chars), `email` (string, ≤254, writable
  only by the owner like every profile field), `photoURL` (string, ≤500),
  `createdAt`, `pushToken`.

### Storage (`storage.rules`)

Only `users/{uid}/avatar.jpg` exists: owner-writable (auth required, <5 MB,
`image/*` content type), publicly readable (avatars render on the
leaderboard). Every other path is denied.

### Why territory update/delete is not owner-only

Cutting and capturing *enemy* territory is the core game mechanic, and it is
executed client-side (`App.js → saveRunToFirestore`). Owner-only rules would
silently break domination (the client swallows write errors in the conflict
loop). The compromise:

- update/delete requires **authentication** (no drive-by anonymous REST abuse),
- an update may only touch `polygon` + `area`, may never grow `area`, and can
  never reassign `userId` — so the worst a hostile client can do is shrink or
  remove territory, which is exactly what the game already allows via running.

The remaining abuse (deleting territories without actually running there, or
claiming fabricated routes) is a **gameplay-integrity** problem, not a data-
security one, and is planned as server-side validation: a Cloud Function that
recomputes distance/area from the route on write, rejects impossible pace or
teleporting routes, and eventually takes over conflict resolution with the
Admin SDK (at which point territory update/delete tightens to owner-or-function
only). See the roadmap, Prompt E.

## Threat model

| Threat | Status |
|---|---|
| Unauthenticated read/write via leaked web API key | **Blocked** — all writes require auth; non-game paths default-deny. The `apiKey` in `firebase.js` is a project identifier, not a secret; rules are the boundary. |
| Spoofing another user's `userId` on runs/territories | **Blocked** — `request.auth.uid` must equal the doc's `userId` on create. |
| Editing/deleting other users' run history | **Blocked** — runs are append-only for everyone. |
| Tampering with profiles / push tokens | **Blocked** — `users/{uid}` writable only by its owner. |
| Growing your own territory by direct doc update | **Blocked** — updates are shrink-only; expansion requires creating a new owned territory via a run. |
| Fabricated GPS routes / impossible areas (cheating) | **Partially mitigated** — field bounds only. Full mitigation = server-side route validation (planned). |
| Deleting enemy territory without a legitimate overlap | **Accepted for now** — requires a signed-in client; server-side conflict resolution will close it (planned). |
| Push notification abuse | Cloud Function reads `users/{uid}.pushToken` (owner-written) and only fires on actual territory deletion. |

## Data deletion

Profile → "Delete my account and data" calls the `deleteUserData` callable
Cloud Function (auth required). It purges the caller's runs, territories, and
`users/{uid}` doc (including subcollections), then deletes the anonymous auth
account; the app signs back in as a brand-new runner. Legacy pre-auth docs
(keyed by the old Runner-XXXX id) are purged too, but only when the caller's
`displayName` proves ownership of that id. This satisfies the Play Store
data-deletion requirement; see docs/privacy.md.

## Operational notes

- Deploy rules with `firebase deploy --only firestore:rules` (wired in
  `firebase.json`).
- Cloud Functions use the Admin SDK and bypass rules by design; keep them
  minimal and audited.
- Auth persistence uses AsyncStorage — clearing app storage mints a fresh
  anonymous uid (old territory is orphaned but the old displayName is
  re-adopted if the legacy key survives). Account linking (e.g. Google) would
  make identity durable; not yet implemented.
- Do not add new collections without a matching rules block: the trailing
  `match /{document=**}` denies them, so missing rules fail closed.
