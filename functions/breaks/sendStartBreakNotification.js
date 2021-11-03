const functions = require("firebase-functions");
const axios = require("axios");
const { gql } = require("graphql-request");
const GraphQLClient = require("../graphql/client");


const GET_BREAK_FOLLOWERS = gql`
    query BreakFollowers($breakId:uuid!) {
        SaveBreak(where: {break_id: {_eq: $breakId}}) {
            user_id
        }
    }
`

exports.sendStartBreakNotification = functions.https.onCall(
    async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "Must be logged in."
            );
        }

        const { breakId, breakName, breakerName } = data;

        // get break followers
        try {
            const result = await GraphQLClient.request(GET_BREAK_FOLLOWERS, { breakId: breakId });

            result.SaveBreak.forEach(user => {
                const intercomNotificationOptions = {
                    url: functions.config().env.intercom.webApiUrl,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${functions.config().env.intercom.webApiKey}`
                    },
                    data: {
                        "event_name": "New Event",
                        "created_at": Math.floor(Date.now() / 1000),
                        "user_id": user.user_id,
                        "metadata": {
                            "breakName": breakName,
                            "breaker": breakerName
                        }
                    },
                };

                axios(intercomNotificationOptions).catch(e => {
                    functions.logger.log(`Could not send start break notification for ${breakName} to user ${user.user_id}`, JSON.stringify(e));
                });
            });

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