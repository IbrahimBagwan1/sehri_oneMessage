# Store rules that apply to OneMessage — and where the app stands

Checked against the current published policies (September 2026):
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ·
[Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/) ·
[Required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api) ·
[Play target API](https://developer.android.com/google/play/requirements/target-sdk) ·
[Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) ·
[Play background location](https://support.google.com/googleplay/android-developer/answer/9799150) ·
[Play foreground service types](https://support.google.com/googleplay/android-developer/answer/13392821) ·
[Play User Generated Content](https://support.google.com/googleplay/android-developer/answer/9876937).

"Code" is the state of the repository; "You" is console work only you can do.

## Apple

| Rule | Why it applies | Code | You |
|---|---|---|---|
| **1.2 UGC** — filter, report, block, published contact | Group chat | ✅ server-side content filter (`contentFilter.js`), long-press Report / Block (also as a screen-reader action), moderation queue with delete + ban, contact on `/support` linked in-app | — |
| **1.1.5** accurate religious text | Qur'an, duas | ✅ established sources, credited in-app (Profile → Legal & support → Sources & credits; also from the Qur'an and Dua tabs) | — |
| **2.1** demo account, backend live | OTP + approval | ✅ sandboxed reviewer accounts (`docs/release/APP_REVIEW_ACCESS.md`) | turn on `REVIEW_DEMO_ENABLED`, paste the notes |
| **2.5.4 / 5.1.5** location only when relevant; background modes only for their purpose | Rider tracking | ✅ "While Using" only, never "Always"; `UIBackgroundModes` = `location` only (the unused `fetch` mode is stripped); blue indicator; auto-stop after 10 h | explain in review notes (text provided) |
| **3.2.2(iv)** charity funds only outside the app | Donations | ✅ "View payment details" opens the website home page (UPI ID + QR) in Safari; the app shows no payment number and has no in-app payment | — |
| **4.2** minimum functionality | — | ✅ guest mode: prayer times, Qur'an, duas, verse of the day | — |
| **4.8** login services | Phone + password only | ✅ not applicable (no third-party sign-in) | — |
| **5.1.1(i)** privacy policy in listing and in app | — | ✅ sign-in footer, registration consent, Profile | set the URL in App Store Connect |
| **5.1.1(v)** in-app account deletion | Self-registration | ✅ full erasure incl. chat text, blocks, screenshots, sessions (tested) | — |
| **5.1.2** no repurposing, no tracking | — | ✅ no ads, no analytics, no ATT needed; crash reports scrubbed and unlinked | — |
| Privacy manifest + specific purpose strings | Every upload | ✅ `privacyManifests` in `app.config.js` (collected types match `DATA_INVENTORY.md`, incl. chat and gender/occupation); purpose strings for location and photos only; Face ID / Motion / camera / microphone strings removed | — |
| Xcode 26 / iOS 26 SDK (since 28 Apr 2026) | Every upload | ✅ with EAS's current default image | build on EAS |
| Updated age-rating questionnaire (since 31 Jan 2026) | UGC, messaging | — | answer it: user-generated content **yes**, messaging **yes** |
| Export compliance | HTTPS only | ✅ `ITSAppUsesNonExemptEncryption: false` | — |
| EU DSA trader status | Only if distributed in the EU | — | limit distribution to India, or provide trader details |

## Google Play

| Rule | Why it applies | Code | You |
|---|---|---|---|
| **Target API 36** (since 31 Aug 2026) | Every upload | ✅ Expo SDK 57 targets 36 | — |
| **AAB, 64-bit** | — | ✅ `eas.json` production → `app-bundle` | — |
| **UGC**: terms accepted before posting, reporting, blocking, moderation | Chat | ✅ consent at registration, report, block, moderation queue, filter | — |
| **Account deletion**: in-app + web URL | Accounts | ✅ both; web page lists what is kept | set the URL in Data safety |
| **Permissions minimal** | — | ✅ runtime prompts only for location (while in use) and notifications. Declared by the app: coarse/fine location, FOREGROUND_SERVICE(+_LOCATION), POST_NOTIFICATIONS. Added by libraries, no prompt: INTERNET, network state, vibrate, wake lock, boot-completed (notifications), launcher-badge permissions, install referrer, and READ/WRITE_EXTERNAL_STORAGE **only on Android 12 and older** (image picker, for the payment screenshot). Explicitly **blocked**: background location, camera, microphone, overlay, media, biometric. Checked in the merged release manifest (local `bundleRelease`, 28 Sep 2026) | — |
| **Background location** declaration | Would apply only if requested | ✅ not requested — the feed is a user-started foreground service | none needed |
| **Foreground service type** declaration (Android 14+) | Rider feed | ✅ `location` type, user-initiated, ends on Stop or after 10 h | declare "Location — user-initiated location sharing" + short video |
| **Notifications** (Android 13+) | Push | ✅ channel created before the runtime prompt | — |
| **Payments policy** — Play billing is not required for *tax-exempt* donations | Donate | ✅ same as iOS: the app opens the website home page in the system browser and shows no payment number; payment happens in the donor's UPI app; the app only accepts the screenshot afterwards | if the kitchen is a registered tax-exempt body, say so in the review notes (optional) |
| **Child Safety Standards** | Chat | ✅ `/child-safety` page | set the URL, name a contact |
| **Data safety** accurate | — | ✅ inventory in `DATA_INVENTORY.md` | fill in the form |
| **Target audience** | Chat, not for children | — | 13+ only; not "designed for children" |
| **New personal developer accounts** | Accounts created after Nov 2023 | — | closed test with ≥12 testers for 14 days before production access |

## Items that were failing at the start of the audit, now fixed

No filter (1.2); no reviewer path (2.1); "Always" location and a declared
`ACCESS_BACKGROUND_LOCATION`; a stale committed `android/` project that
shipped microphone/overlay/storage permissions and lacked the notification
and foreground-service permissions; generic purpose strings and no privacy
manifest; incomplete account deletion; placeholder app name and no build
configuration.
