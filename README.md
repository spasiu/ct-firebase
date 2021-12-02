# C&T Firebase

When initializing a new instance of the C&T Firebase project, make sure that the `functions/config/admins.js` file contains the emails of administrators you want to initialize.

## Prerequisites

1. Install Firebase CLI

   `npm install -g firebase-tools`

2. Login to Firebase CLI

   `firebase login`

3. Inside **root** of repo, set Firebase CLI to use appropriate project:

   `firebase use <project id>`

   Eg. For current staging environment, use `candt-admin-dev` as project id

## Development

Local environment setup:

1. Get Google Application Credentials JSON file and set `GOOGLE_APPLICATION_CREDENTIALS` path variable to point to file (https://cloud.google.com/docs/authentication/getting-started)

   `GOOGLE_APPLICATION_CREDENTIALS="<path to json file>.json"`

2. Configure local enviornment config variables inside `.runtimeconfig.json` file in **root** of repo

   To export current config from Firebase, run in **root** of repo: `firebase functions:config:get > .runtimeconfig.json`

3. Run `npm install` inside of **functions** directory
4. From **root** directory, run `firebase emulators:start`

## Deployment

1. Configure remote env vars (only if updates are required)
   - Get latest remote env vars<br/>
   `firebase functions:config:get > env.json`
   - remove outer `env` object (field and brackets)
   - edit as required
   - reset env vars<br/>`firebase functions:config:unset env && firebase functions:config:set env="$(cat env.json)"`<br/>(note the double quotes around the value)
      
2. From the **root** of the repo, run the following command to deploy to current project:
   `firebase deploy --only functions`

## Resources

- [Firebase CLI cheatsheet](https://dev.to/rajeshkumaravel/google-firebase-functions-setting-and-accessing-environment-variable-1gn2)
- Adding environment variables to firebase: https://firebase.google.com/docs/functions/config-env
- Getting Google Application Credentials file: https://cloud.google.com/docs/authentication/getting-started
