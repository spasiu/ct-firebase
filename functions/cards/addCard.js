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

const ERRORS = {
  user_profile_missing: {
    type: "user_profile_missing",
    httpsArgs: [
      "internal",
      "User Paysafe profile does not exist",
      { ct_error_code: "user_profile_missing" },
    ],
  },
  avs_mismatch: {
    type: "avs_mismatch",
    httpsArgs: [
      "failed-precondition",
      "Failed avs verification",
      { ct_error_code: "avs_mismatch" },
    ],
  },
  cvv_mismatch: {
    type: "cvv_mismatch",
    httpsArgs: [
      "failed-precondition",
      "Failed cvv verification",
      { ct_error_code: "cvv_mismatch" },
    ],
  },
  could_not_verify_card: {
    type: "could_not_verify_card",
    httpsArgs: [
      "failed-precondition",
      "Could not verify card",
      { ct_error_code: "could_not_verify_card" },
    ],
  },
  could_not_add_card: {
    type: "could_not_add_card",
    httpsArgs: [
      "failed-precondition",
      "Could not add card",
      { ct_error_code: "could_not_add_card" },
    ],
  },
};

exports.addCard = functions.https.onCall(async (data, context) => {
  authorize(context);

  const uid = context.auth.uid;

  const { singleUseToken } = data;

  try {
    /**
     * Get user doc
     */
    const response = await GraphQLClient.request(GET_USER_PAYSAFE_ID, {
      userId: uid,
    });
    if (!response.Users_by_pk.paysafe_user_id) throw new Error(ERRORS.user_profile_missing.type)

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
    /**
     * Verify card token
     */
    const verify = await axios(psVerifyCardOptions);
    const avs = verify.data.avsResponse;
    const avsCvvError =
      avs === "NO_MATCH" ||
      avs === "NOT_PROCESSED" ||
      avs === "UNKNOWN" ||
      verify.data.cvvVerification !== "MATCH";
    if (avsCvvError) {
      const mismatch =
        verify.data.cvvVerification === "MATCH"
          ? "avs_mismatch"
          : "cvv_mismatch";
      throw new Error(ERRORS[mismatch].type);
    }
    /**
     * Add billing address to user Addresses
     */
    if (
      verify.data.billingDetails.country === "US" ||
      verify.data.billingDetails.country === "CA"
    ) {
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
      }).catch((e) =>
        functions.logger.log(e, {
          status: e.response && e.response.status,
          data: e.response && e.response.data,
          userId: uid,
          cause: "Unable to add billing address to user",
        })
      );
    }

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
    const newCard = await axios(psAddCardOptions);
    return newCard.data;
  } catch (e) {
    const error =
      ERRORS[e.message] ||
      (e.config && e.config.url.indexOf("verifications") > -1
        ? ERRORS.could_not_verify_card
        : ERRORS.could_not_add_card);
    functions.logger.log(e, {
      status: e.response && e.response.status,
      data: e.response && e.response.data,
      userId: uid,
    });
    throw new functions.https.HttpsError(...error.httpsArgs);
  }
});
