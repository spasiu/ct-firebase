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

exports.addCard = functions.https.onCall(async (data, context) => {
  authorize(context);

  const uid = context.auth.uid;

  const { singleUseToken } = data;

  /**
   * Get user doc
   */
  const response = await GraphQLClient.request(GET_USER_PAYSAFE_ID, { userId: uid })
  if (response.Users_by_pk.paysafe_user_id) {
    /**
     * Verify card token
     */
    const psVerifyCardOptions = {
      url: `${functions.config().env.paysafe.url
        }/cardpayments/v1/accounts/${functions.config().env.paysafe.accountId
        }/verifications`,
      method: "POST",
      headers: {
        Authorization: `Basic ${functions.config().env.paysafe.serverToken
          }`,
        "Content-Type": "application/json",
      },
      data: {
        card: {
          paymentToken: singleUseToken,
        },
        merchantRefNum: `${uid}-addCard-${Date.now()}`,
        storedCredential: {
          type: "RECURRING",
          occurrence: "INITIAL",
        },
      },
    };
    const psAddCardOptions = {
      url: `${functions.config().env.paysafe.url
        }/customervault/v1/profiles/${response.Users_by_pk.paysafe_user_id
        }/cards`,
      method: "POST",
      headers: {
        Authorization: `Basic ${functions.config().env.paysafe.serverToken
          }`,
        "Content-Type": "application/json",
      },
      data: {
        singleUseToken,
        accountId: functions.config().env.paysafe.accountId,
      },
    };
    try {
      /**
        * Add card to vault if verified
      */
      const verify = await axios(psVerifyCardOptions)
      if (verify.data.avsResponse === "MATCH") {
        try {
          return axios(psAddCardOptions).data;
        }
        catch (e) {
          functions.logger.log(e.response);
          throw new functions.https.HttpsError(
            "internal",
            "Could not verify card"
          );
        }
      } else {
        console.log("Error: Bad avs response");
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Failed avs verification"
        )
      }
    }
    catch (e) {
      functions.logger.log(e.response);
      throw new functions.https.HttpsError(
        "internal",
        "Could not verify card"
      );
    }
  } else {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "User profile does not exist"
    );
  }
});
