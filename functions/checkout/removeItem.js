const functions = require("firebase-functions");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

exports.removeItem = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const { cartId, itemId } = data;

  const bcRemoveItemOptions = {
    url: `${bigCommerceConfig.url}/carts/${cartId}/items/${itemId}`,
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": bigCommerceConfig.clientId,
      "X-Auth-Token": bigCommerceConfig.accessToken,
    }
  };

  return axios(bcRemoveItemOptions).then((response) => {
    return response.data;
  });
});
