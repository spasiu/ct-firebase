const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

module.exports = {
  // Product
  ...require("./products/createBreakProducts"),

  // Cart
  ...require("./checkout/createCheckout")
};