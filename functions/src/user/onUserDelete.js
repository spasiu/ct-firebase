const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { gql } = require("graphql-request");

const GraphQLClient = require("../services/graphql");

const GET_USER_INFO = gql`
  query GetUserInfo($userId: String!) {
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

  try {
    /**
     * Delete Intercom user
     */
    try {
      const intercomOptions = {
        url: functions.config().env.intercom.webApiUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${functions.config().env.intercom.webApiKey}`,
        },
      };

      const intercomUser = await axios({
        ...intercomOptions,
        url: `${intercomOptions.url}/contacts/search`,
        data: {
          query: {
            field: "external_id",
            operator: "=",
            value: uid,
          },
        }, // get first entry in data list for unique user
      }).then((response) => response.data.data[0]);

      if (intercomUser) {
        await axios({
          ...intercomOptions,
          url: `${intercomOptions.url}/user_delete_requests`,
          data: { intercom_user_id: intercomUser.id },
        });
      }
      
    } catch (error) {
      if (!error.message.includes("404")) {
        throw error;
      }
    }

    /**
     * get stored user account info
     */
    const userInfo = await GraphQLClient.request(GET_USER_INFO, {
      userId: uid,
    });

    /**
     * Delete Paysafe profile
     */
    try {
      if (userInfo.Users_by_pk.paysafe_user_id) {
        const psDeleteProfileOptions = {
          url: `${
            functions.config().env.paysafe.url
          }/customervault/v1/profiles/${userInfo.Users_by_pk.paysafe_user_id}`,
          method: "DELETE",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Basic ${
              functions.config().env.paysafe.serverToken
            }`,
          },
        };

        await axios(psDeleteProfileOptions);
      }
    } catch (error) {
      if (!error.message.includes("404")) {
        throw error;
      }
    }

    /**
     * Delete BC user
     */
    try {
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

        await axios(bcDeleteUserOptions);
      }
    } catch (error) {
      if (!error.message.includes("404")) {
        throw error;
      }
    }

    /**
     * Delete user in firestore
     */
    await admin.firestore().collection("Users").doc(uid).delete();

    /**
     * Remove user from Hasura
     */
    await GraphQLClient.request(REMOVE_HASURA_USER, { userId: uid });

    return {
      message: "Successfully removed user",
    };
  } catch (error) {
    functions.logger.error(error);
  }
});
