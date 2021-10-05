const functions = require("firebase-functions");
const axios = require("axios");

const { gql } = require("graphql-request");

const GraphQLClient = require("../graphql/client");

const GET_USER_PAYSAFE_ID = gql`
  query GetUserPaysafeId($userId: String!) {
    Users_by_pk(id: $userId) {
      paysafe_user_id
    }
  }
`;

exports.removeCard = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const uid = context.auth.uid;

  const { cardId } = data;

  /**
   * Get user doc
   */
  return GraphQLClient.request(GET_USER_PAYSAFE_ID, { userId: uid }).then(
    (response) => {
      if (response.Users_by_pk.paysafe_user_id) {
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
            functions.logger.log(e.response);
            throw new functions.https.HttpsError(
              "internal",
              "Could not remove card"
            );
          });
      } else {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "User profile does not exist"
        );
      }
    }
  );
});
