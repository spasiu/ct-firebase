const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const hasuraConfig = require("../config/hasura");

const UPDATE_USER = `
  mutation UpdateUserPermissions($id: String!, $data: Users_set_input!) {
    update_Users_by_pk(pk_columns: { id: $id }, _set: $data) {
      id
    }
  }
`;

// TODO: Create Mux stream if breaker

exports.userUpdatePermissions = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Must be logged in."
      );
    }

    const hasuraClaims = context.auth.token["https://hasura.io/jwt/claims"];
    const isAdmin = hasuraClaims["x-hasura-default-role"] === "admin";

    const { email, setAdmin, setBreaker } = data;

    let userRecord;

    if (isAdmin) {
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

      // Set role in Hasura
      const ctUpdateUserOptions = {
        url: hasuraConfig.url,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        data: {
          query: UPDATE_USER,
          variables: {
            id: uid,
            data: {
              role: defaultRole.toUpperCase(),
              is_breaker: setBreaker,
            },
          },
        },
      };

      try {
        await axios(ctUpdateUserOptions);

        return {
          message: "Successfully updated user.",
        };
      } catch (e) {
        console.log(e.response);
        throw new functions.https.HttpsError(
          "internal",
          "Could not update user in database."
        );
      }
    } else {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Must be logged in as an administrator."
      );
    }
  }
);
