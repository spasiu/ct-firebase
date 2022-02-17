const functions = require("firebase-functions");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { gql } = require("graphql-request");
const GraphQLClient = require("../lib/graphql");
const authorize = require("../lib/authorization");

const GET_BREAK_PRODUCT_ITEMS_FOR_ORDER = gql`
  query GetBreakProductItemsForOrder(
    $lineItems: [BreakProductItems_bool_exp!]
  ) {
    BreakProductItems(where: { _or: $lineItems }) {
      id
      break_id
      order_id
      Break {
        status
        event_id
      }
    }
  }
`;

const INSERT_ORDER_IN_PROCESS = gql`
  mutation InsertProcessingEntry($objects: [order_in_process_insert_input!]!) {
    insert_order_in_process(objects: $objects) {
      returning {
        product_id
      }
    }
  }
`;

const CHECK_FOR_ORDER_IN_PROCESS = gql`
  query CheckForFailedOrder($productIds: [uuid!]!) {
    order_in_process(where: { product_id: { _in: $productIds } }) {
      product_id
    }
  }
`;

const UNDO_ITEM_RESERVATION = gql`
  mutation UndoBreakProductItemReservation($itemIds: [uuid!]!) {
    update_BreakProductItems(
      where: {
        _and: [{ id: { _in: $itemIds } }, { order_id: { _is_null: true } }]
      }
      _set: { quantity: 1 }
    ) {
      affected_rows
    }
    delete_order_in_process(where: { product_id: { _in: $itemIds } }) {
      affected_rows
    }
  }
`;

const INSERT_ORDER_AND_UPDATE_BREAK_PRODUCTS = gql`
  mutation UpdateBreakProductItemsWithOrderId(
    $orderId: uuid!
    $orderObject: Orders_insert_input!
    $breakLineItems: [BreakProductItems_bool_exp!]
  ) {
    insert_Orders_one(object: $orderObject) {
      id
      bc_order_id
      payment_id
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

const SAVE_PURCHASED_BREAKS_AND_EVENTS = gql`
  mutation SavePurchasedBreaks(
    $breakObjects: [SaveBreak_insert_input!]!
    $eventObjects: [SaveEvent_insert_input!]!
  ) {
    insert_SaveBreak(objects: $breakObjects) {
      returning {
        user_id
        break_id
      }
    }
    insert_SaveEvent(objects: $eventObjects) {
      returning {
        user_id
        event_id
      }
    }
  }
`;

const CLEAR_ORDERS_IN_PROCESS = gql`
  mutation clearProcessing {
    delete_order_in_process(
      where: { BreakProductItems: { order_id: { _is_null: false } } }
    ) {
      affected_rows
    }
  }
`;

const ERRORS = {
  could_not_get_ct_items: {
    type: "could_not_get_ct_items",
    httpsArgs: [
      "failed-precondition",
      "Could not get items from Cards & Treasure database.",
      { ct_error_code: "could_not_complete_order" },
    ],
  },
  could_not_get_bc_checkout: {
    type: "could_not_get_bc_checkout",
    httpsArgs: [
      "failed-precondition",
      "Could not get checkout from BigCommerce.",
      { ct_error_code: "could_not_complete_order" },
    ],
  },
  purchase_no_longer_available: {
    type: "purchase_no_longer_available",
    httpsArgs: [
      "failed-precondition",
      "Spot(s) no longer available.",
      { ct_error_code: "purchase_no_longer_available" },
    ],
  },
  bc_hasura_item_mismatch: {
    type: "bc_hasura_item_mismatch",
    httpsArgs: [
      "Internal",
      "Checkout items do not match available break items",
      { ct_error_code: "could_not_complete_order" },
    ],
  },
  could_not_complete_order: {
    type: "could_not_complete_order",
    httpsArgs: [
      "failed-precondition",
      "Could not complete order.",
      { ct_error_code: "could_not_complete_order" },
    ],
  },
  could_not_complete_paysafe_payment: {
    type: "could_not_complete_paysafe_payment",
    httpsArgs: [
      "failed-precondition",
      "Could not complete PaySafe payment.",
      { ct_error_code: "could_not_complete_paysafe_payment" },
    ],
  },
  could_not_complete_paysafe_auth: {
    type: "could_not_complete_paysafe_auth",
    httpsArgs: [
      "failed-precondition",
      "Payment declined, insufficient funds.",
      { ct_error_code: "could_not_complete_paysafe_auth" },
    ],
  },
  could_not_update_bc_payment: {
    type: "could_not_update_bc_payment",
    httpsArgs: [
      "failed-precondition",
      "Could not update BigCommerce payment method and status.",
      { ct_error_code: "could_not_complete_order" },
    ],
  },
  could_not_create_bc_order: {
    type: "could_not_create_bc_order",
    httpsArgs: [
      "failed-precondition",
      "Could not create BigCommerce order.",
      { ct_error_code: "could_not_complete_order" },
    ],
  },
  could_not_create_hasura_order: {
    type: "could_not_create_hasura_order",
    httpsArgs: [
      "failed-precondition",
      "Could not create order in our database.",
      { ct_error_code: "could_not_complete_order" },
    ],
  },
};

const rollback = async (ctProductItemsRequest, userId, payment) => {
  try {
    if (payment) {
      const psVoidAuthOptions = {
        url: `${functions.config().env.paysafe.url}/cardpayments/v1/accounts/${
          functions.config().env.paysafe.accountId
        }/auths/${payment.id}/voidauths`,
        method: "POST",
        headers: {
          Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
          "Content-Type": "application/json",
        },
        data: {
          merchantRefNum: uuidv4(),
          amount: payment.amount,
        },
      };
      axios(psVoidAuthOptions);
    }
    GraphQLClient.request(UNDO_ITEM_RESERVATION, {
      itemIds: ctProductItemsRequest.BreakProductItems.map((item) => item.id),
    });
  } catch (e) {
    functions.logger.log(e, "ROLLBACK FAILED", {
      status: e.response && e.response.status,
      data: e.response && e.response.data,
      userId: userId,
      payment: payment,
    });
  }
};

exports.createOrder = functions.https.onCall(async (data, context) => {
  authorize(context);

  const { cartId, paymentToken } = data;
  const uid = context.auth.uid;
  const orderId = uuidv4();
  let paymentData, errorLog, ctProductItemsRequest;

  try {
    /**
     * Get User's cart
     */
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
    const bcCheckoutRequest = await axios(bcGetCheckoutOptions);
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
    ctProductItemsRequest = await GraphQLClient.request(
      GET_BREAK_PRODUCT_ITEMS_FOR_ORDER,
      {
        lineItems: breakQueryProductInput,
      }
    ).catch((e) => {
      errorLog = e;
      throw new Error(ERRORS.could_not_get_ct_items.type);
    });

    /**
     * make sure break is in a sellable state
     * and that item has not already been purchased
     */
    const nUnsellableStatuses = ctProductItemsRequest.BreakProductItems.map(
      (productItem) => productItem.Break.status
    ).filter(
      (breakStatus) =>
        breakStatus === "COMPLETED" ||
        breakStatus === "LIVE" ||
        breakStatus === "SOLDOUT"
    ).length;
    const alreadySold = ctProductItemsRequest.BreakProductItems.filter(
      (item) => item.order_id !== null
    );
    if (nUnsellableStatuses > 0 || alreadySold.length > 0)
      throw new Error(ERRORS.purchase_no_longer_available.type);
    /**
     * prevent duplicate purchases by registering first purchase
     * to orders_in_process db table
     */
    await GraphQLClient.request(INSERT_ORDER_IN_PROCESS, {
      objects: ctProductItemsRequest.BreakProductItems.map((item) => ({
        product_id: item.id,
      })),
    }).catch(async (e) => {
      errorLog = e;
      /**
       * query for failed item(s) and rollback others
       * to prevent them from being erroneously reserved
       */
      const failed = await GraphQLClient.request(CHECK_FOR_ORDER_IN_PROCESS, {
        productIds: ctProductItemsRequest.BreakProductItems.map(
          (item) => item.id
        ),
      });
      // remove failed items from the rollback list
      const failedItemIds = failed.order_in_process.map(
        (item) => item.product_id
      );
      const failedItems = ctProductItemsRequest.BreakProductItems.filter(
        (item) => !failedItemIds.includes(item.id)
      );
      ctProductItemsRequest.BreakProductItems = failedItems;
      throw new Error(ERRORS.purchase_no_longer_available.type);
    });

    // Ensure number of break product items available in our databae matches length of BC line items
    if (
      ctProductItemsRequest.BreakProductItems.length !==
      breakQueryProductInput.length
    ) {
      throw new functions.https.HttpsError(ERRORS.bc_hasura_item_mismatch.type);
    }
    /**
     * Auth payment
     */
    if (bcCartData.grand_total > 0) {
      const psAuthPaymentOptions = {
        url: `${functions.config().env.paysafe.url}/cardpayments/v1/accounts/${
          functions.config().env.paysafe.accountId
        }/auths`,
        method: "POST",
        headers: {
          Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
          "Content-Type": "application/json",
        },
        data: {
          card: {
            paymentToken: paymentToken,
          },
          merchantRefNum: orderId,
          amount: bcCartData.grand_total.toFixed(2).replace(".", ""),
          settleWithAuth: false,
          storedCredential: {
            type: "RECURRING",
            occurrence: "SUBSEQUENT",
          },
          merchantDescriptor: {
            dynamicDescriptor: "Cards&Treasure",
          },
        },
      };
      const auth = await axios(psAuthPaymentOptions);
      paymentData = auth.data;
    }
    /**
     * Create BC order
     */
    const bcCreateOrderOptions = {
      url: `${
        functions.config().env.bigCommerce.url
      }/checkouts/${cartId}/orders`,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Client": functions.config().env.bigCommerce.clientId,
        "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
      },
    };

    const bcCreateOrderRequest = await axios(bcCreateOrderOptions);
    const bcOrderId = bcCreateOrderRequest.data.data.id;

    /**
     * Update BC order and set payment to external, and status to pending
     */
    const bcUpdateOrderToPendingOptions = {
      url: `${functions.config().env.bigCommerce.urlV2}/orders/${bcOrderId}`,
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Client": functions.config().env.bigCommerce.clientId,
        "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
      },
      data: {
        payment_method: "Cards & Treasure App",
        status_id: 11,
      },
    };

    await axios(bcUpdateOrderToPendingOptions);

    /**
     * Process payment
     */
    if (paymentData) {
      const psMakePaymentOptions = {
        url: `${functions.config().env.paysafe.url}/cardpayments/v1/accounts/${
          functions.config().env.paysafe.accountId
        }/auths/${paymentData.id}/settlements`,
        method: "POST",
        headers: {
          Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
          "Content-Type": "application/json",
        },
        data: {
          merchantRefNum: orderId,
        },
      };
      const payment = await axios(psMakePaymentOptions);
      paymentData = payment.data;
    }

    /**
     * Create Hasura Order
     */
    await GraphQLClient.request(INSERT_ORDER_AND_UPDATE_BREAK_PRODUCTS, {
      orderId: orderId,
      breakLineItems: breakQueryProductInput,
      orderObject: {
        id: orderId,
        user_id: uid,
        bc_order_id: bcOrderId,
        payment_id: paymentData.id,
        subtotal: bcCartData.subtotal_ex_tax,
        discount_total: 0,
        tax_total: bcCartData.tax_total,
        grand_total: bcCartData.grand_total,
        shipping_total: bcCartData.shipping_cost_total_ex_tax,
      },
    }).catch((e) => {
      console.log(`REFUND >> user: ${uid}, order: ${orderId}, payment: ${paymentData.id}`)
      errorLog = e;
      throw new Error(ERRORS.could_not_create_hasura_order.type);
    });

    /**
     * Follow purchased breaks and events
     */
    const breakObjects = ctProductItemsRequest.BreakProductItems.map(
      (item) => item.break_id
    )
      // remove dupes
      .filter((breakId, index, breakIds) => breakIds.indexOf(breakId) === index)
      .map((breakId) => ({ break_id: breakId, user_id: uid }));

    const eventObjects = ctProductItemsRequest.BreakProductItems.map(
      (item) => item.Break.event_id
    )
      // remove dupes
      .filter((eventId, index, eventIds) => eventIds.indexOf(eventId) === index)
      .map((eventId) => ({ event_id: eventId, user_id: uid }));

    GraphQLClient.request(SAVE_PURCHASED_BREAKS_AND_EVENTS, {
      breakObjects: breakObjects,
      eventObjects: eventObjects,
    }).catch((e) => functions.logger.log(e));
    /**
     * clear completed orders out of orders_in_process
     *  -- no need to wait for this, as it is semi-passive
     * cleanup and will be redone on the next pass, if
     * needs be
     */
    GraphQLClient.request(CLEAR_ORDERS_IN_PROCESS).catch((e) =>
      functions.logger.log(e, {
        status: e.response && e.response.status,
        data: e.response && e.response.data,
        userId: uid,
      })
    );
    const appsFlyerOrderLog = {
      af_price: bcCartData.grand_total,
      af_order_id: orderId,
    };
    return appsFlyerOrderLog;
  } catch (e) {
    const checkoutError =
      e.config &&
      e.config.url.indexOf("checkouts") > -1 &&
      e.config.url.indexOf("orders") < 0 &&
      ERRORS.could_not_get_bc_checkout;
    const orderError =
      e.config &&
      e.config.url.indexOf("orders") > -1 &&
      e.config.url.indexOf("checkouts") > -1 &&
      ERRORS.could_not_create_bc_order;
    const pendingOrderError =
      e.config &&
      e.config.url.indexOf("orders") > -1 &&
      e.config.url.indexOf("checkouts") < 0 &&
      ERRORS.could_not_update_bc_payment;
    const paymentAuthError =
      e.config &&
      e.config.url.indexOf("cardpayments") > -1 &&
      e.config.url.indexOf("settlements") < 0 &&
      e.response.data.error.code === "3022"
        ? ERRORS.could_not_complete_paysafe_auth
        : ERRORS.could_not_complete_paysafe_payment;
    const paymentError =
      e.config &&
      e.config.url.indexOf("cardpayments") > -1 &&
      e.config.url.indexOf("settlements") > -1 &&
      ERRORS.could_not_complete_paysafe_payment;
    const error =
      ERRORS[e.message] ||
      checkoutError ||
      orderError ||
      pendingOrderError ||
      paymentAuthError ||
      paymentError ||
      ERRORS.could_not_complete_order;
    const log = errorLog || e;
    if (ctProductItemsRequest && ctProductItemsRequest.BreakProductItems)
      rollback(ctProductItemsRequest, uid, paymentData);
    functions.logger.log(log, {
      status: log.response && log.response.status,
      data: log.response && log.response.data,
      userId: uid,
    });
    throw new functions.https.HttpsError(...error.httpsArgs);
  }
});
