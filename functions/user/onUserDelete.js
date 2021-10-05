const functions = require("firebase-functions");
const axios = require("axios");
const { gql } = require("graphql-request");

const GraphQLClient = require("../graphql/client");

const GET_USER_INFO = gql`
  query GetUserPaysafeId($userId: String!) {
    Users_by_pk(id: $userId) {
      bc_user_id
      paysafe_user_id
    }
  }
`;

const REMOVE_HASURA_USER = gql`
  mutation RemoveUser($userId: String!) {
    update_Users_by_pk(
      pk_columns: { id: $userId }
      _set: {
        email: null
        first_name: null
        last_name: null
        image: null
        username: null
        paysafe_user_id: null
        bc_user_id: null
      }
    ) {
      id
    }

    delete_Addresses(where: { user_id: { _eq: $userId } }) {
      affected_rows
    }
  }
`;

exports.onUserDelete = functions.auth.user().onDelete(async (user) => {
  const uid = user.uid;

  let userInfo;

  try {
    userInfo = await GraphQLClient.request(GET_USER_INFO, {
      userId: uid,
    });
  } catch (error) {
    functions.logger.log(error);
  }

  /**
   * Delete Paysafe profile
   */
  if (userInfo.Users_by_pk.paysafe_user_id) {
    const psDeleteProfileOptions = {
      url: `${functions.config().env.paysafe.url}/customervault/v1/profiles/${
        userInfo.Users_by_pk.paysafe_user_id
      }`,
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${functions.config().env.paysafe.serverToken}`,
      },
    };

    try {
      await axios(psDeleteProfileOptions);
    } catch (error) {
      functions.logger.log(error.response.data);
    }
  }

  /**
   * Delete BC user
   */
  if (userInfo.Users_by_pk.bc_user_id) {
    const bcDeleteUserOptions = {
      url: `${functions.config().env.bigCommerce.url}/customers?id:in=${
        userInfo.Users_by_pk.bc_user_id
      }`,
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Client": functions.config().env.bigCommerce.clientId,
        "X-Auth-Token": functions.config().env.bigCommerce.accessToken,
      },
    };

    try {
      await axios(bcDeleteUserOptions);
    } catch (error) {
      functions.logger.log(error.response.data);
    }
  }

  /**
   * Remove user from Hasura
   */
  try {
    await GraphQLClient.request(REMOVE_HASURA_USER, { userId: uid });
  } catch (error) {
    functions.logger.log(error.response.data);
  }

  return {
    message: "Successfully removed user",
  };
});
