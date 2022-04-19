const functions = require("firebase-functions");
const shuffleArray = require("../utils/shuffleArray");
const { gql } = require("graphql-request");
const GraphQLClient = require("../lib/graphql");
const authorize = require("../lib/authorization");


// TODO: change dataset location to relationship btw Breaks and datasets tables
const GET_BREAK_DETAILS_FOR_LIVE = gql`
  query GetBreakDetailsForLive($id: uuid!) {
    Breaks_by_pk(id: $id) {
      id
      result
      break_type
      teams_per_spot
      datasets {
        data
      }
      BreakProductItems(where: { order_id: { _is_null:false } }) {
        id
        title
        Order {
          id
          bc_order_id
          User {
            id
            username
            image
          }
        }
      }
    }
  }
`;

const SET_BREAK_RESULTS_FOR_LIVE = gql`
  mutation SetBreakResultsForLive($id: uuid!, $result: jsonb!) {
    update_Breaks_by_pk(
      pk_columns: { id: $id }
      _set: { result: $result, status: LIVE }
    ) {
      id
    }
  }
`;

exports.startBreak = functions.https.onCall(async (data, context) => {
  authorize(context,"manager");

  const { breakId } = data;

  let breakData,
    dataset,
    users = [],
    breakType;

  /**
   * Get break data for randomization
   */
  try {
    const fetchBreakData = await GraphQLClient.request(GET_BREAK_DETAILS_FOR_LIVE, {
      id: breakId
    });
    breakData = fetchBreakData.Breaks_by_pk;
  } catch (e) {
    functions.logger.log(e);
    throw new functions.https.HttpsError(
      "internal",
      "Could not get break details from database",
      e
    );
  }
  
  if (breakData) {
    breakType = breakData.break_type;
  } else {
    throw new functions.https.HttpsError("internal", "No break data found.");
  }

  if (breakType === "PERSONAL") {
    users = breakData.BreakProductItems.map((item) => ({
        user_id: item.Order.User.id,
        username: item.Order.User.username,
        image: item.Order.User.image,
        bc_order_id: item.Order.bc_order_id
      }));
  }

  if (breakType === "HIT_DRAFT") {
    users = await shuffleArray(
      breakData.BreakProductItems.map((item) => ({
        user_id: item.Order.User.id,
        username: item.Order.User.username,
        image: item.Order.User.image,
        bc_order_id: item.Order.bc_order_id
      }))
    );
  }

  if (breakType === "RANDOM_DIVISION" || breakType === "RANDOM_TEAM") {
    dataset = await shuffleArray(breakData.datasets.data);

    users = await shuffleArray(
      breakData.BreakProductItems.map((item) => ({
        user_id: item.Order.User.id,
        username: item.Order.User.username,
        image: item.Order.User.image,
        bc_order_id: item.Order.bc_order_id,
        items: [],
      }))
    );

    for (let idx = 0; idx < users.length; idx++) {
      for (let j = 0; j < breakData.teams_per_spot; j++) {
        users[idx].items.push(dataset.shift());
      }
    }
  }

  if (breakType === "PICK_YOUR_DIVISION" || breakType === "PICK_YOUR_TEAM") {
    users = breakData.BreakProductItems.map((item) => ({
      user_id: item.Order.User.id,
      username: item.Order.User.username,
      image: item.Order.User.image,
      bc_order_id: item.Order.bc_order_id,
      items: [breakData.datasets.data.find((i) => i.name === item.title)],
    }));
  }

  /**
   * Set break randomization results
   */
  try {
      await GraphQLClient.request(SET_BREAK_RESULTS_FOR_LIVE, {
        id: breakId,
        result: breakData.result || users
      });
      return {
        message: "Break started",
      };
    } catch (e) {
      functions.logger.log(e);
      throw new functions.https.HttpsError(
        "internal",
        "Could not set break to live in database",
        e
      );
    }
});
