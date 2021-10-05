const functions = require("firebase-functions");
const axios = require("axios");
const { gql } = require("graphql-request");

const GraphQLClient = require("../graphql/client");

const GET_USER_BC_ID = gql`
  query GetUserBCId($userId: String!) {
    Users_by_pk(id: $userId) {
      bc_user_id
    }
  }
`;

exports.createCheckout = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const uid = context.auth.uid;

  return GraphQLClient.request(GET_USER_BC_ID, { userId: uid }).then(
    (response) => {
      if (response.Users_by_pk.bc_user_id) {
        const {
          products,
          first_name: firstName,
          last_name: lastName,
          address,
        } = data;

        const bcCreateCartOptions = {
          url: `${functions.config().env.bigCommerce.url}/carts`,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Auth-Client": functions.config().env.bigCommerce.clientId,
            "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
          },
          data: {
            customer_id: response.Users_by_pk.bc_user_id,
            line_items: products,
          },
        };

        return axios(bcCreateCartOptions).then((response) => {
          const cartId = response.data.data.id;

          // If address exists, return full checkout
          if (address) {
            const consignmentLineItems =
              response.data.data.line_items.physical_items.map((item) => ({
                item_id: item.id,
                quantity: item.quantity,
              }));

            const bcGetShippingOptions = {
              url: `${
                functions.config().env.bigCommerce.url
              }/checkouts/${cartId}/consignments?includes=consignments.available_shipping_options`,
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-Auth-Client": functions.config().env.bigCommerce.clientId,
                "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
              },
              data: [
                {
                  line_items: consignmentLineItems,
                  shipping_address: {
                    first_name: firstName,
                    last_name: lastName,
                    email: context.auth.token.email,
                    address1: address.line1,
                    address2: address.line2,
                    city: address.city,
                    state_or_province_code: address.state_province_region,
                    country_code: address.country,
                    postal_code: address.postal_zip_code,
                  },
                },
              ],
            };

            return axios(bcGetShippingOptions).then((shippingResponse) => {
              const consignmentId =
                shippingResponse.data.data.consignments[0].id;
              const shippingOptionId =
                shippingResponse.data.data.consignments[0]
                  .available_shipping_options[0].id;

              const bcSetShippingOptions = {
                url: `${
                  functions.config().env.bigCommerce.url
                }/checkouts/${cartId}/consignments/${consignmentId}`,
                method: "PUT",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  "X-Auth-Client": functions.config().env.bigCommerce.clientId,
                  "X-Auth-Token":
                    functions.config().env.bigCommerce.accessToken,
                },
                data: {
                  shipping_option_id: shippingOptionId,
                },
              };

              return axios(bcSetShippingOptions).then(() => {
                const bcSetBillingAddress = {
                  url: `${
                    functions.config().env.bigCommerce.url
                  }/checkouts/${cartId}/billing-address`,
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-Auth-Client":
                      functions.config().env.bigCommerce.clientId,
                    "X-Auth-Token":
                      functions.config().env.bigCommerce.accessToken,
                  },
                  data: {
                    first_name: firstName,
                    last_name: lastName,
                    email: context.auth.token.email,
                    address1: address.line1,
                    address2: address.line2,
                    city: address.city,
                    state_or_province_code: address.state_province_region,
                    country_code: address.country,
                    postal_code: address.postal_zip_code,
                  },
                };

                return axios(bcSetBillingAddress).then((response) => {
                  return response.data;
                });
              });
            });
          } else {
            // If no address, return checkout
            const bcGetCheckoutOptions = {
              url: `${
                functions.config().env.bigCommerce.url
              }/checkouts/${cartId}`,
              method: "GET",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-Auth-Client": functions.config().env.bigCommerce.clientId,
                "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
              },
            };

            return axios(bcGetCheckoutOptions).then((response) => {
              return response.data;
            });
          }
        });
      } else {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "User doc does not exist."
        );
      }
    }
  );
});
