const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { gql } = require("graphql-request");

const GraphQLClient = require("../lib/graphql");

const UPDATE_BC_ID = gql`
  mutation UpdateBigCommerceId($userId: String!, $bcId: Int!) {
    update_Users_by_pk(
      pk_columns: { id: $userId }
      _set: { bc_user_id: $bcId }
    ) {
      id
    }
  }
`;

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
      url: `${functions.config().env.bigCommerce.urlV2}/customers`,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Client": functions.config().env.bigCommerce.clientId,
        "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
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
      functions.logger.log(e.response);
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
      functions.logger.log(e.response);
      throw new functions.https.HttpsError(
        "internal",
        "Could not save details to user's profile"
      );
    }

    try {
      await GraphQLClient.request(UPDATE_BC_ID, {
        userId: uid,
        bcId: bcUserRequest.data.id,
      });
    } catch (e) {
      functions.logger.log(e);
      throw new functions.https.HttpsError(
        "internal",
        "Could not save details to user's profile in database"
      );
    }

    return {
      message: "Successfully added user",
    };
  }
);
