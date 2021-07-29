const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const paysafeConfig = require("../config/paysafe");
const hasuraConfig = require("../config/hasura");

const INSERT_HASURA_USER = `
  mutation InsertHasuraUser($userId: String!, $email: String!) {
    insert_Users_one(object: {
      id: $userId,
      email: $email
    }) {
      id
    }
  }
`;

exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const email = user.email;

  let profileRequest;

  /**
   * Create Paysafe profile for user
   */
  const psCreateProfileOptions = {
    url: `${paysafeConfig.url}/customervault/v1/profiles`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${paysafeConfig.serverToken}`,
    },
    data: { merchantCustomerId: `${uid}-${Date.now()}`, locale: "en_US" },
  };

  try {
    profileRequest = await axios(psCreateProfileOptions);
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not create paysafe profile"
    );
  }

  /**
   * Add Paysafe profile to user doc
   */
  try {
    await admin.firestore().collection("Users").doc(uid).set(
      {
        paysafeProfileId: profileRequest.data.id,
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

  /**
   * Creater user in Hasura
   */
  const ctInsertHasuraUserOptions = {
    url: hasuraConfig.url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    data: {
      query: INSERT_HASURA_USER,
      variables: {
        userId: uid,
        email
      },
    },
  };

  try {
    await axios(ctInsertHasuraUserOptions);
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not create user in our database"
    );
  }

  return {
    message: "Successfully added user",
  };
});
