const functions = require("firebase-functions");
const { GraphQLClient } = require("graphql-request");

const client = new GraphQLClient(functions.config().env.hasura.url, {
  headers: {
    "x-hasura-admin-secret": functions.config().env.hasura.adminSecret,
  },
});

module.exports = client;
