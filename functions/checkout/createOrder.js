const functions = require("firebase-functions");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { gql } = require("graphql-request");
const GraphQLClient = require("../graphql/client");

const GET_AND_RESERVE_BREAK_PRODUCT_ITEMS_FOR_ORDER = gql`
  mutation GetAndReserveBreakProductItemsForOrder(
    $lineItems: [BreakProductItems_bool_exp!]
  ) {
    update_BreakProductItems(
      where: { _or: $lineItems }
      _inc: { quantity: -1 }
    ) {
      returning {
        id
        break_id
        Break {
          status
        }
      }
    }
  }
`;

const UNDO_ITEM_RESERVATION = gql`
  mutation UndoBreakProductItemReservation(
    $lineItems: [BreakProductItems_bool_exp!]
  ) {
    update_BreakProductItems(
      where: { _or: $lineItems }
      _inc: { quantity: 1 }
    ) {
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
      _set: { order_id: $orderId }
    ) {
      returning {
        id
      }
    }
  }
`;


const SAVE_PURCHASED_BREAKS = gql`
  mutation SavePurchasedBreaks(
    $objects:[SaveBreak_insert_input!]!
  ){
    insert_SaveBreak(objects:$objects){
      returning {
      user_id
      break_id
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
    ctProductItemsRequest = await GraphQLClient.request(GET_AND_RESERVE_BREAK_PRODUCT_ITEMS_FOR_ORDER, {
      lineItems: breakQueryProductInput
    });
  } catch (e) {
    functions.logger.log(e);
    throw new functions.https.HttpsError(
      "internal",
      "Could not get items from Cards & Treasure database"
    );
  }

  /**
   * make sure break is in a sellable state
   */
  const nUnsellableStatuses = ctProductItemsRequest
    .update_BreakProductItems.returning
    .map(productItem => productItem.Break.status)
    .filter(breakStatus => breakStatus === "COMPLETED" ||
                           breakStatus === "LIVE" ||
                           breakStatus === "SOLDOUT")
    .length;

  if (nUnsellableStatuses > 0) {
    await GraphQLClient.request(UNDO_ITEM_RESERVATION, {
      lineItems: breakQueryProductInput
    });
    
    throw new functions.https.HttpsError(
      "failed-precondition",
      nUnsellableStatuses > 1 ? "Spots are no longer available." :
                                "Spot is no longer available."
    );
  }

  /**
   * Verify products exist in cart and in our database
   */
  const ctPurchasedBreaks =
    ctProductItemsRequest.update_BreakProductItems.returning.map(_ => _.break_id);

  // Ensure number of break product items available in our databae matches length of BC line items
  if (ctPurchasedBreaks.length !== breakQueryProductInput.length) {
    
    // if not, undo previous reservation
    await GraphQLClient.request(UNDO_ITEM_RESERVATION, {
      lineItems: breakQueryProductInput
    });

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
    axios(psMakePaymentOptions);
  } catch (e) {
    functions.logger.log(e.response);

    // if payment failed, undo reservation
    await GraphQLClient.request(UNDO_ITEM_RESERVATION, {
      lineItems: breakQueryProductInput
    });

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
    await GraphQLClient.request(UNDO_ITEM_RESERVATION, {
      lineItems: breakQueryProductInput
    });

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
    await GraphQLClient.request(UNDO_ITEM_RESERVATION, {
      lineItems: breakQueryProductInput
    });

    throw new functions.https.HttpsError(
      "internal",
      "Could not update BigCommerce payment method and status"
    );
  }


  /**
   * Create Hasura Order
   */
  try {
    ctProductItemsRequest = await GraphQLClient.request(INSERT_ORDER_AND_UPDATE_BREAK_PRODUCTS, {
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
      }
    });
  } catch (e) {
    functions.logger.log(e);

       // if db update failed, undo reservation (TODO: is this right, even if payment went through?)
       await GraphQLClient.request(UNDO_ITEM_RESERVATION, {
        lineItems: breakQueryProductInput
      });
    
    throw new functions.https.HttpsError(
      "internal",
      "Could not create order in our database"
    );
  }

  /**
   * Follow purchased breaks
   */
  try {
    GraphQLClient.request(SAVE_PURCHASED_BREAKS,{
      objects:
      ctPurchasedBreaks
        // remove dupes here, in the future there will be a db constraint,
        // but still good to avoid bad inserts
        .filter((breakId, index, breakIds) => breakIds.indexOf(breakId) === index)
        .map( breakId => {
          return {
            break_id: breakId,
            user_id: uid
          }
    })
  })

  } catch (e) {
    functions.logger.log(e);
  }

  return {
    message: "Order created",
  };

});