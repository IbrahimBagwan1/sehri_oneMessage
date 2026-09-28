# First preview build — EAS setup, in order

Everything needed before `eas build --profile preview` works for Android
and iOS, in the order to do it. Commands run from `frontend/` unless noted.
Commands were checked against eas-cli 24.8 (`eas env:set`; the older
`eas env:create` still works but is deprecated).

**Why the order matters:** on the EAS build server, preview builds now stop
with a clear error unless they have a real bundle id, both Maps keys and (for
Android) the Firebase file (`app.config.js` — the iOS map crashes without its
key, and push needs Firebase). Each step below unblocks the next.

## Before you start

- An Expo account, and a paid **Apple Developer Program** membership (iOS
  preview builds are "ad hoc" and need it). Google Play is **not** needed for
  a preview APK.
- The API from this branch running somewhere the phones can reach over
  **HTTPS** (a staging server, or a reserved ngrok domain), with
  `npm run migrate` done. Release builds refuse `http://` URLs.
- Your local checkout on the branch: `git checkout release/qa-pass-2 && git pull`.
  EAS uploads your working folder as it is, so keep it clean.

## 1. Install the CLI and sign in

```bash
npm install -g eas-cli
eas login
eas whoami
```

## 2. Create the EAS project

```bash
cd frontend
eas init
```

Because the config is `app.config.js` (dynamic), `eas init` cannot write the
id into it; it prints the **project ID** instead. Put it, and your Expo
account/organisation name, in `frontend/.env` (gitignored) — the CLI needs
them on your computer to know which project it is building:

```
EAS_PROJECT_ID=<the id eas init printed>
EXPO_OWNER=<your expo account or organisation>
```

## 3. Choose the bundle identifier (permanent)

Pick it once, e.g. `in.onemessage.app`. It becomes the Android package and
the iOS bundle id, and Firebase, Maps and Apple are all tied to it.

Edit `frontend/eas.json` and replace **both** `REPLACE_WITH_YOUR_BUNDLE_ID`
(under `build.preview.env` and `build.production.env`). Commit it on this
branch:

```bash
git commit -am "Set the app's bundle identifier"
git push
```

Preview and production use the same id on purpose: one Firebase app, one set
of key restrictions, and the preview installs exactly what will ship. (A
preview APK and a store install of the same app can't sit side by side —
irrelevant until launch.)

## 4. EAS variables that need no external setup

```bash
eas env:set --name EAS_PROJECT_ID --value <project-id> --environment development --environment preview --environment production --visibility plaintext --non-interactive
```

```bash
eas env:set --name EXPO_OWNER --value <expo-account> --environment development --environment preview --environment production --visibility plaintext --non-interactive
```

```bash
eas env:set --name EXPO_PUBLIC_API_BASE_URL --value https://<your-staging-api>/api --environment preview --visibility plaintext --non-interactive
```

(Set the production URL the same way with `--environment production` when
the production API exists. Include the trailing `/api`.)

## 5. Google Maps keys (Google Cloud Console → APIs & Services → Credentials)

Create two **new** keys (never reuse the old leaked ones — delete those,
LAUNCH_CHECKLIST §1):

- **Android key**: API restriction = *Maps SDK for Android* only. Leave the
  *app* restriction for step 7 — it needs the signing key's SHA-1, which EAS
  creates in step 7.
- **iOS key**: API restriction = *Maps SDK for iOS* only; app restriction =
  iOS apps → your bundle id.

```bash
eas env:set --name GOOGLE_MAPS_ANDROID_API_KEY --value <android-key> --environment preview --environment production --visibility sensitive --non-interactive
```

```bash
eas env:set --name GOOGLE_MAPS_IOS_API_KEY --value <ios-key> --environment preview --environment production --visibility sensitive --non-interactive
```

Use **sensitive**, not secret: `eas config` (step 10) can then show them for
checking; secret variables are only readable on EAS servers.

## 6. Firebase (Android push)

1. [Firebase console](https://console.firebase.google.com) → Add project →
   Add app → **Android**, package name = your bundle id → download
   `google-services.json` into `frontend/` (it is gitignored).
2. Upload it as a file variable:

   ```bash
   eas env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview --environment production --visibility sensitive --non-interactive
   ```

3. Firebase → Project settings → **Service accounts** → *Generate new private
   key*. This JSON **is** a secret: don't put it in the repo, delete your local
   copy after the next step.

## 7. Android signing key and push credentials

```bash
eas credentials --platform android
```

Choose the **preview** profile, then:

1. **Keystore** → set up a new keystore (EAS generates and stores it). Note
   the **SHA-1 fingerprint** it shows (it is also shown later under the same
   menu).
2. **Google Service Account** → *Push Notifications (FCM V1)* → upload the
   service-account JSON from step 6.3. Then delete the local copy.
3. Back in Google Cloud, edit the **Android Maps key** → app restriction =
   Android apps → add your package name + that SHA-1. (When you later publish
   on Play, add the Play *app signing* SHA-1 too — Play Console → App
   integrity.)

## 8. iOS devices and credentials (ad hoc)

1. Register every iPhone that will install the preview:

   ```bash
   eas device:create
   ```

   Choose *Website*, open the link/QR on each iPhone, install the profile it
   offers (Settings shows "Profile downloaded").
2. Credentials (optional to do now — `eas build` asks the same questions):

   ```bash
   eas credentials --platform ios
   ```

   Choose **preview** → let EAS create the distribution certificate and the ad
   hoc provisioning profile (sign in with your Apple ID when asked) → **Push
   Notifications** → set up a new push key (APNs) and let EAS manage it.

## 9. Crash reporting — choose one

**A. With Sentry** (recommended; the QA plan checks Sentry afterwards):

```bash
eas env:set --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --environment preview --environment production --visibility plaintext --non-interactive
```

```bash
eas env:set --name SENTRY_ORG --value <org-slug> --environment preview --environment production --visibility plaintext --non-interactive
```

```bash
eas env:set --name SENTRY_PROJECT --value <project-slug> --environment preview --environment production --visibility plaintext --non-interactive
```

```bash
eas env:set --name SENTRY_AUTH_TOKEN --value <auth-token> --environment preview --environment production --visibility secret --non-interactive
```

**B. Without Sentry for now** — the release build otherwise fails at the
source-map upload step (seen in the local build):

```bash
eas env:set --name SENTRY_DISABLE_AUTO_UPLOAD --value true --environment preview --visibility plaintext --non-interactive
```

## 10. Check before spending a build

```bash
eas env:list --environment preview
```

Expect: `EAS_PROJECT_ID`, `EXPO_OWNER`, `EXPO_PUBLIC_API_BASE_URL`,
`GOOGLE_MAPS_ANDROID_API_KEY`, `GOOGLE_MAPS_IOS_API_KEY`,
`GOOGLE_SERVICES_JSON`, and the Sentry set (A) or
`SENTRY_DISABLE_AUTO_UPLOAD` (B).

```bash
eas config --profile preview --platform android
```

```bash
eas config --profile preview --platform ios
```

Read the output: `android.package` / `ios.bundleIdentifier` must be your
bundle id (not `com.anonymous.onemessage`), `android.config.googleMaps.apiKey`
and `ios.config.googleMapsApiKey` must be non-empty, and `extra.eas.projectId`
must be set. The hard checks in `app.config.js` run only on the EAS build
server (that is where `EAS_BUILD_PROFILE` is set), so a mistake here would
otherwise surface as a failed build a few minutes in, with the missing item
named in the build log.

Not EAS variables (don't create them): `APP_BUNDLE_ID` and
`EXPO_PUBLIC_APP_ENV` come from `eas.json`, which wins over EAS variables of
the same name (the CLI warns "The values from the build profile
configuration will be used").

## 11. Build

```bash
eas build --profile preview --platform android
```

```bash
eas build --profile preview --platform ios
```

(`--platform all` does both.) Each prints a build page URL.

## 12. Install

- **Android**: open the build page on the phone (or scan its QR) → download
  the APK → allow installing from the browser when asked.
- **iPhone**: open the build page on a **registered** iPhone → Install. The
  first time, iOS asks you to turn on **Developer Mode** (Settings → Privacy &
  Security → Developer Mode → On, then restart).

Then run `QA_TEST_PLAN.md`. A device added later needs `eas device:create`
and a new iOS build.
