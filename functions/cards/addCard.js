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
  if (!response.Users_by_pk.paysafe_user_id) {
    functions.logger.log(new Error(`User Paysafe profile does not exist, user: ${uid}`));
    throw new functions.https.HttpsError(
      "failed-precondition",
      "User Paysafe profile does not exist",
      { ct_error_code: "user_profile_missing" }
    );
  }

  try {
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
    /**
     * Verify card token
     */
    const verify = await axios(psVerifyCardOptions);
    const avs = verify.data.avsResponse;
    const avsCvvError = (avs !== "MATCH" || avs !== "MATCH_ADDRESS_ONLY" || avs !== "MATCH_ZIP_ONLY") && verify.data.cvvVerification !== "MATCH";
    if (avsCvvError) {
      const mismatch = verify.data.cvvVerification === "MATCH" ? "avs_mismatch" : "cvv_mismatch";
      functions.logger.log(new Error(`${mismatch} user: ${uid}`));
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Failed avs/cvv verification",
        { ct_error_code: mismatch }
      );
    }

    GraphQLClient.request(ADD_BILLING_ADDRESS, {
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

    const newCard = await axios(psAddCardOptions);
    return newCard.data;
  } catch (e) {
    if(e.message === "Failed avs/cvv verification" || e.message === "User Paysafe profile does not exist") throw e
    const verifyError = e.config && e.config.url.slice(e.config.url.length - 13, e.config.length) === "verifications";
    functions.logger.log(e, { status: e.response && e.response.status, data: e.response && e.response.data, userId: uid });
    throw new functions.https.HttpsError(
      "failed-precondition",
      verifyError ? "Could not verify card" : "Could not add card",
      { ct_error_code: verifyError ? "could_not_verify_card" : "could_not_add_card" }
    );
  }
});
