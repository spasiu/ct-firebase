const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");
const { gql } = require("graphql-request");

const GraphQLClient = require("../lib/graphql");
const APPROVED_ADMINS = require("../config/admins");

const INSERT_HASURA_USER = gql`
  mutation InsertHasuraUser(
    $userId: String!
    $email: String!
    $role: user_role_enum!
    $paysafeId: String!
  ) {
    insert_Users_one(
      object: {
        id: $userId
        email: $email
        role: $role
        paysafe_user_id: $paysafeId
      }
    ) {
      id
    }
  }
`;

exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const email = user.email;

  let profileRequest;

  /**
   * Setup custom claims
   */
  let customClaims = {
    "https://hasura.io/jwt/claims": {
      "x-hasura-default-role": "user",
      "x-hasura-allowed-roles": ["user"],
      "x-hasura-user-id": uid,
    },
  };

  if (APPROVED_ADMINS.includes(email)) {
    customClaims = {
      "https://hasura.io/jwt/claims": {
        "x-hasura-default-role": "admin",
        "x-hasura-allowed-roles": ["user", "manager", "admin"],
        "x-hasura-user-id": uid,
      },
    };
  }

  // Set claims
  try {
    await admin.auth().setCustomUserClaims(uid, customClaims);
  } catch (e) {
    functions.logger.log(e);
    throw new functions.https.HttpsError(
      "internal",
      "Could not update user claims"
    );
  }

  /**
   * Create Paysafe profile for user
   */
  const psCreateProfileOptions = {
    url: `${functions.config().env.paysafe.url}/customervault/v1/profiles`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
    },
    data: { merchantCustomerId: `${uid}-${Date.now()}`, locale: "en_US" },
  };

  try {
    profileRequest = await axios(psCreateProfileOptions);
  } catch (e) {
    functions.logger.log(e.response.data);
    throw new functions.https.HttpsError(
      "internal",
      "Could not create paysafe profile",
      e.response.data
    );
  }

  /**
   * Create user verification for Intercom
   */
  const hmacIOS = crypto.createHmac(
    "sha256",
    functions.config().env.intercom.IOSSecret
  );
  hmacIOS.update(uid);
  const hmacIOSHash = hmacIOS.digest("hex");

  const hmacAndroid = crypto.createHmac(
    "sha256",
    functions.config().env.intercom.AndroidSecret
  );
  hmacAndroid.update(uid);
  const hmacAndroidHash = hmacAndroid.digest("hex");

  /**
   * Add Paysafe profile and Intercom verification to user doc
   */
  try {
    await admin.firestore().collection("Users").doc(uid).set(
      {
        paysafeProfileId: profileRequest.data.id,
        intercomIOS: hmacIOSHash,
        intercomAndroid: hmacAndroidHash,
        refreshToken: admin.database.ServerValue.TIMESTAMP,
      },
      { merge: true }
    );
  } catch (e) {
    functions.logger.log(e);
    throw new functions.https.HttpsError(
      "internal",
      "Could not save details to user's profile"
    );
  }

  /**
   * Creater user in Hasura
   */
  try {
    await GraphQLClient.request(INSERT_HASURA_USER, {
      userId: uid,
      email,
      role: APPROVED_ADMINS.includes(email) ? "ADMIN" : "USER",
      paysafeId: profileRequest.data.id,
    });
  } catch (e) {
    functions.logger.log(e);
    throw new functions.https.HttpsError(
      "internal",
      "Could not create user in our database",
      e
    );
  }

  return {
    message: "Successfully added user",
  };
});
