const functions = require("firebase-functions");
const { gql } = require("graphql-request");
const authorize = require("../services/authorization");
const GraphQLClient = require("../services/graphql");
const notifier = require("../services/notification")


const GET_BREAK_FOLLOWERS = gql`
    query BreakFollowers($breakId:uuid!) {
        SaveBreak(where: {break_id: {_eq: $breakId}}) {
            user_id
        }
    }
`

exports.sendBreakLiveNotification = functions.https.onCall(async (data, context) => {
    authorize(context, "manager");

    const { breakId, breakName, breakerName } = data;

    // get break followers
    try {
        const result = await GraphQLClient.request(GET_BREAK_FOLLOWERS, { breakId: breakId });

        const data = result.SaveBreak.map(user => {
            return {
                "event_name": "Break Live",
                "created_at": Math.floor(Date.now() / 1000),
                "user_id": user.user_id,
                "metadata": {
                    "breakName": breakName,
                    "breaker": breakerName
                }
            }
        })

        notifier(data);

    } catch (e) {
        functions.logger.log(e);
        throw new functions.https.HttpsError(
            "internal",
            `Could not get followers for break: ${breakId}`
        );
    }
    return {
        message: "Successfully sent notifications",
    };
}
);