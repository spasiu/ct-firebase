const functions = require("firebase-functions");
const axios = require("axios");
const { gql } = require("graphql-request");
const GraphQLClient = require("../services/graphql");
const authorize = require("../services/authorization");
const uuid = require("uuid");

const MILLICAST_API_URL = "https://api.millicast.com/api";
const MILLICAST_API_SECRET = functions.config().env.millicast.secret;
const INSERT_EVENT = gql`
  mutation InsertEvent($data: Events_insert_input!) {
  insert_Events_one(object: $data) {
    id
  }
}`;

exports.createEvent = functions.https.onCall(async (data, context) => {
  authorize(context,"manager");

  const { title, description, image, start_time, user_id } = data;
  const streamName = uuid.v4();
  let millicastResponse;

  try {
    millicastResponse = await axios({
      url: `${MILLICAST_API_URL}/publish_token`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MILLICAST_API_SECRET}`,
      },
      data: { label: streamName, record: true, streams: [{ streamName }]}
    });

    if (millicastResponse.data.status !== "success") {
      const rdata = JSON.stringify(millicastResponse.data);
      throw new Error(`Failure ${rdata}`);
    }
  } catch (error) {
      console.error(`Millicast failed to create token ${error}`);
      throw new functions.https.HttpsError(
        "failed-precondition",
        error,
        { ct_error_code: "create_publishing_token_failed" }
      );
  }

  const token = millicastResponse.data.data.token;
  const queryResponse = await GraphQLClient.request(INSERT_EVENT, {
    data: {
      title,
      description,
      image,
      start_time,
      user_id,
      stream_name: streamName,
      publishing_token: token
    }
  });
  return queryResponse.data;
});
