const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

exports.getCards = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const uid = context.auth.uid;

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
         * Get cards
         */
        const psGetCardsOptions = {
          url: `${
            functions.config().env.paysafe.url
          }/customervault/v1/profiles/${
            firestoreUserDoc.paysafeProfileId
          }?fields=cards`,
          method: "GET",
          headers: {
            Authorization: `Basic ${
              functions.config().env.paysafe.serverToken
            }`,
            "Content-Type": "application/json",
          },
        };

        return axios(psGetCardsOptions)
          .then((cards) => {
            return cards.data;
          })
          .catch((e) => {
            console.log(e.response);
            throw new functions.https.HttpsError(
              "internal",
              "Could not fetch cards"
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
