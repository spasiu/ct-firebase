const functions = require("firebase-functions");
const { gql } = require("graphql-request");
const authorize = require("../lib/authorization");
const GraphQLClient = require("../lib/graphql");
const notifier = require("../lib/notification")


/**
 * sadly, there is no way to get from the event to breaker to savebreaker,
 * as the latter is only connect to the Users table via user_id and not
 * breaker_id; when breakers are broken out, we can fix this,
 * for now, there have to be 2 db calls
 */
const GET_EVENT_FOLLOWERS = gql`
    query EventFollowers($eventId:uuid!) {
        SaveEvent(where: {event_id: {_eq: $eventId}}) {
            user_id
        }
    }
`
const GET_BREAKER_FOLLOWERS = gql`
    query BreakerFollowers($breakerId:String!) {
        SaveBreaker(where: {breaker_id: {_eq: $breakerId}}) {
            user_id
        }
    }
`

exports.sendEventLiveNotification = functions.https.onCall(async (data, context) => {
    authorize(context, "manager");

    const { eventId, eventName, breakerId, breakerName } = data;

    // get event and breaker followers and populate data for notification
    try {
        const eventFollowers = await GraphQLClient.request(GET_EVENT_FOLLOWERS, { eventId: eventId });
        let users = eventFollowers.SaveEvent.map(follower => follower.user_id)

        const breakerFollowers = await GraphQLClient.request(GET_BREAKER_FOLLOWERS, { breakerId: breakerId });
        users = users.concat(breakerFollowers.SaveBreaker.map(follower => follower.user_id));

        const data = users.map(user => {
            return {
                "event_name": "Event Live",
                "created_at": Math.floor(Date.now() / 1000),
                "user_id": user,
                "metadata": {
                    "eventName": eventName,
                    "breaker": breakerName
                }
            }
        })

        notifier(data);

    } catch (e) {
        functions.logger.log(e);
        throw new functions.https.HttpsError(
            "internal",
            `Could not get followers for event: ${eventId}`
        );
    }
    return {
        message: "Successfully sent notifications",
    };
}
);