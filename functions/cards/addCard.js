const functions = require("firebase-functions");
const axios = require("axios");

const { gql } = require("graphql-request");

const GraphQLClient = require("../lib/graphql");
const authorize = require("../lib/authorization");

const GET_USER_PAYSAFE_ID = gql`
  query GetUserPaysafeId($userId: String!) {
    Users_by_pk(id: $userId) {
      paysafe_user_id
      first_name
      last_name
    }
  }
`;

const ADD_BILLING_ADDRESS = gql`
  mutation InsertUserAddress($address: Addresses_insert_input!) {
    insert_Addresses_one(object: $address) {
      id
      first_name
      last_name
      is_default
      line1
      line2
      postal_zip_code
      state_province_region
      city
      country
      User {
        id
      }
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
  const response = await GraphQLClient.request(GET_USER_PAYSAFE_ID, {
    userId: uid,
  });
  if (response.Users_by_pk.paysafe_user_id) {
    const psVerifyCardOptions = {
      url: `${functions.config().env.paysafe.url}/cardpayments/v1/accounts/${
        functions.config().env.paysafe.accountId
      }/verifications`,
      method: "POST",
      headers: {
        Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
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
      url: `${functions.config().env.paysafe.url}/customervault/v1/profiles/${
        response.Users_by_pk.paysafe_user_id
      }/cards`,
      method: "POST",
      headers: {
        Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
        "Content-Type": "application/json",
      },
      data: {
        singleUseToken,
        accountId: functions.config().env.paysafe.accountId,
      },
    };
    try {
      /**
       * Verify card token
       */
      const verify = await axios(psVerifyCardOptions);
      const avs = verify.data.avsResponse;
      if (
      (avs === "MATCH" || avs === "MATCH_ADDRESS_ONLY" || avs === "MATCH_ZIP_ONLY") &&
      verify.data.cvvVerification === "MATCH"
      ) {
        try {
          await GraphQLClient.request(ADD_BILLING_ADDRESS, {
            address: {
              line1: verify.data.billingDetails.street,
              line2: verify.data.billingDetails.street2,
              postal_zip_code: verify.data.billingDetails.zip,
              state_province_region: verify.data.billingDetails.state,
              city: verify.data.billingDetails.city,
              country: verify.data.billingDetails.country,
              first_name: response.Users_by_pk.first_name,
              last_name: response.Users_by_pk.last_name,
              user_id: uid,
            },
          });
        } catch (e) {
          functions.logger.log(new Error(`could not add billing address to user addresses, ${e.response} user: ${uid}`));
        }

        try {
          /**
           * Add card to vault if verified
           */
          const newCard = await axios(psAddCardOptions);
          return newCard.data;
        } catch (e) {
          functions.logger.log(new Error(`${e.response} user: ${uid}`));
          throw new functions.https.HttpsError(
            "internal",
            "Could not add card",
            { ct_error_code: "could_not_add_card" }
          );
        }
      } else {
        const mismatch = verify.data.cvvVerification === "MATCH" ? "avs_mismatch" : "cvv_mismatch"
        functions.logger.log(new Error(`${mismatch} user: ${uid}`));
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Could not add card",
          {
            ct_error_code: mismatch,
          }
        );
      }
    } catch (e) {
      functions.logger.log(new Error(`${e.response} user: ${uid}`));
      throw new functions.https.HttpsError(
        "internal",
        "Could not verify card",
        { ct_error_code: "could_not_verify_card" }
      );
    }
  } else {
    functions.logger.log(new Error(`User Paysafe profile does not exist, user: ${uid}`));
    throw new functions.https.HttpsError(
      "failed-precondition",
      "User Paysafe profile does not exist",
      { ct_error_code: "user_paysafe_profile_does_not_exist" }
    );
  }
});
