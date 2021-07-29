const functions = require("firebase-functions");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const bigCommerceConfig = require("../config/bigCommerce");
const hasuraConfig = require("../config/hasura");
const paysafeConfig = require("../config/paysafe");

const GET_BREAK_PRODUCT_ITEMS_FOR_ORDER = `
  query GetBreakProductItemsForOrder($lineItems: [BreakProductItems_bool_exp!]) {
    BreakProductItems(where: {
      _or: $lineItems
    }) {
      id
    }
  }
`;

const INSERT_ORDER_AND_UPDATE_BREAK_PRODUCTS = `
  mutation UpdateBreakProductItemsWithOrderId(
    $orderId: uuid!
    $orderObject: Orders_insert_input!
    $breakLineItems: [BreakProductItems_bool_exp!]
  ) {
    insert_Orders_one(object: $orderObject) {
      id
      bc_order_id
      discount_total
      grand_total
      subtotal
      tax_total
      shipping_total
    }

    update_BreakProductItems(
      where: { _or: $breakLineItems }
      _set: { order_id: $orderId, quantity: 0 }
    ) {
      returning {
        id
      }
    }
  }
`;

exports.createOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const { cartId, paymentToken } = data;
  const uid = context.auth.uid;
  const orderId = uuidv4();

  let bcCheckoutRequest,
    bcCreateOrderRequest,
    ctProductItemsRequest,
    bcOrderId;
    
  /**
   * Get User's cart
   */
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

  try {
    bcCheckoutRequest = await axios(bcGetCheckoutOptions);
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not get checkout from BigCommerce"
    );
  }

  const bcCartData = bcCheckoutRequest.data.data;
  const bcCartItems = bcCartData.cart.line_items.physical_items;

  // Generate query input to get BreakProductItems in our database
  const breakQueryProductInput = bcCartItems.map((item) => ({
    bc_product_id: { _eq: item.product_id },
    bc_variant_id: { _eq: item.variant_id },
  }));

  /**
   * Get break product line items from our database
   */
  const ctProductItemsQueryOptions = {
    url: hasuraConfig.url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    data: {
      query: GET_BREAK_PRODUCT_ITEMS_FOR_ORDER,
      variables: {
        lineItems: breakQueryProductInput,
      },
    },
  };

  try {
    ctProductItemsRequest = await axios(ctProductItemsQueryOptions);
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not get items from Cards & Treasure database"
    );
  }

  const ctBreakProductItems = ctProductItemsRequest.data.data.BreakProductItems;

  // Ensure number of break product items available in our databae matches length of BC line items
  if (ctBreakProductItems.length !== breakQueryProductInput.length) {
    throw new functions.https.HttpsError(
      "internal",
      "Checkout items do not match available break items"
    );
  }

  /**
   * Process payment
   */
  const psMakePaymentOptions = {
    url: `${paysafeConfig.url}/cardpayments/v1/accounts/${paysafeConfig.accountId}/auths`,
    method: "POST",
    headers: {
      Authorization: `Basic ${paysafeConfig.serverToken}`,
      "Content-Type": "application/json",
    },
    data: {
      card: {
        paymentToken: paymentToken,
      },
      merchantRefNum: orderId,
      amount: bcCartData.grand_total.toFixed(2).replace(".", ""),
      settleWithAuth: true,
      storedCredential: {
        type: "RECURRING",
        occurrence: "SUBSEQUENT",
      },
      merchantDescriptor: {
        dynamicDescriptor: "Cards&Treasure",
      },
    },
  };

  try {
    axios(psMakePaymentOptions);
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not complete PaySafe payment"
    );
  }

  /**
   * Create BC order
   */
  const bcCreateOrderOptions = {
    url: `${bigCommerceConfig.url}/checkouts/${cartId}/orders`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": bigCommerceConfig.clientId,
      "X-Auth-Token": bigCommerceConfig.accessToken,
    },
  };

  try {
    bcCreateOrderRequest = await axios(bcCreateOrderOptions);
    bcOrderId = bcCreateOrderRequest.data.data.id;
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not create BigCommerce order"
    );
  }

  /**
   * Update BC order and set payment to external, and status to pending
   */
  const bcUpdateOrderToPendingOptions = {
    url: `${bigCommerceConfig.urlV2}/orders/${bcOrderId}`,
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": bigCommerceConfig.clientId,
      "X-Auth-Token": bigCommerceConfig.accessToken,
    },
    data: {
      payment_method: "Cards & Treasure App",
      status_id: 11,
    },
  };

  try {
    await axios(bcUpdateOrderToPendingOptions);
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not update BigCommerce payment method and status"
    );
  }

  /**
   * Create Hasura Order
   */
  const ctCreateOrderOptions = {
    url: hasuraConfig.url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    data: {
      query: INSERT_ORDER_AND_UPDATE_BREAK_PRODUCTS,
      variables: {
        orderId: orderId,
        breakLineItems: breakQueryProductInput,
        orderObject: {
          id: orderId,
          user_id: uid,
          bc_order_id: bcOrderId,
          subtotal: bcCartData.subtotal_ex_tax,
          discount_total: 0,
          tax_total: bcCartData.tax_total,
          grand_total: bcCartData.grand_total,
          shipping_total: bcCartData.shipping_cost_total_ex_tax,
        },
      },
    },
  };

  try {
    await axios(ctCreateOrderOptions);
  } catch (e) {
    console.log(e.response);
    throw new functions.https.HttpsError(
      "internal",
      "Could not create order in our database"
    );
  }

  return {
    message: "Order created",
  };
});
