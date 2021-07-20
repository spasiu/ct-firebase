const functions = require("firebase-functions");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

exports.getCheckout = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("invalid-auth", "Must be logged in.");
  }

  const { cartId } = data;

  const bcGetCartOptions = {
    url: `${bigCommerceConfig.url}/checkouts/${cartId}`,
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": bigCommerceConfig.clientId,
      "X-Auth-Token": bigCommerceConfig.accessToken,
    }
  };

  return axios(bcGetCartOptions).then((response) => {
    return response.data;
  });
});
