// Cloud Functions for RunRealm3 (firebase-functions v2 API — the v1
// `functions.firestore.document(...)` builder was removed in v6+).
const {onDocumentDeleted} = require("firebase-functions/firestore");
const {onCall, HttpsError} = require("firebase-functions/https");
const admin = require("firebase-admin");
const {migrateGuestData} = require("./lib/migrate");
admin.initializeApp();

// Ping a territory's owner when someone captures (deletes) it. Push tokens
// live on the user's profile doc (users/{uid}.pushToken), which only the
// owner can write per firestore.rules.
exports.notifyTerritoryAttack = onDocumentDeleted(
    "territories/{territoryId}",
    async (event) => {
      const snap = event.data;
      if (!snap) return null;
      const deletedTerritory = snap.data();
      const ownerId = deletedTerritory && deletedTerritory.userId;
      if (!ownerId) return null;

      const userDoc = await admin.firestore()
          .collection("users")
          .doc(ownerId)
          .get();

      if (!userDoc.exists) return null;

      const token = userDoc.data().pushToken;
      if (!token) return null;

      const message = {
        to: token,
        sound: "default",
        title: "Territory Invaded!",
        body: "Someone captured your territory! Run and take it back!",
        data: {type: "territory_attack"},
      };

      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(message),
      });

      return null;
    });

// GDPR/Play-Store "delete my data": purges the caller's runs, territories,
// profile doc (including badges/challenges subcollections when those ship),
// and finally the anonymous auth user itself. Admin SDK bypasses firestore
// rules by design — auth is enforced here instead.
exports.deleteUserData = onCall(async (request) => {
  const auth = request.auth;
  const uid = auth && auth.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to delete your data.");
  }

  const db = admin.firestore();

  // Pre-auth installs also have docs keyed by their old Runner-XXXX id. The
  // caller may ask to purge those too, but only if their profile proves
  // ownership (displayName was copied from that id at migration).
  const legacyId = typeof request.data === "object" && request.data !== null &&
      typeof request.data.legacyId === "string" ?
      request.data.legacyId :
      null;
  const userDoc = await db.collection("users").doc(uid).get();
  const ownsLegacy = Boolean(legacyId) && userDoc.exists &&
      userDoc.data().displayName === legacyId;
  const ownerIds = ownsLegacy ? [uid, legacyId] : [uid];

  // Profile first: removes the pushToken so the territory deletions below
  // don't fire "territory invaded" pushes at the user we're deleting.
  // recursiveDelete also clears subcollections (badges, challenges, ...).
  await db.recursiveDelete(db.collection("users").doc(uid));

  const deleteByOwner = async (collectionName, ownerId) => {
    // Batched deletes, looping until the query drains (500-write batch cap).
    for (;;) {
      const snap = await db.collection(collectionName)
          .where("userId", "==", ownerId)
          .limit(400)
          .get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      if (snap.size < 400) return;
    }
  };

  for (const collectionName of ["runs", "territories"]) {
    for (const ownerId of ownerIds) {
      await deleteByOwner(collectionName, ownerId);
    }
  }

  // Finally, the auth account. The client signs out and mints a fresh
  // anonymous identity afterwards.
  await admin.auth().deleteUser(uid).catch(() => null);

  return {deleted: true};
});

// "Import my guest data": rewrites the caller's old anonymous runs and
// territories onto their new signed-in account. Ownership of the guest
// identity is proven by a still-valid guest ID token captured by the client
// just before it switched accounts — the caller can't migrate arbitrary uids.
exports.migrateGuestData = onCall(async (request) => {
  const auth = request.auth;
  const uid = auth && auth.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to import guest data.");
  }
  if (auth.token && auth.token.firebase &&
      auth.token.firebase.sign_in_provider === "anonymous") {
    throw new HttpsError(
        "permission-denied",
        "Sign in with a real account to import guest data.");
  }

  const data = typeof request.data === "object" && request.data !== null ?
      request.data :
      {};
  const guestIdToken = typeof data.guestIdToken === "string" ?
      data.guestIdToken :
      null;
  const legacyId = typeof data.legacyId === "string" ? data.legacyId : null;
  if (!guestIdToken) {
    throw new HttpsError("invalid-argument", "guestIdToken is required.");
  }

  let guest;
  try {
    guest = await admin.auth().verifyIdToken(guestIdToken);
  } catch (error) {
    throw new HttpsError(
        "invalid-argument",
        "Guest session expired — reopen the app as a guest, then retry.");
  }
  if (guest.uid === uid) {
    throw new HttpsError(
        "failed-precondition", "Guest and account are the same user.");
  }
  if (guest.firebase.sign_in_provider !== "anonymous") {
    throw new HttpsError(
        "permission-denied", "Only anonymous guest data can be imported.");
  }

  const db = admin.firestore();
  const callerProfile = await db.collection("users").doc(uid).get();
  const newDisplayName = callerProfile.exists ?
      (callerProfile.data().displayName || null) :
      null;

  const result = await migrateGuestData(db, {
    newUid: uid,
    newDisplayName,
    guestUid: guest.uid,
    legacyId,
  });

  // The guest account has served its purpose.
  await admin.auth().deleteUser(guest.uid).catch(() => null);

  return result;
});
