const functions = require("firebase-functions");
const axios = require("axios");

exports.removeItem = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const { cartId, itemId } = data;

  const bcRemoveItemOptions = {
    url: `${
      functions.config().env.bigCommerce.url
    }/carts/${cartId}/items/${itemId}`,
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": functions.config().env.bigCommerce.clientId,
      "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
    },
  };

  return axios(bcRemoveItemOptions).then((response) => {
    return response.data;
  });
});
