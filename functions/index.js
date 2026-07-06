const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.notifyTerritoryAttack = functions.firestore
    .document("territories/{territoryId}")
    .onDelete(async (snap, context) => {
      const deletedTerritory = snap.data();
      const ownerId = deletedTerritory.userId;
      if (!ownerId) return null;

      // Push tokens live on the user's profile doc (users/{uid}.pushToken),
      // which only the owner can write per firestore.rules. The legacy
      // pushTokens/{ownerId} collection is no longer used.
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
