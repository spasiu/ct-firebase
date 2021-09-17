const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

/**
 * TODO: Add big commerce user ID to Hasura as well
 */
exports.createBigCommerceUser = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Must be logged in."
      );
    }

    const { first_name, last_name } = data;

    const uid = context.auth.uid;
    const email = context.auth.token.email;

    let bcUserRequest;

    const bcCreateUseOptions = {
      url: `${bigCommerceConfig.urlV2}/customers`,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Client": bigCommerceConfig.clientId,
        "X-Auth-Token": bigCommerceConfig.accessToken,
      },
      data: {
        email: email,
        first_name: first_name,
        last_name: last_name,
      },
    };

    try {
      bcUserRequest = await axios(bcCreateUseOptions);
    } catch (e) {
      console.log(e.response);
      throw new functions.https.HttpsError(
        "internal",
        "Could not create BigCommerce account"
      );
    }

    try {
      await admin.firestore().collection("Users").doc(uid).set(
        {
          bcUserId: bcUserRequest.data.id,
        },
        { merge: true }
      );
    } catch (e) {
      console.log(e.response);
      throw new functions.https.HttpsError(
        "internal",
        "Could not save details to user's profile"
      );
    }

    return {
      message: "Successfully added user",
    };
  }
);
