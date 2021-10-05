const functions = require("firebase-functions");
const axios = require("axios");
const shuffleArray = require("../utils/shuffleArray");

const GET_BREAK_DETAILS_FOR_LIVE = `
  query GetBreakDetailsForLive($id: uuid!) {
    Breaks_by_pk(id: $id) {
      id
      dataset
      break_type
      teams_per_spot
      BreakProductItems(where: { order_id: { _is_null:false } }) {
        id
        title
        Order {
          id
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

const SET_BREAK_RESULTS_FOR_LIVE = `
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
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Must be logged in."
    );
  }

  const { breakId } = data;

  let breakData,
    dataset,
    users = [],
    breakType;

  /**
   * Get break data for randomization
   */
  const ctGetBreakDetailsOptions = {
    url: functions.config().env.hasura.url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    data: {
      query: GET_BREAK_DETAILS_FOR_LIVE,
      variables: {
        id: breakId,
      },
    },
  };

  try {
    const fetchBreakData = await axios(ctGetBreakDetailsOptions);

    breakData = fetchBreakData.data.data.Breaks_by_pk;
  } catch (e) {
    throw new functions.https.HttpsError(
      "internal",
      "Could not get break details."
    );
  }

  if (breakData) {
    breakType = breakData.break_type;
  } else {
    throw new functions.https.HttpsError("internal", "No break data found.");
  }

  if (breakType === "HIT_DRAFT") {
    users = await shuffleArray(
      breakData.BreakProductItems.map((item) => ({
        user_id: item.Order.User.id,
        username: item.Order.User.username,
        image: item.Order.User.image,
      }))
    );
  }

  if (breakType === "RANDOM_DIVISION" || breakType === "RANDOM_TEAM") {
    dataset = await shuffleArray(breakData.dataset);

    users = await shuffleArray(
      breakData.BreakProductItems.map((item) => ({
        user_id: item.Order.User.id,
        username: item.Order.User.username,
        image: item.Order.User.image,
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
      items: [item.title],
    }));
  }

  /**
   * Set break randomization results
   */
  const ctSetBreakResultsOptions = {
    url: functions.config().env.hasura.url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    data: {
      query: SET_BREAK_RESULTS_FOR_LIVE,
      variables: {
        id: breakId,
        result: users,
      },
    },
  };

  try {
    await axios(ctSetBreakResultsOptions);
  } catch (e) {
    throw new functions.https.HttpsError(
      "internal",
      "Could not update break results."
    );
  }

  return {
    message: "Break started",
  };
});
