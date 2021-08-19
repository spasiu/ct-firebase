const admin = require("firebase-admin");

admin.initializeApp();

module.exports = {
  // User
  ...require("./user/onUserCreate"),
  ...require("./user/createBigCommerceUser"),
  ...require("./user/userUpdatePermissions"),

  // Cards
  ...require("./cards/addCard"),
  ...require("./cards/getCards"),
  ...require("./cards/removeCard"),

  // Products
  ...require("./products/createBreakProducts"),

  // Cart
  ...require("./checkout/createCheckout"),
  ...require("./checkout/addItem"),
  ...require("./checkout/removeItem"),
  ...require("./checkout/updateItem"),
  ...require("./checkout/getCheckout"),
  ...require("./checkout/createOrder"),
  ...require("./checkout/addAddress"),

  // Video & Streams
  ...require("./video/muxWebhook"),
};
