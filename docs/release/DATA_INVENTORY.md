# Data inventory — for Apple's App Privacy label and Google Play's Data safety form

Derived from the code (models, controllers, the app's API calls), not from
intent. Where the answer depends on a setting, it says so. Re-check this
file whenever a model gains a column or the app gains an SDK.

## What is collected, per data type

| Data | Who it's about | Where it lives | Why | Optional? |
|---|---|---|---|---|
| **Name** | members, staff, riders | `users.name`, `admins`/`super_admins`/`riders.name` | Account; shown in chat and to the kitchen/rider | Required |
| **Phone number** | everyone with an account | `*.phone`, `otps.phone` (minutes), `login_throttles.phone` (transient) | Sign-in identifier; OTP verification; riders/admins call members about deliveries | Required |
| **Password** | everyone with an account | bcrypt hash only | Sign-in | Required |
| **Address** | members | `users.location_id` (building/PG picked from a list) + `users.address` (free text: room, landmark) | Where the Sehri is delivered | Required |
| **Gender, occupation** | members | `users.gender`, `users.occupation` | Community admin (e.g. girls' accommodation) | Required |
| **Precise location** | **riders only, only during a delivery round** | `riders.latitude/longitude` (latest reading only, no history), `riders.current_address` (reverse-geocoded label) | Live tracking for the members being delivered to; ETAs | Required to deliver; never collected from members |
| **Photos** | members who donate | Cloudinary (`donations.screenshot_url`) | Payment screenshot so a super admin can verify the donation | Optional (donating is optional) |
| **Other financial info** | members who donate | `donations.amount`, `note`, `status` | Donation records | Optional |
| **Chat messages** | members, staff | `chat_messages.content`; `chat_message_reports` (snapshot + reason); `chat_user_blocks` | Group chat; moderation | Optional |
| **Other user content** | members | `poll_responses` (nightly yes/no, special-case requests), `profile_edit_requests` | Core function (how much food, where) | Required to use the poll |
| **Customer support** | members | `feedback.message` | Feedback/complaints | Optional |
| **User ID** | everyone | account UUIDs; `auth_sessions` (session id, timestamps — no device info, no IP) | Account, sessions | Required |
| **Device ID (push token)** | anyone who allows notifications | `users.fcm_token` (Expo push token) | Push notifications | Optional (notification permission) |
| **Crash data** | anyone, **only if `EXPO_PUBLIC_SENTRY_DSN` is set** | Sentry | Fix crashes. Scrubbed: no user identity, phone numbers/tokens masked, no screenshots | Collected automatically; not linked to identity |

**Not collected:** advertising IDs, contacts, calendar, camera, microphone,
health, browsing history, search history, precise or approximate location of
members, payment credentials (UPI happens outside the app), religious
affiliation (no field records it).

**Server logs** record request lines (method, path, status, IP address) for
security and diagnostics; phone numbers, tokens and JWTs are masked by the
logger. Not a Data safety data type; mentioned here for completeness.

## Who else receives it (service providers, not "sharing")

| Provider | Receives | Purpose |
|---|---|---|
| MessageCentral | phone number | send the OTP SMS |
| Google Maps Platform | building coordinates; rider position | routes, ETAs, reverse geocoding |
| Expo Push → APNs / FCM | push token, notification text | deliver notifications |
| Cloudinary | donation screenshot | store it for verification |
| Sentry (optional) | scrubbed crash reports | crash diagnostics |
| Your hosting / MySQL provider | everything above, at rest | run the service |

Other members see: a member's **name** and **messages** in their zone chat.
Staff (admins, super admins) also see phone numbers. Riders see the name,
phone, building and address of the members on their route.

## Apple — App Privacy ("nutrition label")

Tracking: **No** (no data is used for tracking; no ATT prompt needed).

For every type below: **Linked to the user: Yes**, **Used for tracking: No**,
**Purpose: App Functionality** — except Crash Data (Linked: **No**).

| Apple category | Data type |
|---|---|
| Contact Info | Name · Phone Number · Physical Address |
| Location | Precise Location *(riders)* |
| User Content | Photos or Videos · Other User Content · Customer Support |
| Financial Info | Other Financial Info |
| Identifiers | User ID · Device ID |
| Diagnostics | Crash Data *(only if Sentry is enabled — otherwise leave it out)* |
| Other Data | Other Data Types *(gender, occupation)* |

The iOS privacy manifest (`NSPrivacyCollectedDataTypes` in
`frontend/app.config.js`) declares the same set; keep them in step.

## Google Play — Data safety

- Does your app collect or share any of the required user data types? **Yes**
- Is all user data encrypted in transit? **Yes** (the app refuses non-HTTPS API URLs in release builds)
- Do you provide a way for users to request that their data is deleted? **Yes** — in-app (Profile → Delete account) and `https://onemessage-official.vercel.app/delete-account`

**Shared with third parties: none** (every recipient above is a service
provider acting on your behalf, which Play excludes from "sharing").

**Collected** (all: *processed ephemerally: No*, *purpose: App functionality*, plus *Account management* where noted):

| Play category | Data type | Required / optional |
|---|---|---|
| Personal info | Name *(+ account management)* | Required |
| Personal info | Phone number *(+ account management)* | Required |
| Personal info | Address | Required |
| Personal info | Other info (gender, occupation) | Required |
| Personal info | User IDs *(+ account management)* | Required |
| Location | Precise location — riders only | Optional *(only staff riders; members never)* |
| Financial info | Other financial info (donation amounts) | Optional |
| Photos and videos | Photos (payment screenshot) | Optional |
| Messages | Other in-app messages (chat) | Optional |
| App activity | Other user-generated content (poll answers, feedback) | Required |
| App info and performance | Crash logs, Diagnostics *(only if Sentry is enabled)* | Collected automatically |
| Device or other IDs | Device or other IDs (push token) | Optional |

## Retention (matches the privacy policy)

- Account data: until the account is deleted.
- OTP codes: minutes. Login throttle rows: cleared on success or reset.
- Sessions: ended by sign-out, password reset or deletion; rows purged 7 days after ending.
- Poll answers, donations, feedback: kept, detached from the person on deletion (donation screenshot deleted, note cleared).
- Chat messages: kept for the group; a deleted account's messages are overwritten with `[deleted]`.
- Moderation reports: kept as a safety record; the reported person's name is replaced with "Former member" if they delete their account.
- Rider position: latest reading only.
- Crash reports: per Sentry's retention (set it to 90 days or less).
