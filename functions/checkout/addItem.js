const functions = require("firebase-functions");
const axios = require("axios");
const authorize = require("../lib/authorization");

exports.addItem = functions.https.onCall((data, context) => {
  authorize(context);

  const { cartId, products } = data;

  const bcAddItemOptions = {
    url: `${functions.config().env.bigCommerce.url}/carts/${cartId}/items`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": functions.config().env.bigCommerce.clientId,
      "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
    },
    data: { line_items: products },
  };

  return axios(bcAddItemOptions).then((response) => {
    return response.data;
  });
});
