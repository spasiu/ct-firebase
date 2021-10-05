const functions = require("firebase-functions");
const axios = require("axios");

// TODO: Move BC config to env vars
// TODO: Verify admin/manager/breaker

const ADD_BREAK_PRODUCT_ITEMS = `
  mutation AddBreakProductItems($products: [BreakProductItems_insert_input!]!) {
    insert_BreakProductItems(objects: $products) {
      affected_rows
    }
  }
`;

exports.createBreakProducts = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const { breakData, lineItems } = data;

  let bigCommerceProduct;

  const hasLineItems =
    breakData.break_type === "PICK_YOUR_TEAM" ||
    breakData.break_type === "PICK_YOUR_DIVISION"
      ? true
      : false;

  let variants = [];

  for (let i = 0; i < breakData.spots; i++) {
    variants.push({
      sku: `${breakData.id}-SPOT-${i + 1}`,
      inventory_level: 1,
      price: hasLineItems ? lineItems[i].cost : breakData.price,
      option_values: [
        {
          option_display_name: "Spot",
          label: hasLineItems ? lineItems[i].value : `Spot ${i + 1}`,
        },
      ],
    });
  }

  bigCommerceProduct = {
    name: `${breakData.title} - ${breakData.id}`,
    price: 0,
    weight: 1,
    type: "physical",
    inventory_tracking: "variant",
    availability: "available",
    variants,
  };

  const bcRequestOptions = {
    url: `${functions.config().env.bigCommerce.url}/catalog/products`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": functions.config().env.bigCommerce.clientId,
      "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
    },
    data: bigCommerceProduct,
  };

  return axios(bcRequestOptions).then((response) => {
    const products = response.data.data.variants.map((variant, idx) => ({
      title: hasLineItems ? lineItems[idx].value : `Spot ${idx + 1}`,
      quantity: 1,
      break_id: breakData.id,
      price: hasLineItems ? variant.price : breakData.price,
      bc_product_id: variant.product_id,
      bc_variant_id: variant.id,
    }));

    const ctRequestOptions = {
      url: functions.config().env.hasura.url,
      method: "POST",
      headers: {
        Accept: "application/json",
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
});
