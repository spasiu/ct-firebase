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

exports.removeCard = functions.https.onCall((data, context) => {
  authorize(context);

  const uid = context.auth.uid;

  const { cardId } = data;

  /**
   * Get user doc
   */
  return GraphQLClient.request(GET_USER_PAYSAFE_ID, { userId: uid }).then(
    (response) => {
      if (!response.Users_by_pk.paysafe_user_id) {
        functions.logger.log(new Error(`User Paysafe profile does not exist, user: ${uid}`));
        throw new functions.https.HttpsError(
          "failed-precondition",
          "User Paysafe profile does not exist",
          { ct_error_code: "user_profile_missing" }
        );
      }
        /**
         * Remove card
         */
        const psRemoveCardOptions = {
          url: `${
            functions.config().env.paysafe.url
          }/customervault/v1/profiles/${
            response.Users_by_pk.paysafe_user_id
          }/cards/${cardId}`,
          method: "DELETE",
          headers: {
            Authorization: `Basic ${
              functions.config().env.paysafe.serverToken
            }`,
            "Content-Type": "application/json",
          },
        };

        return axios(psRemoveCardOptions)
          .then((card) => {
            return card.data;
          })
          .catch((e) => {
            if(e.message === "User Paysafe profile does not exist") throw e
            functions.logger.log(e, { status: e.response && e.response.status, data: e.response && e.response.data, userId: uid });
            throw new functions.https.HttpsError(
              "internal",
              "Could not remove card",
              { ct_error_code: "user_card_not_deleted" }
            );
          });
    }
  );
});
