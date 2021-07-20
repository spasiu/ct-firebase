const functions = require("firebase-functions");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

exports.addItem = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("invalid-auth", "Must be logged in.");
  }

  const { cartId, products } = data;

  const bcAddItemOptions = {
    url: `${bigCommerceConfig.url}/carts/${cartId}/items`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": bigCommerceConfig.clientId,
      "X-Auth-Token": bigCommerceConfig.accessToken,
    },
    data: { line_items: products },
  };

  return axios(bcAddItemOptions).then((response) => {
    return response.data;
  });
});
