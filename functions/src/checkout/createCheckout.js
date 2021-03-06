const functions = require("firebase-functions");
const axios = require("axios");
const { gql } = require("graphql-request");

const GraphQLClient = require("../services/graphql");
const authorize = require("../services/authorization");

const GET_USER_BC_ID = gql`
  query GetUserBCId($userId: String!) {
    Users_by_pk(id: $userId) {
      bc_user_id
    }
  }
`;
const ERRORS = {
  user_profile_missing: {
    type: "user_profile_missing",
    httpsArgs: [
      "internal",
      "User Bigcommerce profile does not exist",
      { ct_error_code: "user_profile_missing" },
    ],
  },
  invalid_coupon_code: {
    type: "invalid_coupon_code",
    httpsArgs: [
      "failed-precondition",
      "Invalid coupon code.",
      { ct_error_code: "invalid_coupon_code" },
    ],
  },
  could_not_complete_checkout: {
    type: "could_not_complete_checkout",
    httpsArgs: [
      "failed-precondition",
      "Could not complete checkout.",
      { ct_error_code: "could_not_complete_checkout" },
    ],
  },
};
exports.createCheckout = functions.https.onCall(async (data, context) => {
  authorize(context);

  const uid = context.auth.uid;

  const bcUser = await GraphQLClient.request(GET_USER_BC_ID, { userId: uid });
  if (!bcUser.Users_by_pk.bc_user_id) throw new Error(ERRORS.user_profile_missing.type)
  const {
    products,
    first_name: firstName,
    last_name: lastName,
    address,
    coupon,
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
      customer_id: bcUser.Users_by_pk.bc_user_id,
      line_items: products,
    },
  };

  try {
    const bcCreateCart = await axios(bcCreateCartOptions);
    const cartId = bcCreateCart.data.data.id;

    if (coupon) {
      const bcSetCouponOptions = {
        url: `${
          functions.config().env.bigCommerce.url
        }/checkouts/${cartId}/coupons`,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Auth-Client": functions.config().env.bigCommerce.clientId,
          "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
        },
        data: { coupon_code: coupon },
      };
      await axios(bcSetCouponOptions);
    }

    // If address exists, return full checkout
    if (address) {
      const consignmentLineItems =
        bcCreateCart.data.data.line_items.physical_items.map((item) => ({
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

      const shippingResponse = await axios(bcGetShippingOptions);
      const consignmentId = shippingResponse.data.data.consignments[0].id;
      const shippingOptionId =
        shippingResponse.data.data.consignments[0].available_shipping_options[0]
          .id;

      const bcSetShippingOptions = {
        url: `${
          functions.config().env.bigCommerce.url
        }/checkouts/${cartId}/consignments/${consignmentId}`,
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Auth-Client": functions.config().env.bigCommerce.clientId,
          "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
        },
        data: {
          shipping_option_id: shippingOptionId,
        },
      };

      await axios(bcSetShippingOptions);
      const bcSetBillingAddress = {
        url: `${
          functions.config().env.bigCommerce.url
        }/checkouts/${cartId}/billing-address`,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Auth-Client": functions.config().env.bigCommerce.clientId,
          "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
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

      const bcBillingAddress = await axios(bcSetBillingAddress);
      return bcBillingAddress.data;
    } else {
      // If no address, return checkout
      const bcGetCheckoutOptions = {
        url: `${functions.config().env.bigCommerce.url}/checkouts/${cartId}`,
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Auth-Client": functions.config().env.bigCommerce.clientId,
          "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
        },
      };
      const bcCheckout = await axios(bcGetCheckoutOptions);
      return bcCheckout.data;
    }
  } catch (e) {
    const error =
      ERRORS[e.message] ||
      (e.config && e.config.url.indexOf("coupons") > -1
        ? ERRORS.invalid_coupon_code
        : ERRORS.could_not_complete_checkout);
    functions.logger.log(e, {
      status: e.response && e.response.status,
      data: e.response && e.response.data,
      userId: uid,
    });
    throw new functions.https.HttpsError(...error.httpsArgs);
  }
});
