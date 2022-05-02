const functions = require("firebase-functions");


exports.deleteUser = functions.https.onCall(async (data) => {
  const userId = data.id;
  return userId
});
