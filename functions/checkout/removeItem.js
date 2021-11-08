const functions = require("firebase-functions");
const axios = require("axios");
const authorize = require("../lib/authorization");

exports.removeItem = functions.https.onCall((data, context) => {
  authorize(context);

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
