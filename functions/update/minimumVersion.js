const functions = require("firebase-functions");

exports.minimumVersion = functions.https.onCall(() => {
  return functions.config().env.minimumVersion;
});
