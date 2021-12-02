const admin = require("firebase-admin");

admin.initializeApp();

/**
 * TODO: Use GraphQL Client
 */
module.exports = {
  // User
  ...require("./user/onUserCreate"),
  ...require("./user/onUserDelete"),
  ...require("./user/createBigCommerceUser"),
  ...require("./user/userUpdatePermissions"),

  // Cards
  ...require("./cards/addCard"),
  ...require("./cards/getCards"),
  ...require("./cards/removeCard"),

  // Breaks
  ...require("./breaks/createBreakProducts"),
  ...require("./breaks/startBreak"),

  // Notifications
  ...require("./notifications/sendEventLiveNotification"),
  ...require("./notifications/sendBreakLiveNotification"),
  ...require("./notifications/sendHitNotification"),

  // Cart
  ...require("./checkout/createCheckout"),
  ...require("./checkout/addItem"),
  ...require("./checkout/removeItem"),
  ...require("./checkout/updateItem"),
  ...require("./checkout/getCheckout"),
  ...require("./checkout/createOrder"),
  ...require("./checkout/addAddress"),
  ...require("./checkout/timeoutReservations"),

  // Events
  ...require("./events/createEvent")
};
