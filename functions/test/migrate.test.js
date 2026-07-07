const test = require("node:test");
const assert = require("node:assert");
const {migrateGuestData, BATCH_LIMIT} = require("../lib/migrate");

// Minimal in-memory Firestore fake covering exactly the surface migrate.js
// uses: collection().doc().get()/delete(), collection().where().limit().get(),
// and batch().update()/delete()/commit().
const makeFakeDb = (seed) => {
  const data = {};
  for (const collectionName of Object.keys(seed)) {
    data[collectionName] = {};
    for (const id of Object.keys(seed[collectionName])) {
      data[collectionName][id] = Object.assign({}, seed[collectionName][id]);
    }
  }

  return {
    data,
    collection(name) {
      return {
        doc(id) {
          return {
            get: async () => ({
              exists: Boolean(data[name] && data[name][id]),
              data: () => data[name] && data[name][id],
            }),
            delete: async () => {
              if (data[name]) delete data[name][id];
            },
          };
        },
        where(field, op, value) {
          assert.strictEqual(op, "==");
          return {
            limit(n) {
              return {
                get: async () => {
                  const matches = Object.entries(data[name] || {})
                      .filter(([, doc]) => doc[field] === value)
                      .slice(0, n);
                  const docs = matches.map(([id, doc]) => ({
                    id,
                    data: () => doc,
                    ref: {collectionName: name, id},
                  }));
                  return {empty: docs.length === 0, size: docs.length, docs};
                },
              };
            },
          };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        update: (ref, patch) => ops.push(() => {
          Object.assign(data[ref.collectionName][ref.id], patch);
        }),
        delete: (ref) => ops.push(() => {
          delete data[ref.collectionName][ref.id];
        }),
        commit: async () => ops.forEach((apply) => apply()),
      };
    },
  };
};

const GUEST = "guest-anon-uid";
const NEW = "google-real-uid";

test("rewrites guest runs/territories to the new uid + name", async () => {
  const db = makeFakeDb({
    users: {[GUEST]: {displayName: "Runner-AB12"}},
    runs: {
      r1: {userId: GUEST, displayName: "Runner-AB12", distance: 1000},
      r2: {userId: "someone-else", distance: 2000},
    },
    territories: {
      t1: {userId: GUEST, displayName: "Runner-AB12", area: 5000},
    },
  });

  const result = await migrateGuestData(db, {
    newUid: NEW, newDisplayName: "Suryansh", guestUid: GUEST, legacyId: null,
  });

  assert.strictEqual(result.migrated, 2);
  assert.strictEqual(db.data.runs.r1.userId, NEW);
  assert.strictEqual(db.data.runs.r1.displayName, "Suryansh");
  assert.strictEqual(db.data.runs.r1.distance, 1000);
  assert.strictEqual(db.data.territories.t1.userId, NEW);
  // Other users' docs untouched.
  assert.strictEqual(db.data.runs.r2.userId, "someone-else");
});

test("includes legacy docs when the guest profile owns that name", async () => {
  const db = makeFakeDb({
    users: {[GUEST]: {displayName: "Runner-AB12"}},
    runs: {
      anon: {userId: GUEST},
      legacy: {userId: "Runner-AB12"},
    },
    territories: {},
  });

  const result = await migrateGuestData(db, {
    newUid: NEW,
    newDisplayName: "Suryansh",
    guestUid: GUEST,
    legacyId: "Runner-AB12",
  });

  assert.strictEqual(result.migrated, 2);
  assert.strictEqual(db.data.runs.legacy.userId, NEW);
});

test("skips legacy docs when the guest does NOT own that name", async () => {
  const db = makeFakeDb({
    users: {[GUEST]: {displayName: "Runner-AB12"}},
    runs: {
      anon: {userId: GUEST},
      victim: {userId: "Runner-ZZ99"},
    },
    territories: {},
  });

  const result = await migrateGuestData(db, {
    newUid: NEW,
    newDisplayName: "Suryansh",
    guestUid: GUEST,
    legacyId: "Runner-ZZ99",
  });

  assert.strictEqual(result.migrated, 1);
  assert.strictEqual(db.data.runs.victim.userId, "Runner-ZZ99");
});

test("deletes the guest profile doc (no ghost directory entry)", async () => {
  const db = makeFakeDb({
    users: {[GUEST]: {displayName: "Runner-AB12"}},
    runs: {},
    territories: {},
  });

  await migrateGuestData(db, {
    newUid: NEW, newDisplayName: "Suryansh", guestUid: GUEST, legacyId: null,
  });

  assert.strictEqual(db.data.users[GUEST], undefined);
});

test("keeps docs' displayName when the account has none yet", async () => {
  const db = makeFakeDb({
    users: {},
    runs: {r1: {userId: GUEST, displayName: "Runner-AB12"}},
    territories: {},
  });

  await migrateGuestData(db, {
    newUid: NEW, newDisplayName: null, guestUid: GUEST, legacyId: null,
  });

  assert.strictEqual(db.data.runs.r1.userId, NEW);
  assert.strictEqual(db.data.runs.r1.displayName, "Runner-AB12");
});

test("drains collections larger than one batch", async () => {
  const runs = {};
  const total = BATCH_LIMIT * 2 + 50;
  for (let i = 0; i < total; i++) {
    runs[`r${i}`] = {userId: GUEST};
  }
  const db = makeFakeDb({users: {}, runs, territories: {}});

  const result = await migrateGuestData(db, {
    newUid: NEW, newDisplayName: "Suryansh", guestUid: GUEST, legacyId: null,
  });

  assert.strictEqual(result.migrated, total);
  const owners = new Set(Object.values(db.data.runs).map((r) => r.userId));
  assert.deepStrictEqual([...owners], [NEW]);
});
