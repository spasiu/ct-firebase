const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { gql } = require("graphql-request");
const GraphQLClient = require("../lib/graphql");
const authorize = require("../lib/authorization");

const UPDATE_USER = gql`
  mutation UpdateUserPermissions($id: String!, $data: Users_set_input!) {
    update_Users_by_pk(pk_columns: { id: $id }, _set: $data) {
      id
    }
  }
`;

exports.userUpdatePermissions = functions.https.onCall(async (data, context) => {
  authorize(context, "admin");

  const { email, setAdmin, setBreaker } = data;

  let userRecord;

  // Get user record
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    throw new functions.https.HttpsError("not-found", "User not found.");
  }

  // Get user ID
  const uid = userRecord.uid;

  // Setup roles
  let defaultRole, allowedRoles;

  if (setAdmin) {
    defaultRole = "admin";
    allowedRoles = ["user", "manager", "admin"];
  } else if (setBreaker) {
    defaultRole = "manager";
    allowedRoles = ["user", "manager"];
  } else {
    defaultRole = "user";
    allowedRoles = ["user"];
  }

  // Setup claims object
  const customClaims = {
    "https://hasura.io/jwt/claims": {
      "x-hasura-default-role": defaultRole,
      "x-hasura-allowed-roles": allowedRoles,
      "x-hasura-user-id": uid,
    },
  };

  // Set claims
  try {
    await admin.auth().setCustomUserClaims(uid, customClaims);
  } catch (e) {
    throw new functions.https.HttpsError(
      "internal",
      "Could not update user claims."
    );
  }

  // Set refresh token time
  try {
    await admin.firestore().collection("Users").doc(uid).set(
      {
        refreshToken: admin.database.ServerValue.TIMESTAMP,
      },
      { merge: true }
    );
  } catch (e) {
    throw new functions.https.HttpsError(
      "internal",
      "Could not update refresh token time."
    );
  }

  // Set role in Hasura
  try {
    await GraphQLClient.request(UPDATE_USER, {
      id: uid,
      data: {
        role: defaultRole.toUpperCase(),
        is_breaker: setBreaker,
      },
    });
    return {
      message: "Successfully updated user.",
    }
  } catch (e) {
    functions.logger.log(e);
    throw new functions.https.HttpsError(
      "internal",
      "Could not update user in our database."
    );
  }
}
);
