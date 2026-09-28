# Launch checklist — what is left, all outside the codebase

Updated after the second (adversarial QA) pass, 28 Sep 2026. Everything in
the code is done and tested; each item below needs you, a console, or a
decision. Work top to bottom — later items depend on earlier ones.

## 0. Decisions and housekeeping (do first)

- [ ] **Test a preview build from `release/qa-pass-2`, then merge its PR.**
      The QA pass is committed on that branch with a PR into `main` (not
      merged). Build it with `EAS_PREVIEW_SETUP.md`, run `QA_TEST_PLAN.md`,
      then merge.
- [ ] **Delete the local database dump** used for migration testing if you
      still see one — this pass removed its copy; nothing was committed.

## 1. Rotate every credential that has been exposed

Treat these as public. Rotate, then update the server `.env` and EAS.

- [ ] **Google Maps API keys** `AIzaSyAWQ…8go` and `AIzaSyCoa…phw` (in git
      history). **Delete both** in Google Cloud and confirm they are dead —
      exact check in `GIT_HISTORY_CLEANUP.md` step 1.
- [ ] **MySQL password** for `sehri_user` (and a separate production user).
- [ ] **JWT_SECRET** and **JWT_REFRESH_SECRET** — new, different, 48+ random
      bytes. Signs everyone out once; expected.
- [ ] **MessageCentral** auth token.
- [ ] **Cloudinary** API secret (Settings → Access keys → regenerate).
- [ ] *Optional*: rewrite git history to remove the dead keys — only if the
      repo will be public. Step-by-step with warnings: `GIT_HISTORY_CLEANUP.md`.
      Rotation is what protects you; do it either way.

## 2. Permanent identifiers

- [ ] **Bundle identifier / package name** (permanent once published), e.g.
      `in.onemessage.app`. Replace both `REPLACE_WITH_YOUR_BUNDLE_ID` in
      `frontend/eas.json` (`build.preview.env` and `build.production.env`);
      preview and production builds refuse the placeholder.

## 3. Accounts

- [ ] **Apple Developer Program** (organization if you have a D-U-N-S number).
- [ ] **Google Play Console**. Personal account created after Nov 2023 →
      **closed test with ≥ 12 testers for 14 consecutive days** before
      production access. Start this early.
- [ ] **Expo / EAS**: project, variables and credentials — follow
      `EAS_PREVIEW_SETUP.md` steps 1–10 in order.
- [ ] **Sentry**: React Native project; turn on data scrubbing, turn **off**
      IP address storage, retention ≤ 90 days. Create an auth token with
      `project:releases` for source-map upload.

## 4. Google Cloud (Maps)

- [ ] Billing, a **budget alert** (e.g. ₹2,000/month), per-API **daily
      quota caps** (Directions ~2,000/day).
- [ ] **Android key** — Maps SDK for Android only; package name + SHA-1 of
      both the Play app-signing key and your upload key.
- [ ] **iOS key** — Maps SDK for iOS only; bundle id.
- [ ] **Server key** — Directions, Geocoding, Distance Matrix only; IP
      restriction if the host has a fixed egress IP → backend
      `GOOGLE_MAPS_API_KEY`. Never in the app.

## 5. Push notifications and EAS variables

- [ ] Firebase (Android push), APNs (iOS push), and every EAS variable for
      the **preview** environment: `EAS_PREVIEW_SETUP.md` steps 4–9, with the
      exact commands.
- [ ] For **production**, the same variables are set with
      `--environment production` (the guide's commands already include it
      where the value is the same). Additionally set the production
      `EXPO_PUBLIC_API_BASE_URL` once the production API exists.

## 6. Crash reporting in release builds

- [ ] **Sentry's source-map upload is part of every release build** (preview
      and production). A local `bundleRelease` failed at that step without
      `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`. Either set all
      three, or set `SENTRY_DISABLE_AUTO_UPLOAD=true` — and then also leave
      `EXPO_PUBLIC_SENTRY_DSN` empty and untick Crash Data on both store
      forms.

## 7. Backend hosting and deploy

- [ ] HTTPS API domain, valid TLS, reverse proxy that **passes WebSocket
      upgrades** (Socket.IO).
- [ ] Node 20.10+, `NODE_ENV=production`, every variable in
      `backend/.env.example` (the server refuses to boot on a bad one).
      Production: `JWT_ACCESS_EXPIRES_IN=15m`, `OTP_PROVIDER=messagecentral`,
      `CORS_ORIGIN=` (empty) or your site, `DB_SSL=true` for managed MySQL,
      `TRUST_PROXY=1` (**required** — sign-in protection keys on the client's
      address; without it every user looks like the proxy).
- [ ] Optional: `REFRESH_REUSE_GRACE_SECONDS` (default 60) — how long a
      just-rotated refresh token is still accepted for simultaneous requests.
- [ ] Managed MySQL 8, **daily backups + point-in-time recovery**, ≥ 7 days;
      test one restore before launch.
- [ ] **Deploy**: `npm ci && npm run migrate`. This release adds migrations
      `20260928000001` … `20260928000005` (sessions + poll override, sandbox +
      indexes, per-source login throttle, delivered-by SET NULL, screenshot
      privacy). All are idempotent and were tested on a copy of real data and
      on an empty database. **Take a backup right before migrating.** Never
      `npm run seed` on production (it refuses).
- [ ] **Secure existing payment screenshots** (after the deploy):
      ```
      node scripts/secure-donation-screenshots.js          # dry run: how many
      node scripts/secure-donation-screenshots.js --apply  # convert
      ```
      New uploads are private already. Old public links stop working at once
      at the origin; copies cached by Cloudinary's CDN can keep serving for up
      to about an hour. `--revert` undoes it.
- [ ] Process manager that restarts on exit and sends SIGTERM on deploy.
- [ ] Uptime monitor on `/health` and `/health/ready`.
- [ ] Log retention ≤ 30 days (logs contain IP addresses; phones are masked).
- [ ] If still needed: `node scripts/purge-orphaned-staff.js --apply`.
- [ ] **Test database grant** so `npm test` can run next to the app's DB:
      `GRANT ALL PRIVILEGES ON \`sehri_connect_test\`.* TO 'sehri_user'@'localhost';`
      (This pass ran the suite on a throwaway MySQL instead: 87/87.)

## 8. Website (`E:\onemessage\policy _website`)

- [ ] **Redeploy** (canonical domain fixes; privacy policy and delete-account
      pages describe current deletion, crash reporting, phone visibility).
- [ ] **Reconcile the UPI ID** (`onemessage@axl` on the page vs
      `9632716392@axl` in the QR/backend), then a ₹1 test payment both ways.
- [ ] Optional wording for the privacy policy: payment screenshots are
      stored privately and shown only to the super admins who verify them.

## 9. Builds

- [ ] **Rebuild every dev client** — this release adds a native module
      (AsyncStorage, for offline prayer times/Qur'an/duas). An old
      development build will crash on the new JS.
- [ ] Local Android: `npx expo prebuild --clean` wipes `android/` including
      `local.properties` — set `ANDROID_HOME` permanently instead.
- [ ] Preview for testers: `EAS_PREVIEW_SETUP.md` steps 11–12 (Android APK
      and iOS ad hoc).
- [ ] Production: `eas build --profile production --platform all`, then
      `eas submit --profile production`.
- [ ] **iOS checks on the EAS build** (iOS cannot be built on Windows; the
      Android release build was verified locally). Download the `.ipa` from
      the EAS build page, rename to `.zip`, open `Payload/OneMessage.app` and
      check:
      - `Info.plist`: `UIBackgroundModes` = `location` only;
        `NSLocationWhenInUseUsageDescription` and
        `NSLocationAlwaysAndWhenInUseUsageDescription` are the texts from
        `app.config.js`; `NSPhotoLibraryUsageDescription` present; **no**
        camera, microphone, Face ID or motion strings;
        `ITSAppUsesNonExemptEncryption` = false; `UIDeviceFamily` = [1]
        (iPhone only); `CFBundleIdentifier` = your bundle id.
      - `PrivacyInfo.xcprivacy` exists and lists the collected types.
      - `GMSApiKey` / Maps key present (the Track map is blank without it).
      - `embedded.mobileprovision` has `aps-environment` = `production`.
      Then install from TestFlight and run `QA_TEST_PLAN.md` §5.10–5.12 and
      §11.2 on the iPhone (background tracking with the phone locked is the
      one thing no emulator can prove).
- [ ] Android: on the first EAS production build, open Play Console → App
      bundle explorer → the AAB → permissions, and confirm the list matches
      `STORE_COMPLIANCE.md` (no biometric, camera, microphone, background
      location).
- [ ] Before submitting: `npm test` in `backend/` and `npm run lint` +
      `npx tsc --noEmit` in `frontend/`.

## 10. QA pass

- [ ] Run `QA_TEST_PLAN.md` on one Android phone and one iPhone, all roles,
      then the Sentry and log checks at its end.

## 11. App Store Connect

Paste from `STORE_LISTING.md`:
- [ ] App record (bundle id), name, subtitle, description, keywords,
      promotional text; category **Lifestyle** / Reference.
- [ ] Privacy Policy, Support and Marketing URLs.
- [ ] App Privacy label (§9 there).
- [ ] Age rating questionnaire (§7 there).
- [ ] Screenshots 6.9" (§6 there).
- [ ] App Review information + notes — `APP_REVIEW_ACCESS.md` (turn on
      `REVIEW_DEMO_ENABLED` and sign in with both demo accounts first).
- [ ] Content rights: yes (Qur'an text/translation, duas — credited in-app).
- [ ] Availability: India.

## 12. Google Play Console

Paste from `STORE_LISTING.md`:
- [ ] Store listing, phone screenshots, feature graphic 1024×500, icon
      (`store-assets/play-store-icon-512.png`).
- [ ] App content: privacy policy · App access (`APP_REVIEW_ACCESS.md`) ·
      Ads: none · Content rating (§7) · Target audience 13+ · Data safety
      (§8) · Account deletion URL · Child safety URL + contact · Foreground
      service declaration (Location, user-initiated) with a ≤ 30 s video.
- [ ] Countries: India. Internal testing track first.

## 13. Operations during Ramadan

- [ ] Someone opens each night's poll at/after **10 pm IST** (Super admin →
      Polls → "Open tomorrow's poll"). Voting closes on its own at 10 am.
      "Open voting" on the current day's poll now extends it **until 10 pm at
      the latest**; after that the app says to open tomorrow's poll instead.
- [ ] After review is approved, set `REVIEW_DEMO_ENABLED=false`.
