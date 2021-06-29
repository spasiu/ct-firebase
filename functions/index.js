const admin = require("firebase-admin");

admin.initializeApp();

module.exports = {
  // Products
  ...require("./products/createBreakProducts"),

  // Cart
  ...require("./checkout/createCheckout"),
};