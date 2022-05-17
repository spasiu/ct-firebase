const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { auth } = require("firebase-admin");
const authorize = require("../services/authorization");

exports.deleteUser = functions.https.onCall(async (data, context) => {
  // make sure the user is logged in and use logged in user id
  authorize(context);
  const uid = context.auth.uid;
 
  /**
   * delete user via firebase admin;
   * this should trigger the onDeletUser func
   * that will take care of the other accounts
   */
  try {
    await admin.auth().deleteUser(uid);
  } catch(error) {
    functions.logger.error(error);
  };

});
