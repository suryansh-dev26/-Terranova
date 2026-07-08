# RunRealm3 Security Model

Last updated: 2026-07 (Spark-plan refactor: no Cloud Functions, no Storage).

**Plan constraint:** the project runs on the Firebase Spark (free) plan.
There are no Cloud Functions and no Firebase Storage — everything the app
does happens client-side under Firestore security rules. Features that
require a server (push notifications, guest-data migration, server-side
anti-cheat) are disabled or deferred until a Blaze upgrade.

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

**Guest → account upgrade:** signing in from a guest session starts a fresh
account. There is **no data migration** — rewriting doc ownership safely
requires the Admin SDK (a Cloud Function), which the Spark plan rules out.
The sign-in screen warns guests that their runs stay with the old
Runner-XXXX identity before they proceed.

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
| `runs/{id}` | public | owner only, validated fields | never | owner only |
| `territories/{id}` | public | owner only, validated fields | any signed-in user, **shrink-only**, owner immutable | any signed-in user |
| `users/{uid}` | public | owner only | owner only | owner only |
| everything else | deny | deny | deny | deny |

Owner-delete on runs and the profile doc exists for one reason: the in-app
"delete my account and data" purge runs client-side (no Cloud Functions).
Nobody can edit a run after the fact, and nobody can touch anyone else's
history.

Field validation on create:

- `runs`: exactly `userId, route, distance, area, time, createdAt`
  (+ optional `displayName`, `country` ≤3, `region` ≤100, `city` ≤100);
  `route` capped at 10 000 points; `distance` 0–10⁸ m; `area` 0–10¹⁰ m²;
  `time` 0–10⁶ s; `createdAt` must be the server timestamp. Runs can never
  be edited — only owner-deleted (data-deletion right).
- `territories`: exactly `userId, polygon, area, createdAt` (+ optional
  `displayName`); polygon ring 4–10 000 points; `area` 0–10¹⁰;
  server timestamp enforced.
- `users`: only `displayName` (1–50 chars), `email` (string, ≤254, writable
  only by the owner like every profile field), `photoURL` (string, ≤500 —
  the Google account photo; there is no Firebase Storage / in-app upload),
  `createdAt`, and location (`country`/`region`/`city`).

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
| Editing/deleting other users' run history | **Blocked** — runs are never editable, and only the owner may delete their own. |
| Tampering with profiles / push tokens | **Blocked** — `users/{uid}` writable only by its owner. |
| Growing your own territory by direct doc update | **Blocked** — updates are shrink-only; expansion requires creating a new owned territory via a run. |
| Fabricated GPS routes / impossible areas (cheating) | **Partially mitigated** — field bounds only. Full mitigation = server-side route validation (planned). |
| Deleting enemy territory without a legitimate overlap | **Accepted for now** — requires a signed-in client; server-side conflict resolution will close it (needs Blaze). |
| Push notification abuse | **N/A** — push is removed on the Spark plan; territory attacks surface as in-app alerts while the app is open. |

## Data deletion

Profile → "Delete my account and data" runs entirely client-side: batched
deletes of the caller's runs and territories (owner-delete rules), then the
`users/{uid}` doc, then the Firebase Auth account itself. If Firebase demands
a recent sign-in before deleting the auth record, the data is still purged
and the user is told to sign in once more to finish. This satisfies the Play
Store data-deletion requirement; see docs/privacy.md.

Known gap: docs keyed by a *pre-auth* legacy `Runner-XXXX` id (not a real
uid) can't be deleted by rules-constrained clients — those requests go
through the privacy-policy contact email.

## Operational notes

- Deploy rules with `firebase deploy --only firestore:rules` (wired in
  `firebase.json`).
- No Cloud Functions are deployed. If any return (push, anti-cheat,
  migration), they use the Admin SDK and bypass rules — keep them minimal
  and audited, and tighten territory update/delete to owner-or-function.
- Auth persistence uses AsyncStorage — clearing app storage mints a fresh
  anonymous uid (old territory is orphaned but the old displayName is
  re-adopted if the legacy key survives). Account linking (e.g. Google) would
  make identity durable; not yet implemented.
- Do not add new collections without a matching rules block: the trailing
  `match /{document=**}` denies them, so missing rules fail closed.
