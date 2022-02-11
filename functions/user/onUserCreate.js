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
  try {
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

    const profileRequest = await axios(psCreateProfileOptions);

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
    await admin.firestore().collection("Users").doc(uid).set(
      {
        paysafeProfileId: profileRequest.data.id,
        intercomIOS: hmacIOSHash,
        intercomAndroid: hmacAndroidHash,
        refreshToken: admin.database.ServerValue.TIMESTAMP,
      },
      { merge: true }
    );

    /**
     * Creater user in Hasura
     */
    await GraphQLClient.request(INSERT_HASURA_USER, {
      userId: uid,
      email,
      role: APPROVED_ADMINS.includes(email) ? "ADMIN" : "USER",
      paysafeId: profileRequest.data.id,
    });

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
    await admin.auth().setCustomUserClaims(uid, customClaims);
    return { message: "Successfully added user" };
  } catch (e) {
    functions.logger.log(e, {
      status: e.response && e.response.status,
      data: e.response && e.response.data,
      userId: uid,
    });
    throw new functions.https.HttpsError("internal", "Could not create user", {
      ct_error_code: "could_not_create_user",
    });
  }
});
