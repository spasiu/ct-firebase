const functions = require("firebase-functions");
const moment = require("moment");
const { gql } = require("graphql-request");
const GraphQLClient = require("../lib/graphql");

const EXPIRE_UNUSED_RESERVATIONS = gql`
  mutation UndoExpiredReservations($cutOff: timestamptz) {
    update_BreakProductItems(
      where: {
        _and: [
          { updated_at: { _lt: $cutOff } }
          { quantity: { _eq: 0 } }
          { order_id: { _is_null: true } }
        ]
      }
      _set: { quantity: 1 }
    ) {
      affected_rows
    }
  }
`;

exports.scheduledFunction = functions.pubsub
  .schedule("every 2 minutes")
  .onRun(async (context) => {
    try {
      await GraphQLClient.request(EXPIRE_UNUSED_RESERVATIONS, {
        cutOff: moment(new Date()).subtract(5, "minutes").toISOString(),
      });
    } catch (e) {
      functions.logger.error(e);
    }
  });
