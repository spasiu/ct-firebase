const functions = require("firebase-functions");
const axios = require("axios");

exports.getCheckout = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const { cartId } = data;

  const bcGetCartOptions = {
    url: `${functions.config().env.bigCommerce.url}/checkouts/${cartId}`,
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": functions.config().env.bigCommerce.clientId,
      "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
    },
  };

  return axios(bcGetCartOptions).then((response) => {
    return response.data;
  });
});
