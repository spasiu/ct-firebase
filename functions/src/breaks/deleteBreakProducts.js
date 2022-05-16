const functions = require("firebase-functions");
const axios = require("axios");
const { gql } = require("graphql-request");
const GraphQLClient = require("../services/graphql");
const authorize = require("../services/authorization");


const DELETE_BREAK_PRODUCT_ITEMS = gql`
  mutation DeleteBreakProductItems($id: uuid!) {
    delete_BreakProductItems(where: {break_id: {_eq: $id}}) {
      affected_rows
    }
  }
`;

exports.deleteBreakProducts = functions.https.onCall(async (data, context) => {
    authorize(context,"manager");

    const { breakId, breakProdId } = data;

    const bcRequestOptions = {
        url: `${functions.config().env.bigCommerce.url}/catalog/products/${breakProdId}`,
        method: "DELETE",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Auth-Client": functions.config().env.bigCommerce.clientId,
          "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
        }
      };
    
    await axios(bcRequestOptions);
    
    await GraphQLClient.request(DELETE_BREAK_PRODUCT_ITEMS, {
          id: breakId
    });

    return {
        message: "Break Products Removed",
    };
});