const functions = require("firebase-functions");
const notifier = require("../lib/notification")


exports.sendHitNotification = functions.https.onCall(
    async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "Must be logged in."
            );
        }

        const { userId, playerName } = data;

        // get event and breaker followers and populate data for notification
        try {
            const data =  [
                {
                    "event_name": "New Hit",
                    "created_at": Math.floor(Date.now() / 1000),
                    "user_id": userId,
                    "metadata": {
                        "playerName": playerName
                    }
                }
            ];

            notifier(data);

        } catch (e) {
            functions.logger.log(e);
            throw new functions.https.HttpsError(
                "internal",
                `Could send hit notification to user: ${userId} for player: ${playerName}`
            );
        }
        return {
            message: "Successfully sent notifications",
        };
    }
);