const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { gql } = require("graphql-request");

const GraphQLClient = require("../lib/graphql");
const authorize = require("../lib/authorization");

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
    authorize(context);

    const { first_name, last_name } = data;

    const uid = context.auth.uid;
    const email = context.auth.token.email;

    try {
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

      const bcUserRequest = await axios(bcCreateUseOptions);

      await admin
        .firestore()
        .collection("Users")
        .doc(uid)
        .set({ bcUserId: bcUserRequest.data.id }, { merge: true });

      await GraphQLClient.request(UPDATE_BC_ID, {
        userId: uid,
        bcId: bcUserRequest.data.id,
      });

      return { message: "Successfully added user" };
    } catch (e) {
      functions.logger.log(e, {
        status: e.response && e.response.status,
        data: e.response && e.response.data,
        userId: uid,
      });
      throw new functions.https.HttpsError(
        "internal",
        "Could not create BigCommerce account",
        { ct_error_code: "could_not_create_user" }
      );
    }
  }
);
