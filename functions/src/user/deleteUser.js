const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.deleteUser = functions.https.onCall(async (data) => {
  const uid = data.id;
 
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
