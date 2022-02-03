const functions = require("firebase-functions");
const axios = require("axios");

const { gql } = require("graphql-request");

const GraphQLClient = require("../lib/graphql");
const authorize = require("../lib/authorization");

const GET_USER_PAYSAFE_ID = gql`
  query GetUserPaysafeId($userId: String!) {
    Users_by_pk(id: $userId) {
      paysafe_user_id
    }
  }
`;
const ERRORS = {
  user_profile_missing: {
    type: "user_profile_missing",
    httpsArgs: [
      "internal",
      "User Paysafe profile does not exist",
      { ct_error_code: "user_profile_missing" },
    ],
  },
  user_card_not_deleted: {
    type: "user_card_not_deleted",
    httpsArgs: [
      "internal",
      "Could not remove card",
      { ct_error_code: "user_card_not_deleted" },
    ],
  },
};
exports.removeCard = functions.https.onCall(async (data, context) => {
  authorize(context);

  const uid = context.auth.uid;

  const { cardId } = data;
  try {
    /**
     * Get user doc
     */
    const response = await GraphQLClient.request(GET_USER_PAYSAFE_ID, {
      userId: uid,
    });
    if (!response.Users_by_pk.paysafe_user_id) {
      throw new Error(ERRORS.user_profile_missing.type);
    }
    /**
     * Remove card
     */
    const psRemoveCardOptions = {
      url: `${functions.config().env.paysafe.url}/customervault/v1/profiles/${
        response.Users_by_pk.paysafe_user_id
      }/cards/${cardId}`,
      method: "DELETE",
      headers: {
        Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
        "Content-Type": "application/json",
      },
    };
    const card = await axios(psRemoveCardOptions);
    return card.data;
  } catch (e) {
    const error = ERRORS[e.message] || ERRORS.user_card_not_deleted;
    functions.logger.log(e, {
      status: e.response && e.response.status,
      data: e.response && e.response.data,
      userId: uid,
    });
    throw new functions.https.HttpsError(...error.httpsArgs);
  }
});
