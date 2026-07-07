// Guest-data migration: rewrites ownership of runs/territories from an
// anonymous (guest) identity to a signed-in account. Pure orchestration over
// an injected Firestore handle so it can be unit-tested with a fake db
// (see test/migrate.test.js) — no emulator required.

const COLLECTIONS = ["runs", "territories"];
const BATCH_LIMIT = 400;

const migrateGuestData = async (
    db, {newUid, newDisplayName, guestUid, legacyId}) => {
  const sourceIds = [guestUid];

  // Legacy pre-auth docs (userId == literal "Runner-XXXX") only come along if
  // the guest profile proves ownership of that name — displayName was copied
  // from it during the anonymous-auth migration.
  if (legacyId && legacyId !== guestUid) {
    const guestProfile = await db.collection("users").doc(guestUid).get();
    if (guestProfile.exists && guestProfile.data().displayName === legacyId) {
      sourceIds.push(legacyId);
    }
  }

  const update = {userId: newUid};
  if (newDisplayName) update.displayName = newDisplayName;

  let migrated = 0;
  for (const collectionName of COLLECTIONS) {
    for (const sourceId of sourceIds) {
      // Batched rewrites, looping until the query drains (updated docs stop
      // matching the where clause). 400 stays under the 500-write batch cap.
      for (;;) {
        const snap = await db.collection(collectionName)
            .where("userId", "==", sourceId)
            .limit(BATCH_LIMIT)
            .get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((docSnap) => batch.update(docSnap.ref, update));
        await batch.commit();
        migrated += snap.size;
        if (snap.size < BATCH_LIMIT) break;
      }
    }
  }

  // Remove the guest profile so the user directory doesn't keep a ghost entry.
  await db.collection("users").doc(guestUid).delete();

  return {migrated};
};

module.exports = {migrateGuestData, COLLECTIONS, BATCH_LIMIT};
