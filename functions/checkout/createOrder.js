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
    order_in_process(
      where: {product_id: {_in: $productIds}}
    ){
      product_id
    }
  }
`

const UNDO_ITEM_RESERVATION = gql`
  mutation UndoBreakProductItemReservation( $itemIds: [uuid!]!) {
    update_BreakProductItems(
      where: { _and: [{id: {_in: $itemIds}}, {order_id: {_is_null: true}}] }
      _inc: { quantity: 1 }
     ) {
      affected_rows
    }
  
    delete_order_in_process(
      where: { product_id: {_in: $itemIds} }
    ){
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
      discount_total
      grand_total
      subtotal
      tax_total
      shipping_total
    }

    update_BreakProductItems(
      where: { _or: $breakLineItems }
      _set: {
        order_id: $orderId,
        quantity: 0
      }
    ) {
      returning {
        id
      }
    }
  }
`;

const SAVE_PURCHASED_BREAKS = gql`
  mutation SavePurchasedBreaks($objects: [SaveBreak_insert_input!]!) {
    insert_SaveBreak(objects: $objects) {
      returning {
        user_id
        break_id
      }
    }
  }
`;

const CLEAR_ORDERS_IN_PROCESS = gql`
  mutation clearProcessing {
      delete_order_in_process(where: {BreakProductItems: {order_id: {_is_null: false}}}){
        affected_rows
      }
    }
`;

const rollbackPurchase = (ctProductItemsRequest) => {
  const itemIds = ctProductItemsRequest.BreakProductItems.map(item => item.id);
  return GraphQLClient.request(UNDO_ITEM_RESERVATION, {
    itemIds: itemIds,
  });
};

exports.createOrder = functions.https.onCall(async (data, context) => {
  authorize(context);

  const { cartId, paymentToken } = data;
  const uid = context.auth.uid;
  const orderId = uuidv4();

  let bcCheckoutRequest, bcCreateOrderRequest, ctProductItemsRequest, bcOrderId;

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

  try {
    bcCheckoutRequest = await axios(bcGetCheckoutOptions);
  } catch (e) {
    functions.logger.log(e.response);

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
  try {
    ctProductItemsRequest = await GraphQLClient.request(
      GET_BREAK_PRODUCT_ITEMS_FOR_ORDER,
      {
        lineItems: breakQueryProductInput,
      }
    );
  } catch (e) {
    functions.logger.log(e);
    throw new functions.https.HttpsError(
      "internal",
      "Could not get items from Cards & Treasure database"
    );
  }

  /**
   * make sure break is in a sellable state
   * and that item has not already been purchased
   */
   const nUnsellableStatuses =
   ctProductItemsRequest.BreakProductItems
     .map((productItem) => productItem.Break.status)
     .filter(
       (breakStatus) =>
         breakStatus === "COMPLETED" ||
         breakStatus === "LIVE" ||
         breakStatus === "SOLDOUT"
     ).length;

  if (nUnsellableStatuses > 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      nUnsellableStatuses > 1
        ? "Spots are no longer available."
        : "Spot is no longer available.",
      { ct_error_code: "purchase_no_longer_available" }
    );
  }

  /**
   * check if any selected items have already been purchased 
   */
  const alreadySold = ctProductItemsRequest.BreakProductItems
    .filter(item => item.order_id !== null);

  if (alreadySold.length > 0 ) {
    rollbackPurchase(ctProductItemsRequest);
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Spot is no longer available.",
      { ct_error_code: "purchase_no_longer_available" }
    );
  }

  /**
   * prevent duplicate purchases by registering first purchase
   * to orders_in_process db table
   */
  try {
    await GraphQLClient.request(INSERT_ORDER_IN_PROCESS, 
      {
        objects: ctProductItemsRequest.BreakProductItems.map(item => ({product_id: item.id}))
      }
    );
  } catch (error) {
    /**
     * query for failed item(s) and rollback others
     * to prevent them from being erroneously reserved
     */
    const failed = await GraphQLClient.request(
      CHECK_FOR_ORDER_IN_PROCESS,
      ctProductItemsRequest.BreakProductItems.map(item => item.id)
    );

    // remove failed items from the rollback list
    const failedItemIds = failed.order_in_process.map(item => item.product_id);
    const failedItems = ctProductItemsRequest.BreakProductItems.filter(item => !failedItemIds.includes(item.id));
    ctProductItemsRequest.BreakProductItems = failedItems;

    rollbackPurchase(ctProductItemsRequest);

    throw new functions.https.HttpsError(
      "failed-precondition",
      `${failedItems} no longer available.`,
      { ct_error_code: "purchase_no_longer_available" }
    );
  }

  /**
   * Verify products exist in cart and in our database
   */
  const ctPurchasedBreaks = ctProductItemsRequest.BreakProductItems.map(
    (_) => _.break_id
  );

  // Ensure number of break product items available in our databae matches length of BC line items
  if (ctPurchasedBreaks.length !== breakQueryProductInput.length) {
    // if not, undo previous reservation
    await rollbackPurchase(ctProductItemsRequest);
    throw new functions.https.HttpsError(
      "internal",
      "Checkout items do not match available break items"
    );
  }

  /**
   * Process payment
   */
  const psMakePaymentOptions = {
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
    await axios(psMakePaymentOptions);
  } catch (e) {
    functions.logger.log(e.response);

    // if payment failed, undo reservation
    await rollbackPurchase(ctProductItemsRequest);

    throw new functions.https.HttpsError(
      "internal",
      "Could not complete PaySafe payment"
    );
  }

  /**
   * Create BC order
   */
  const bcCreateOrderOptions = {
    url: `${functions.config().env.bigCommerce.url}/checkouts/${cartId}/orders`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Client": functions.config().env.bigCommerce.clientId,
      "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
    },
  };

  try {
    bcCreateOrderRequest = await axios(bcCreateOrderOptions);
    bcOrderId = bcCreateOrderRequest.data.data.id;
  } catch (e) {
    functions.logger.log(e.response);

    // if bc order failed, undo reservation
    await rollbackPurchase(ctProductItemsRequest);

    throw new functions.https.HttpsError(
      "internal",
      "Could not create BigCommerce order"
    );
  }

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

  try {
    await axios(bcUpdateOrderToPendingOptions);
  } catch (e) {
    functions.logger.log(e.response);

    // if bc order failed, undo reservation
    await rollbackPurchase(ctProductItemsRequest);

    throw new functions.https.HttpsError(
      "internal",
      "Could not update BigCommerce payment method and status"
    );
  }

  /**
   * Create Hasura Order
   */
  try {
    ctProductItemsRequest = await GraphQLClient.request(
      INSERT_ORDER_AND_UPDATE_BREAK_PRODUCTS,
      {
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
      }
    );
  } catch (e) {
    functions.logger.log(e);

    // if db update failed, undo reservation (TODO: is this right, even if payment went through?)
    await rollbackPurchase(ctProductItemsRequest);

    throw new functions.https.HttpsError(
      "internal",
      "Could not create order in our database"
    );
  }

  /**
   * Follow purchased breaks
   */
  try {
    GraphQLClient.request(SAVE_PURCHASED_BREAKS, {
      objects: ctPurchasedBreaks
        // remove dupes here, in the future there will be a db constraint,
        // but still good to avoid bad inserts
        .filter(
          (breakId, index, breakIds) => breakIds.indexOf(breakId) === index
        )
        .map((breakId) => {
          return {
            break_id: breakId,
            user_id: uid,
          };
        }),
    });
  } catch (e) {
    functions.logger.log(e);
  }

  /**
   * clear completed orders out of orders_in_process
   *  -- no need to wait for this, as it is semi-passive
   * cleanup and will be redone on the next pass, if
   * needs be
   */
  try {
    GraphQLClient.request(CLEAR_ORDERS_IN_PROCESS);
  } catch (e) {
    functions.logger.log(e);
  }

  return {
    message: "Order created",
  };
});
