# RunRealm Privacy Policy

**Effective date:** 6 July 2026

RunRealm ("the app") is a GPS running game: you run real-world loops to
capture territory on a shared map. This policy explains what data the app
collects, why, and what control you have over it.

## Data we collect

| Data | When | Why |
|---|---|---|
| **Precise location (GPS)** | Only while you are recording a run | To draw your route, measure distance, and compute the territory you capture. Location is **not** collected in the background or when no run is active. |
| **Account identity** | Created on first launch | A random Firebase identifier ties your runs and territories together. Signing up is optional: guests never provide a name, email, or phone number. If you choose to sign in, we store your email address and — for Google sign-in — your Google display name and profile photo URL. |
| **Display name** | Generated on first launch (e.g. "Runner-A1B2"), or taken from your Google account / chosen by you when signing in | Shown on the leaderboard and territory map instead of your ID. |
| **Run statistics** | When a run is saved | Route trace, distance, duration, captured area, approximate place (country/region/city), and timestamp — this is the gameplay content of the app. |

Beyond the optional account details above, we do **not** collect: contacts,
photos, advertising identifiers, push tokens, or any data from other apps.
The app contains no ads, no push notifications, and no third-party analytics
or tracking SDKs.

## How your data is used

- **Territory map** — saved routes become territory polygons visible to other
  players on the shared map, labelled with your display name.
- **Leaderboards** — total captured area, run count, and distance are ranked
  against other players, labelled with your display name.
- **In-app alerts** — when another runner captures your territory you see a
  notice inside the app. We send no push notifications and store no push
  tokens.

Your data is never used for advertising, profiling, or any purpose other than
running the game.

## Where your data is stored

Data is stored in **Google Firebase** (Cloud Firestore and Firebase
Authentication), acting as a data processor. Data is encrypted in transit
(TLS) and at rest by Google's infrastructure. Access is restricted by
Firestore Security Rules: only you (your authenticated device) can create
runs under your identity, and profile data is writable only by its owner.

## Data sharing

We share your data with **no one**. There are no third-party recipients, no
data sales, and no advertising partners. The only "sharing" is the gameplay
itself: your display name, territories, and aggregate stats are visible to
other players inside the app, as is inherent to a shared-map game.

## Your rights: deleting your data

You can delete everything, at any time, without contacting anyone:

> **Profile → "Delete my account and data"**

This permanently and irreversibly deletes your runs, routes, territories,
profile, and the account itself from our servers.

If you have already uninstalled the app, reinstall it and use the same
button, or email us (below) and we will delete your data manually — include
your display name (e.g. "Runner-A1B2") so we can locate it.

## Children

RunRealm does not knowingly collect personal information from children. The
app collects no identity data beyond the anonymous ID described above.

## Changes to this policy

Material changes will be posted at this URL with an updated effective date.

## Contact

Questions or deletion requests: **suryansh9342@gmail.com**
