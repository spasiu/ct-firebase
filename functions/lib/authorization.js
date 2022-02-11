const functions = require("firebase-functions");

const authorize = (context, requiredRole = "user") => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "Must be logged in.",
            { ct_error_code: "not_logged_in" }
        );
    }

    const userRole = context.auth.token["https://hasura.io/jwt/claims"]["x-hasura-default-role"];
    const permissionsError = new functions.https.HttpsError(
        "failed-precondition",
        "Current user does not have permissions for the requested operation.",
        { ct_error_code: "invalid_permissions" }
    );

    switch (userRole) {
        case "admin": break;
        case "manager":
            if (requiredRole === "admin") throw permissionsError;
            break;
        case "user":
            if (requiredRole !== "user") throw permissionsError;
            break;
    }
}

module.exports = authorize;