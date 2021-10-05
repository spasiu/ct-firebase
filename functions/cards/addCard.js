const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

exports.addCard = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const uid = context.auth.uid;

  const { singleUseToken } = data;

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
         * Verify card token
         */
        const psVerifyCardOptions = {
          url: `${
            functions.config().env.paysafe.url
          }/cardpayments/v1/accounts/${
            functions.config().env.paysafe.accountId
          }/verifications`,
          method: "POST",
          headers: {
            Authorization: `Basic ${
              functions.config().env.paysafe.serverToken
            }`,
            "Content-Type": "application/json",
          },
          data: {
            card: {
              paymentToken: singleUseToken,
            },
            merchantRefNum: `${uid}-addCard-${Date.now()}`,
            storedCredential: {
              type: "RECURRING",
              occurrence: "INITIAL",
            },
          },
        };

        return axios(psVerifyCardOptions)
          .then(() => {
            /**
             * Add card to vault if verified
             */
            const psAddCardOptions = {
              url: `${
                functions.config().env.paysafe.url
              }/customervault/v1/profiles/${
                firestoreUserDoc.paysafeProfileId
              }/cards`,
              method: "POST",
              headers: {
                Authorization: `Basic ${
                  functions.config().env.paysafe.serverToken
                }`,
                "Content-Type": "application/json",
              },
              data: {
                singleUseToken,
                accountId: functions.config().env.paysafe.accountId,
              },
            };

            return axios(psAddCardOptions)
              .then((card) => {
                return card.data;
              })
              .catch((e) => {
                console.log(e.response);
                throw new functions.https.HttpsError(
                  "internal",
                  "Could not add card"
                );
              });
          })
          .catch((e) => {
            console.log(e.response);
            throw new functions.https.HttpsError(
              "internal",
              "Could not verify card"
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
