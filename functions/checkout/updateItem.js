const functions = require("firebase-functions");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

exports.updateItem = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("invalid-auth", "Must be logged in.");
  }

  const { cartId, itemId, item } = data;

  const bcUpdateItemOptions = {
    url: `${bigCommerceConfig.url}/carts/${cartId}/items/${itemId}`,
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": bigCommerceConfig.clientId,
      "X-Auth-Token": bigCommerceConfig.accessToken,
    },
    data: { line_item: item },
  };

  return axios(bcUpdateItemOptions).then((response) => {
    return response.data;
  });
});
