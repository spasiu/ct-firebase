const functions = require("firebase-functions");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

// TODO: Move BC config to env vars

const ADD_BREAK_PRODUCT_ITEMS = `
  mutation AddBreakProductItems($products: [BreakProductItems_insert_input!]!) {
    insert_BreakProductItems(objects: $products) {
      affected_rows
    }
  }
`;

exports.createBreakProducts = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("invalid-auth", "Must be logged in.");
  }

  let bigCommerceProduct;

  if (
    data.break_type === "RANDOM_TEAM" ||
    data.break_type === "RANDOM_DIVISION"
  ) {
    bigCommerceProduct = {
      name: `${data.title} - ${data.id}`,
      price: Number(data.price.replace(/[^0-9.-]+/g, "")),
      weight: 1,
      type: "physical",
      inventory_tracking: "product",
      inventory_level: data.spots,
      availability: "available",
    };

    const bcRequestOptions = {
      url: `${bigCommerceConfig.url}/catalog/products`,
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Auth-Client": bigCommerceConfig.clientId,
        "X-Auth-Token": bigCommerceConfig.accessToken,
      },
      data: bigCommerceProduct,
    };

    return axios(bcRequestOptions).then((response) => {
      const products = [
        {
          title: data.title,
          quantity: data.spots,
          break_id: data.id,
          price: Number(data.price.replace(/[^0-9.-]+/g, "")),
          external_id: response.data.data.id,
        },
      ];

      const ctRequestOptions = {
        url: "https://ct-admin-dev.hasura.app/v1/graphql",
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        data: {
          query: ADD_BREAK_PRODUCT_ITEMS,
          variables: {
            products,
          },
        },
      };

      return axios(ctRequestOptions).then((ctResponse) => {
        return ctResponse.data;
      });
    });
  } else {
    return "Pending";
  }
});
