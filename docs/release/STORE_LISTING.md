# Store submission package — ready to paste

Everything here was checked against what the app actually does (September
2026 code). Character counts are in brackets; the limits are Apple's and
Google's. **Read "Contradictions and risks" at the end before submitting** —
two items need a decision from you.

---

## 1. Names

| Field | Store | Text | Count / limit |
|---|---|---|---|
| App name | App Store | `OneMessage` | 10 / 30 |
| Subtitle | App Store | `Sehri, namaz times & Qur'an` | 27 / 30 |
| App name | Google Play | `OneMessage: Sehri & Namaz` | 25 / 30 |
| Short description | Google Play | `Sehri poll, namaz times, Qur'an, duas and chat for our Bangalore community.` | 75 / 80 |
| Promotional text | App Store (editable any time, no review) | `Tonight's Sehri poll, today's namaz times and a verse of the day — plus the Qur'an, duas and your community's chat, in one place.` | 129 / 170 |

## 2. Full description (both stores)

Paste as plain text. [2,165 / 4,000]

```
OneMessage is the community app for our Muslim residential community in Bangalore — the PGs, hostels and homes around the masjid. It brings the nightly Sehri arrangements, prayer times, the Qur'an and duas, and the community's conversations into one place.

SEHRI, SORTED EVERY NIGHT
During Ramadan the kitchen asks one question each night: do you need Sehri tomorrow? Answer yes or no in a tap between 10 PM and 10 AM, change your mind until voting closes, and ask for special arrangements during the day. The kitchen sees the numbers for each building, so no food is wasted and nobody is missed.

FOLLOW YOUR DELIVERY
When the delivery volunteers start their round you get a notification, and you can follow them on a live map with an estimated arrival time for your building. You get a heads-up when they are a few minutes away.

NAMAZ TIMES AND A VERSE EACH DAY
Today's prayer times for Bangalore with a live countdown to the next namaz, and a verse of the Qur'an each day with its translation. Both stay available offline once loaded.

THE QUR'AN AND DUAS
Read all 114 surahs in Arabic with the Saheeh International English translation, and a collection of everyday duas with Arabic, transliteration and meaning. Sources are credited in the app.

YOUR COMMUNITY'S CHAT
A group chat for your area, moderated by community volunteers. Long-press any message to report it or block the sender.

SUPPORT THE KITCHEN
Donate to the Sehri kitchen outside OneMessage: the app opens the payment details in your browser, you pay with any UPI app, then upload the payment screenshot so a volunteer can confirm it. OneMessage never handles your money.

TRY IT WITHOUT AN ACCOUNT
Continue as a guest to see prayer times, the Qur'an, duas and the verse of the day. Membership (the poll, chat, tracking and donations) is for residents of the community and is approved by its volunteers.

PRIVACY
We collect what the community needs to feed you — your name, phone number and where you stay — and nothing for advertising. Members' location is never read; only delivery volunteers share theirs, and only while they are delivering. You can delete your account from your profile at any time.

OneMessage is run by volunteers of the community.
```

## 3. Keywords (App Store only)

`sehri,suhoor,ramadan,namaz,salah,prayer times,quran,dua,iftar,masjid,muslim,community,bangalore`
[95 / 100 — commas, no spaces after them; the app name and category are indexed already, so they are not repeated]

## 4. Category

| Store | Primary | Secondary / tags |
|---|---|---|
| App Store | **Lifestyle** | Reference |
| Google Play | **Lifestyle** | Tags (pick up to 5 offered): Religion, Community, Food & drink, Prayer, Ramadan — use whichever of these Play offers |

## 5. URLs

| Field | URL |
|---|---|
| Privacy policy (both) | `https://onemessage-official.vercel.app/privacy-policy` |
| Support URL (Apple, required) | `https://onemessage-official.vercel.app/support` |
| Marketing URL (Apple, optional) | `https://onemessage-official.vercel.app` |
| Account deletion (Play) | `https://onemessage-official.vercel.app/delete-account` |
| Child safety standards (Play) | `https://onemessage-official.vercel.app/child-safety` |

Confirm each loads after the website redeploy (LAUNCH_CHECKLIST §8).

## 6. Screenshot shot list

**Rules for every shot:** use the sandbox/test accounts with invented names
(no real member's name, phone, building or chat text — those are personal
data), status bar clean (full battery, signal, a sensible time like 4:12 AM
for the Sehri shots), light mode, default text size. Screenshots must show
the real app on that platform. The Donate shot shows the "View payment
details" button on both platforms — the app no longer displays a UPI number.

### Sizes

| Store | Device class | Pixels (portrait) | How many | Required? |
|---|---|---|---|---|
| App Store | iPhone 6.9" (16/17 Pro Max, 16/17 Plus) | 1320 × 2868 (or 1290 × 2796) | 3–10 | **Yes** — Apple scales these down for smaller iPhones |
| App Store | iPhone 6.5" | 1284 × 2778 (or 1242 × 2688) | 3–10 | Only if you don't supply 6.9" |
| App Store | iPad | — | — | **No** — the app is iPhone-only (`supportsTablet: false`) |
| Google Play | Phone | 1080 × 1920 to 1080 × 2400 (9:16 to 9:20) | 4–8 | **Yes** (minimum 2; 4+ for better placement) |
| Google Play | Feature graphic | 1024 × 500 | 1 | **Yes** |
| Google Play | App icon | 512 × 512 | 1 | **Yes** — `store-assets/play-store-icon-512.png` |
| Google Play | Tablet (7", 10") | — | — | No — leave empty |

### Shots, in order (same set on both stores)

| # | Screen | Account | What must be visible | Caption (optional overlay, ≤ 5 words) |
|---|---|---|---|---|
| 1 | Home, voting open | member | Greeting, namaz countdown card, Ayat card, poll card with Yes/No | "Tonight's Sehri, one tap" |
| 2 | Home after voting Yes | member | Poll card showing "Yes" selected, phase chip | "Change your mind till 10 AM" |
| 3 | Namaz times sheet | member or guest | Full day's timeline, "now" pill | "Namaz times, live countdown" |
| 4 | Qur'an reader | guest | Surah title, Bismillah, 2–3 verses Arabic + translation | "All 114 surahs" |
| 5 | Dua category, one expanded | guest | Arabic, transliteration, meaning | "Everyday duas" |
| 6 | Track | member (during a test round) | Map with rider marker, building pin, ETA line | "Follow your delivery live" |
| 7 | Zone chat with the long-press menu open | member | A few friendly messages (test names), menu showing **Report** and **Block** | "Moderated community chat" |
| 8 | Donate | member | Step 1 with "View payment details", steps 2–3 (amount, screenshot) below | "Support the kitchen" |

Shot 7 doubles as evidence for App Review 1.2 (report/block visible).
Do **not** use a rider or admin screen as a listing screenshot — those roles
are for volunteers, and showing them invites "can't access this feature"
questions.

## 7. Age rating

### App Store Connect — age rating questionnaire (current 2026 form)

| Question | Answer | Why |
|---|---|---|
| Parental controls | No | — |
| Age assurance | No | — |
| Unrestricted web access | **No** | Links open specific pages in the system browser (Safari); there is no in-app browser to arbitrary sites |
| User-generated content | **Yes** | Group chat |
| Messaging and chat | **Yes** | Group chat |
| Advertising | No | No ads |
| Profanity or crude humour | None | Filtered; nothing in the app's own content |
| Horror / fear themes | None | — |
| Alcohol, tobacco or drug use or references | None | — |
| Mature or suggestive themes | None | — |
| Medical or treatment information | None | — |
| Health or wellness topics | No | — |
| Sexual content or nudity | None | — |
| Cartoon / realistic violence | None | — |
| Gambling / simulated gambling / contests | None | — |

Apple calculates the rating from these answers; with user-generated content
and messaging, expect a teen rating. Do not lower it with an override.

### Google Play — content rating (IARC questionnaire)

- Category: **All other app types** (it is not a game, and not primarily a social network).
- Violence, fear, sexuality, language, controlled substances, crude humour, gambling: **No** to all.
- "Does the app natively allow users to interact or exchange content with other users?" **Yes** (chat).
- "Does the app share the user's current physical location with other users?" **Yes** — delivery volunteers' location is shown to members during a round. (Members' location is never collected.)
- "Does the app allow users to purchase digital goods?" **No**.
- "Does the app contain unrestricted internet access?" **No**.
- Expected interactive elements on the listing: *Users Interact, Shares Location*.

### Google Play — target audience and content

- Target age groups: **13–15, 16–17, 18 and over**. Not "designed for children"; the app does not appeal to children under 13.
- Ads: **No ads**.
- News app: **No**. Government app: **No**. Financial features: **None** (the app opens a web page with the payment details; donors pay in their own UPI app). Health: **No**.

## 8. Google Play — Data safety form

Matches `DATA_INVENTORY.md`. Section by section:

**Data collection and security**
- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes**
- Which of the following methods of account creation does your app support? **Username and password** (phone number + password; OTP verification)
- Do you provide a way for users to request that their data is deleted? **Yes** — delete-account URL above; in-app: Profile → Delete account
- (If asked) Independent security review: **No**. Families policy: **not applicable**.

**Data types** — for each: *Collected: Yes · Shared: No · Processed ephemerally: No*

| Category → type | Required or optional | Purposes |
|---|---|---|
| Personal info → Name | Required | App functionality, Account management |
| Personal info → Phone number | Required | App functionality, Account management |
| Personal info → Address | Required | App functionality |
| Personal info → User IDs | Required | App functionality, Account management |
| Personal info → Other info (gender, occupation) | Required | App functionality |
| Location → Precise location | Optional *(only delivery volunteers, only during a round they start; members never)* | App functionality |
| Financial info → Other financial info (donation amounts) | Optional | App functionality |
| Photos and videos → Photos (payment screenshot) | Optional | App functionality |
| Messages → Other in-app messages (chat) | Optional | App functionality |
| App activity → Other user-generated content (poll answers, feedback) | Required | App functionality |
| App info and performance → Crash logs, Diagnostics *(only if Sentry DSN is set in the build — it is, per the checklist)* | Collected automatically — mark **Required** (users can't turn it off) | App functionality |
| Device or other IDs → Device or other IDs (push token) | Optional | App functionality |

**Not collected:** email, contacts, calendar, approximate location, web
browsing, installed apps, health, fitness, audio, files, search history,
advertising ID, purchase history, credit info.

**Shared:** none. Every recipient (SMS provider, Google Maps, Expo/FCM/APNs,
Cloudinary, Sentry, the host) is a service provider acting on your behalf,
which Play excludes from "sharing". A volunteer's position shown to members
during a round they started is a user-initiated transfer the user expects,
which Play also excludes.

## 9. App Store Connect — App Privacy ("nutrition label")

- **Do you or your third-party partners collect data from this app?** Yes
- **Tracking:** No (no data is used to track users across apps or websites; no ATT prompt).

For every type below: **Linked to the user's identity: Yes · Used for tracking: No · Purpose: App Functionality** — except **Crash Data: Linked: No**.

| Apple category | Data type to tick |
|---|---|
| Contact Info | Name · Phone Number · Physical Address |
| Location | Precise Location |
| User Content | Emails or Text Messages *(chat)* · Photos or Videos · Other User Content *(poll answers)* · Customer Support *(feedback)* |
| Financial Info | Other Financial Info *(donation amounts)* |
| Identifiers | User ID · Device ID *(push token)* |
| Diagnostics | Crash Data |
| Other Data | Other Data Types *(gender, occupation)* |

These now match the iOS privacy manifest in `frontend/app.config.js`
(Emails or Text Messages and Other Data Types were added in this pass — they
were on the label list but missing from the manifest).

## 10. Review notes and reviewer access

Paste from `docs/release/APP_REVIEW_ACCESS.md` — the App Store notes block
and the Play "App access" block. They are kept in that one file so they
cannot drift from this one. Before pasting, replace every `<REVIEW_DEMO_…>`
placeholder with the real values from the server, and sign in once with each
demo account yourself.

Also for Play → App content:

- **Foreground service permission** declaration: type *Location*, task
  "User-initiated location sharing — a delivery volunteer shares their
  position with the members they are delivering to, from when they tap Start
  delivery until they tap Stop (or 10 hours at most)". Attach a ≤ 30 s screen
  recording: rider taps Start delivery → the persistent notification appears
  → rider taps Stop → it disappears.
- **Background location**: not requested — do not fill in the background
  location declaration.
- **Government / financial / health declarations**: not applicable.

## 11. Contradictions and risks found while preparing this

1. **Donations and Google Play's Payments policy — resolved by design.**
   Play exempts only *"tax exempt donations"* from its billing requirement
   (Payments policy, §3.2), and the UPI ID in use looks like a personal
   number (`9632716392@axl`). The app now behaves the same on Android as on
   iOS: "View payment details" opens the hosted payment page in the system
   browser, and the app itself shows no payment number and starts no payment
   — it only takes the screenshot afterwards. This satisfies Apple 3.2.2(iv)
   and keeps the payment step off Play entirely. Residual: if a Play reviewer
   still asks, the answer is in the review notes ("the app never processes
   payments; it links to a web page"). If the kitchen is a registered
   tax-exempt trust/society, saying so there removes all doubt.
2. **UPI ID mismatch** between the website donation page (`onemessage@axl`)
   and the QR/backend (`9632716392@axl`) — already on the launch checklist;
   must be resolved before screenshots of the Donate screen are taken.
3. **iOS privacy manifest was missing two declared types** (Other Data Types
   for gender/occupation; chat as Emails or Text Messages). Fixed in
   `app.config.js`; takes effect in the next build.
4. **Permissions list in `STORE_COMPLIANCE.md` was incomplete.** The release
   build also carries `READ/WRITE_EXTERNAL_STORAGE` capped at Android 12
   (from the image picker, used for the payment screenshot on older phones),
   plus `INTERNET`, `VIBRATE` and library permissions. None needs a Play
   declaration; the document is corrected. See the merged-manifest check in
   the QA report.
5. **Seasonal features.** The description says the poll runs "during
   Ramadan" and the review notes explain the 10 PM–10 AM window. If you
   submit outside Ramadan, reviewers will see the poll as closed — that is
   expected and explained; do not remove the explanation.
6. **Crash reporting must be declared only if it is on.** Sections 8 and 9
   include Crash Data because the checklist sets `EXPO_PUBLIC_SENTRY_DSN`. If
   you ship without Sentry, untick Crash Data / Crash logs on both forms.
7. **Screenshots at 6.5".** The old checklist asked for 6.9" *and* 6.5";
   Apple only needs 6.9" now (it scales them). Supplying both is harmless.
