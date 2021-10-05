const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

exports.removeCard = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const uid = context.auth.uid;

  const { cardId } = data;

  /**
   * Get user doc
   */
  return admin
    .firestore()
    .collection("Users")
    .doc(uid)
    .get()
    .then((doc) => {
      if (doc.exists) {
        const firestoreUserDoc = doc.data();

        /**
         * Remove card
         */
        const psRemoveCardOptions = {
          url: `${
            functions.config().env.paysafe.url
          }/customervault/v1/profiles/${
            firestoreUserDoc.paysafeProfileId
          }/cards/${cardId}`,
          method: "DELETE",
          headers: {
            Authorization: `Basic ${
              functions.config().env.paysafe.serverToken
            }`,
            "Content-Type": "application/json",
          },
        };

        return axios(psRemoveCardOptions)
          .then((card) => {
            return card.data;
          })
          .catch((e) => {
            console.log(e.response);
            throw new functions.https.HttpsError(
              "internal",
              "Could not remove card"
            );
          });
      } else {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "User profile does not exist"
        );
      }
    });
});
