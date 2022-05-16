const functions = require("firebase-functions");
const axios = require("axios");

const notifier = (data) => {
    data.forEach(d => {
        const intercomNotificationOptions = {
            url: functions.config().env.intercom.webApiUrl + "events",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${functions.config().env.intercom.webApiKey}`
            },
            data: d,
        };

        axios(intercomNotificationOptions).catch(e => {
            functions.logger.log(`Could not send Intercom notification for ${d.event_name} to user ${d.user_id}`, JSON.stringify(e));
        });
    });
};

module.exports = notifier;