const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const bigCommerceConfig = require("../config/bigCommerce");

exports.createCheckout = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const uid = context.auth.uid;

  return admin
    .firestore()
    .collection("Users")
    .doc(uid)
    .get()
    .then((doc) => {
      if (doc.exists) {
        const firestoreUserDoc = doc.data();

        const {
          products,
          first_name: firstName,
          last_name: lastName,
          address,
        } = data;

        const bcCreateCartOptions = {
          url: `${bigCommerceConfig.url}/carts`,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Auth-Client": bigCommerceConfig.clientId,
            "X-Auth-Token": bigCommerceConfig.accessToken,
          },
          data: {
            customer_id: firestoreUserDoc.bcUserId,
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
              url: `${bigCommerceConfig.url}/checkouts/${cartId}/consignments?includes=consignments.available_shipping_options`,
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-Auth-Client": bigCommerceConfig.clientId,
                "X-Auth-Token": bigCommerceConfig.accessToken,
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
                url: `${bigCommerceConfig.url}/checkouts/${cartId}/consignments/${consignmentId}`,
                method: "PUT",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  "X-Auth-Client": bigCommerceConfig.clientId,
                  "X-Auth-Token": bigCommerceConfig.accessToken,
                },
                data: {
                  shipping_option_id: shippingOptionId,
                },
              };

              return axios(bcSetShippingOptions).then(() => {
                const bcSetBillingAddress = {
                  url: `${bigCommerceConfig.url}/checkouts/${cartId}/billing-address`,
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-Auth-Client": bigCommerceConfig.clientId,
                    "X-Auth-Token": bigCommerceConfig.accessToken,
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
              url: `${bigCommerceConfig.url}/checkouts/${cartId}`,
              method: "GET",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-Auth-Client": bigCommerceConfig.clientId,
                "X-Auth-Token": bigCommerceConfig.accessToken,
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
    });
});
