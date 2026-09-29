# Releasing the Wodana app

The Expo app replaces the old Flutter app in both stores under the same identity.

| | Value |
| --- | --- |
| iOS bundle id / Android package | `ai.wodana.mobile` |
| Apple team | `MSZ9TCZKAB` |
| Expo account / project | `wodanas-team` / `wodana` |
| App version | `2.0.0` (the old store app was `1.0.1`) |
| Build number | EAS keeps it remotely and adds 1 per store build. It starts at `2026092800` (the old app's last build was `2026090101`). |
| Build profiles (`eas.json`) | `development` (dev client), `preview` (UAT: internal APK and ad hoc iOS), `production` (store AAB and App Store build) |
| API (preview and production) | `https://plm.wodana.ai/api/v1` |
| Workspace | Chosen at sign-in from the email. To lock a build to one workspace, see step 3. |

Credentials never go in the repository. That covers keystores, passwords, `google-services.json` and service-account keys; `.gitignore` refuses them. They live in EAS credentials or EAS environment variables. For a local build they can also live in `~/.gradle/gradle.properties`.

## What the owner provides

1. **The EAS project id.** This is the UUID on expo.dev → wodanas-team → wodana → Overview. It replaces the placeholder `REPLACE_WITH_EAS_PROJECT_ID` in `eas.json`. Push tokens are issued for it, and every EAS build refuses to start until it is set.
2. **The Android upload keystore** that signed the old app: the `.jks` file, its alias and both passwords.
   - The old app's folder (`Wodana-Frontend/mobile_flutter/android`) has only `key.properties.example`. The keystore itself isn't there.
   - To find the right key, check Play Console → Wodana → Test and release → App integrity → App signing. The upload key certificate listed there is the one to match.
   - If the key is lost and the app uses Play App Signing, request an upload key reset on the same page, then upload the new key in step 5.
3. **Firebase for Android push.** Expo delivers Android pushes through FCM.
   - The old app has no usable Firebase configuration:
     - its `GoogleService-Info.plist` belongs to a local development project (`wodana-local-development`);
     - its Android `google-services.json` was registered for a different package (`ai.wodana.wodana`) and isn't in the folder.
   - In the Firebase console, create or choose the production project and add an Android app with package `ai.wodana.mobile`. Download:
     - `google-services.json`;
     - a service-account key (Project settings → Service accounts → Generate new private key) for FCM V1.
   - iOS pushes don't need Firebase: EAS creates the APNs key.
4. **Store access.**
   - An Apple ID in team `MSZ9TCZKAB` with App Manager rights.
   - A Google Play service-account JSON with release rights (Play Console → Setup → API access).

Keep these files outside the repository, for example in `~/wodana-secrets/`.

## One-time setup

Run everything from `wodana-saas/apps/mobile`.

```sh
npm ci
npm install -g eas-cli
eas login            # an account that is a member of wodanas-team
eas whoami
```

### 1. Link the EAS project

Replace the placeholder in `eas.json` with the project id (committed; it isn't a secret), and export it for commands run outside a build:

```sh
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("eas.json","utf8"));j.build.base.env.EXPO_PUBLIC_EAS_PROJECT_ID=process.argv[1];fs.writeFileSync("eas.json",JSON.stringify(j,null,2)+"\n")' <PROJECT_ID>
export EXPO_PUBLIC_EAS_PROJECT_ID=<PROJECT_ID>
eas project:info     # shows @wodanas-team/wodana
```

If expo.dev has no `wodana` project yet, `eas project:init` creates it and prints the id. It can't write into `app.config.ts`, so add the id with the command above.

### 2. Android push configuration (EAS file variable)

```sh
eas env:create --name GOOGLE_SERVICES_JSON --type file --value ~/wodana-secrets/google-services.json --environment production --environment preview --visibility secret
```

### 3. Optional: lock a build to one workspace

Skip this for a generic store app, where people choose the workspace by signing in.

```sh
eas env:create --name EXPO_PUBLIC_MOBILE_SINGLE_TENANT --value true --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_AUTH_TENANT_SLUG --value <workspace-login-slug> --environment production --visibility plaintext
```

### 4. iOS credentials

```sh
eas credentials --platform ios
```

1. Choose the `production` profile.
2. Sign in with the Apple ID.
3. Let EAS create the distribution certificate and the provisioning profile.
4. Under Push Notifications, let EAS create a push key.

### 5. Android credentials

```sh
eas credentials --platform android
```

1. Choose the `production` profile.
2. Keystore → Set up a new keystore → upload your own. Give the upload `.jks`, its alias and passwords at the prompts; they are stored only in EAS.
3. Google Service Account → push notifications (FCM V1) → upload the Firebase service-account JSON.
4. Google Service Account → Play Store submissions → upload the Play service-account JSON.

Repeat step 2 for the `preview` profile when prompted; the same keystore can be reused.

### 6. Build numbers

```sh
eas build:version:get --platform all
```

When nothing is set yet, the first build starts from `2026092800`. To set a number explicitly, use:

```sh
eas build:version:set --platform android
eas build:version:set --platform ios
```

The number must be above `2026090101`.

## Every release

### 1. Check

```sh
npm test
npx tsc --noEmit -p .
npx expo-doctor
EXPO_PUBLIC_APP_ENV=production EXPO_PUBLIC_AUTH_API_URL=https://plm.wodana.ai/api/v1 npx expo config --type public
```

### 2. Test with UAT builds (the `preview` profile)

These are internal builds: an APK for Android and an ad hoc build for iOS on registered devices.

```sh
eas device:create                               # once per tester iPhone
eas build --profile preview --platform all
```

For a developer build with the dev client (hot reload against a local API), use `eas build --profile development --platform ios` (or `android`).

### 3. Build and submit for the stores

This produces an AAB for Google Play and an App Store build for iOS.

```sh
eas build --profile production --platform all
eas submit --profile production --platform ios --latest       # to TestFlight / App Store Connect
eas submit --profile production --platform android --latest   # to the Play internal track, as a draft
```

- If Google Play has never received a build through the API, upload the first AAB by hand: download it from the build page on expo.dev and upload it in Play Console → Internal testing.
- Promote the release in App Store Connect and Play Console once testers sign off.

### 4. Updates without a store review (JavaScript only)

These reach builds with the same app version (runtime `2.0.0`):

```sh
eas update --channel production --message "<what changed>"
```

A native change (a new module, a permission, a new app version) needs a new store build.

## Local release build (optional)

EAS is the normal path. To build on your own machine, name the upload key in `~/.gradle/gradle.properties`, outside the repository:

```properties
WODANA_UPLOAD_STORE_FILE=/Users/<you>/wodana-secrets/upload-keystore.jks
WODANA_UPLOAD_STORE_PASSWORD=<store password>
WODANA_UPLOAD_KEY_ALIAS=<alias>
WODANA_UPLOAD_KEY_PASSWORD=<key password>
```

Then build:

```sh
EXPO_PUBLIC_APP_ENV=production EXPO_PUBLIC_EAS_PROJECT_ID=<PROJECT_ID> EXPO_PUBLIC_AUTH_API_URL=https://plm.wodana.ai/api/v1 \
  GOOGLE_SERVICES_JSON=~/wodana-secrets/google-services.json npx expo prebuild --platform android --clean
cd android && ./gradlew bundleRelease     # android/app/build/outputs/bundle/release/app-release.aab
```

`plugins/with-release-signing.js` signs the release build with that key when the properties exist.

## After install: smoke test on a phone

1. Sign in with a field account. On a second phone, the device limit offers to sign another device out.
2. Allow notifications. Me → Notifications on this phone shows it on.
3. Check in and out on Me or Today. The phone asks for location once.
4. On a project, send a daily site report with a photo. Offline, it waits in Me → Waiting to send.
5. Approve or return an item on Approvals, reached from Today's "N waiting for you".
6. For someone who answers clients: Inbox → Chats shows their chats; open one and add an internal note.
7. Send yourself a test notice from the web: Settings → Connections → Delivery → Send me a test. Tap it; the app opens its screen.

## Store listing

- Old listing assets are in `Wodana-Frontend/mobile_flutter/store_assets/final`. Its screenshots show the old app; take new ones.
- Privacy policy: https://wodana.ai/privacy.
- Data the app collects:
  - name and email;
  - precise location, only at check-in, check-out and crew days;
  - photos the person attaches;
  - a device push token.
- None of it is used for tracking or ads.
- Export compliance: the app declares no non-exempt encryption (`ITSAppUsesNonExemptEncryption` is false).
