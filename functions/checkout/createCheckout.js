const functions = require("firebase-functions");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

exports.createCheckout = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("invalid-auth", "Must be logged in.");
  }

  const {products, first_name, last_name, address} = data;

  const bcCreateCartOptions = {
    url: `${bigCommerceConfig.url}/carts`,
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": bigCommerceConfig.clientId,
      "X-Auth-Token": bigCommerceConfig.accessToken,
    },
    data: {line_items: products},
  };

  return axios(bcCreateCartOptions).then((response) => {
    const cartId = response.data.data.id;

    const consignmentLineItems =
      response.data.data.line_items.physical_items.map((item) => ({
        item_id: item.id,
        quantity: item.quantity,
      }));

    const bcGetShippingOptions = {
      url: `${bigCommerceConfig.url}/checkouts/${cartId}/consignments?includes=consignments.available_shipping_options`,
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Auth-Client": bigCommerceConfig.clientId,
        "X-Auth-Token": bigCommerceConfig.accessToken,
      },
      data: [
        {
          line_items: consignmentLineItems,
          shipping_address: {
            first_name,
            last_name,
            email: context.auth.token.email,
            address1: address.line1,
            address2: address.line2,
            city: address.city,
            state_or_province: address.state_province_region,
            country_code: address.country,
            postal_code: address.postal_code,
          },
        },
      ],
    };

    return axios(bcGetShippingOptions).then((shippingResponse) => {
      const consignmentId = shippingResponse.data.data.consignments[0].id;
      const shippingOptionId =
        shippingResponse.data.data.consignments[0].available_shipping_options[0]
            .id;

      const bcGetShippingOptions = {
        url: `${bigCommerceConfig.url}/checkouts/${cartId}/consignments/${consignmentId}`,
        method: "PUT",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Auth-Client": bigCommerceConfig.clientId,
          "X-Auth-Token": bigCommerceConfig.accessToken,
        },
        data: {
          shipping_option_id: shippingOptionId,
        },
      };

      return axios(bcGetShippingOptions).then((response) => {
        return response.data;
      });
    });
  });
});
