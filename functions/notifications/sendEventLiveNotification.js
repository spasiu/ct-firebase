const functions = require("firebase-functions");
const { gql } = require("graphql-request");
const GraphQLClient = require("../lib/graphql");
const notifier = require("../lib/notification")


const GET_EVENT_FOLLOWERS = gql`
    query EventFollowers($eventId:uuid!) {
        SaveEvent(where: {event_id: {_eq: $eventId}}) {
            user_id
            Event {
                user_id
                title
            }
        }
    }
`
const GET_BREAKER_FOLLOWERS = gql`
    query BreakerFollowers($breakerId:String!) {
        SaveBreaker(where: {breaker_id: {_eq: $breakerId}}) {
            user_id
            Breaker {
                username
            }
        }
    }
`

exports.sendEventLiveNotification = functions.https.onCall(
    async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "Must be logged in."
            );
        }

        const { eventId } = data;

        // get event and breaker followers and populate data for notification
        try {
            const eventFollowers = await GraphQLClient.request(GET_EVENT_FOLLOWERS, { eventId: eventId });
            const breakerId = eventFollowers.SaveEvent[0].Event.user_id;
            const eventName = eventFollowers.SaveEvent[0].Event.title;
            let users = eventFollowers.SaveEvent.map(follower => follower.user_id)

            const breakerFollowers = await GraphQLClient.request(GET_BREAKER_FOLLOWERS, { breakerId: breakerId });
            const breakerName = breakerFollowers.SaveBreaker[0].Breaker.username;
            users = users.concat(breakerFollowers.SaveBreaker.map(follower => follower.user_id));

            functions.logger.log(`BREAKER: ${breakerName}->${breakerId}, EVENT: ${eventName}, USERS: ${JSON.stringify(users)}`)


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