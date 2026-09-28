# Launch checklist — everything that happens outside the codebase

Work top to bottom; later items depend on earlier ones. Nothing here is
done until you have done it.

## 1. Rotate every credential that has been exposed

These have been in chat transcripts and/or git history. Treat them as
public. Rotate, then update the server `.env` and EAS variables.

- [ ] **Google Maps API keys** — `AIzaSyAWQ…8go` (current, in git history in
      `app.json` / `AndroidManifest.xml`) and `AIzaSyCoa…phw` (older, also in
      history). Delete both; create new, restricted keys (step 4).
- [ ] **MySQL password** for `sehri_user` (and create a separate production user).
- [ ] **JWT_SECRET** and **JWT_REFRESH_SECRET** — new, different, 48+ random
      bytes each. Rotating signs everyone out once; that is expected.
- [ ] **MessageCentral** auth token (and customer id if they allow it).
- [ ] **Cloudinary** API secret (Settings → Access keys → regenerate).
- [ ] Optional hygiene: git history still contains the old keys. Rewriting
      history (git filter-repo) is only worth it if the repo will ever be
      public; rotation is what actually protects you.

## 2. Decide the permanent identifiers

- [ ] **Bundle identifier / package name** — permanent once published.
      Suggested: `in.onemessage.app` (or `com.<your-org>.onemessage`). Set
      it in `frontend/eas.json` → `build.production.env.APP_BUNDLE_ID`
      (the production build refuses the placeholder).
- [ ] App name on the stores: **OneMessage** (matches the icon, website and
      `app.config.js`).

## 3. Accounts

- [ ] **Apple Developer Program** (organization if you can get a D-U-N-S
      number — it shows the organization as seller; individual is fine).
- [ ] **Google Play Console**. If it is a *personal* account created after
      Nov 2023: plan a **closed test with ≥12 testers for 14 consecutive
      days** before you can request production access.
- [ ] **Expo / EAS**: `cd frontend && npx eas-cli login && npx eas-cli init`.
      Copy the project id into the EAS variable `EAS_PROJECT_ID` (and your
      `.env` for local builds).
- [ ] **Sentry** (optional but recommended): create a React Native project,
      copy the DSN. In Sentry settings turn on data scrubbing, turn off IP
      address storage, set retention to 90 days.

## 4. Google Cloud (Maps)

- [ ] Billing account attached; **budget alert** (e.g. ₹2,000/month) and
      per-API **daily quota caps** (Directions ~2,000/day is ample now that
      ETAs use one route call per minute per team).
- [ ] **Android key** — restrict to *Maps SDK for Android*, app restriction
      = package name + SHA-1 of **both** the Play *app signing* key (Play
      Console → App integrity) and your upload key (`eas credentials`).
- [ ] **iOS key** — restrict to *Maps SDK for iOS*, bundle id.
- [ ] **Server key** — *Directions, Geocoding, Distance Matrix* only; IP
      restriction if your host has a fixed egress IP. Goes in the backend
      `GOOGLE_MAPS_API_KEY`. Never ship it in the app.

## 5. Push notifications

- [ ] **Android (FCM)**: create a Firebase project, add the Android app
      (your package name), download `google-services.json`, upload it as an
      EAS *file* variable: `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production`.
      Upload the FCM V1 service-account key: `eas credentials` → Android →
      Push Notifications.
- [ ] **iOS (APNs)**: `eas credentials` → iOS → Push Notifications → let EAS
      create the APNs key.

## 6. EAS environment variables (per environment: development / preview / production)

```
EXPO_PUBLIC_API_BASE_URL   https://api.<your-domain>/api      (plain text)
EXPO_PUBLIC_SENTRY_DSN     <dsn>                              (plain text)
GOOGLE_MAPS_ANDROID_API_KEY / GOOGLE_MAPS_IOS_API_KEY         (sensitive)
EAS_PROJECT_ID, EXPO_OWNER                                    (plain text)
SENTRY_ORG, SENTRY_PROJECT (plain) · SENTRY_AUTH_TOKEN (secret) — for source maps
GOOGLE_SERVICES_JSON                                          (file, Android)
```

## 7. Backend hosting

- [ ] HTTPS domain for the API (e.g. `api.<domain>`), valid TLS, reverse
      proxy that **passes WebSocket upgrades** (Socket.IO).
- [ ] Node 20.10+; `NODE_ENV=production`; every variable in
      `backend/.env.example`. The server refuses to boot on a bad one and
      lists what is wrong. Key production values: `JWT_ACCESS_EXPIRES_IN=15m`,
      `OTP_PROVIDER=messagecentral`, `CORS_ORIGIN=` (empty) or your website,
      `DB_SSL=true` for managed MySQL, `TRUST_PROXY=1`.
- [ ] Managed MySQL 8 with **automated daily backups + point-in-time
      recovery**, retention ≥ 7 days; test a restore once before launch.
- [ ] `npm ci && npm run migrate` on deploy. Never `npm run seed` on
      production (it now refuses without an explicit override).
- [ ] A process manager / platform that restarts on exit and sends SIGTERM
      on deploy (graceful shutdown is implemented).
- [ ] Uptime monitor on `/health` (liveness) and `/health/ready` (database).
- [ ] Log retention: console logs are collected by the platform; keep them
      ≤ 30 days (they contain IP addresses; phone numbers are masked).
- [ ] Run the one-off cleanup from earlier work if still needed:
      `node scripts/purge-orphaned-staff.js --apply`.

## 8. Website (`E:\onemessage\policy _website`)

- [ ] **Redeploy** — canonical/sitemap domain fixes, and the privacy policy
      and delete-account pages now describe the current deletion behaviour,
      crash reporting and phone-number visibility.
- [ ] **Reconcile the UPI ID** on the donation page (`onemessage@axl` vs the
      QR / backend `9632716392@axl`), then a ₹1 test payment both ways.

## 9. Builds

- [ ] Local development: the native `android/` folder is no longer tracked
      (it is generated). Regenerate before a local build:
      `npx expo prebuild --clean` then `npx expo run:android`.
- [ ] Development build: `eas build --profile development --platform all`.
- [ ] Preview (internal testers): `eas build --profile preview --platform android`.
- [ ] Production: `eas build --profile production --platform all`, then
      `eas submit --profile production`.
- [ ] Before submitting, run `npm test` in `backend/` (needs
      `GRANT ALL PRIVILEGES ON \`sehri_connect_test\`.* TO 'sehri_user'@'localhost';`)
      and `npm run lint` in `frontend/`.

## 10. App Store Connect

- [ ] App record with the bundle id; category **Lifestyle** (secondary: Reference).
- [ ] Privacy Policy URL, Support URL, Marketing URL (see root README table).
- [ ] App Privacy label — `docs/release/DATA_INVENTORY.md`.
- [ ] Age rating questionnaire (UGC: yes; messaging: yes).
- [ ] App Review information + notes — `docs/release/APP_REVIEW_ACCESS.md`
      (turn on `REVIEW_DEMO_ENABLED` on the server first).
- [ ] Screenshots: 6.9" and 6.5" iPhone only (the app is iPhone-only).
      They must show the real app; include Home, Qur'an, Chat, Donate, Track.
- [ ] Content rights: yes, it shows third-party content you are entitled to
      use (Qur'an text/translation, duas — credited in-app).
- [ ] Availability: India (avoids EU trader-status requirements for now).

## 11. Google Play Console

- [ ] Store listing, screenshots (phone), feature graphic (1024×500), icon
      (512×512 — `store-assets/play-store-icon-512.png`).
- [ ] App content: Privacy policy · **App access** (text in
      `APP_REVIEW_ACCESS.md`) · Ads: none · Content rating (IARC): users
      interact, **shares location** (riders), user-generated content ·
      Target audience: 13+ · Data safety (`DATA_INVENTORY.md`) · Account
      deletion URL · Child safety standards URL + contact · Foreground
      service: *Location — user-initiated location sharing*, with a ≤30 s
      video of a rider tapping Start delivery and the notification showing.
- [ ] Internal testing track first (`eas submit` sends production builds to
      *internal*, as a draft).

## 12. Operations during Ramadan

- [ ] Someone opens each night's poll at/after **10 pm IST** (Super admin →
      Polls → "Open tomorrow's poll"). There is no scheduler; voting then
      closes on its own at 10 am and the rest of the day follows the schedule.
- [ ] After review is approved, set `REVIEW_DEMO_ENABLED=false`.
