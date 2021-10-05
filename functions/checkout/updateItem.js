const functions = require("firebase-functions");
const axios = require("axios");

exports.updateItem = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const { cartId, itemId, item } = data;

  const bcUpdateItemOptions = {
    url: `${
      functions.config().env.bigCommerce.url
    }/carts/${cartId}/items/${itemId}`,
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": functions.config().env.bigCommerce.clientId,
      "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
    },
    data: { line_item: item },
  };

  return axios(bcUpdateItemOptions).then((response) => {
    return response.data;
  });
});
