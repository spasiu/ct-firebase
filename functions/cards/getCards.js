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
    httpsArgs: ["internal", "User Paysafe profile does not exist", { ct_error_code: "user_profile_missing" }]
  },
  user_cards_not_retreived: {
    type: "user_cards_not_retreived",
    httpsArgs: ["internal", "Could not fetch cards", { ct_error_code: "user_cards_not_retreived" }],
  },
};
exports.getCards = functions.https.onCall(async (data, context) => {
  authorize(context);

  const uid = context.auth.uid;
  try {
    /**
     * Get user doc
     */
    const response = await GraphQLClient.request(GET_USER_PAYSAFE_ID, { userId: uid });
    if (!response.Users_by_pk.paysafe_user_id) {
      throw new Error(ERRORS.user_profile_missing.type)
    }
    /**
     * Get cards
     */
    const psGetCardsOptions = {
      url: `${functions.config().env.paysafe.url}/customervault/v1/profiles/${
        response.Users_by_pk.paysafe_user_id
      }?fields=cards`,
      method: "GET",
      headers: {
        Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
        "Content-Type": "application/json",
      },
    };
    const cards = await axios(psGetCardsOptions);
    return cards.data;
  } catch (e) {
    const error = ERRORS[e.message] || ERRORS.user_cards_not_retreived;
    functions.logger.log(e, { status: e.response && e.response.status, data: e.response && e.response.data, userId: uid});
    throw new functions.https.HttpsError(...error.httpsArgs);
  }
});
