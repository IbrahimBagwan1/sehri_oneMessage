# QA test plan — one Android phone and one iPhone

A manual pass for a release candidate. Run every section on **both** phones
unless it says otherwise. Tick as you go; write the build number at the top of
your copy and note anything that fails with the time (IST), the phone and the
account, so it can be matched to server logs and Sentry.

**Build under test:** `eas build --profile preview` (Android APK) and a
TestFlight build from `--profile production` (iOS). Preview and production use
the same code; production is what reviewers get.

## 0. Before you start

### Devices

| | Android | iPhone |
|---|---|---|
| Ideally | Android 13 or newer (for the notification prompt), a mid-range phone | iOS 26, any model; a small one (SE / mini) is best for layout |
| Also useful | an Android 12 phone for the pre-13 path (no notification prompt) | — |

Uninstall any older OneMessage build first on both phones (the new build
moves where the sign-in is stored; a clean install is the realistic case for
new members, and §11 covers the upgrade case).

### Server

- Staging API with the release's backend deployed and **migrations run**
  (`npm run migrate` — the release adds five: per-source login throttle,
  delivered-by → SET NULL, donation screenshot privacy, plus the session and
  sandbox ones).
- `REVIEW_DEMO_ENABLED=true` with the five `REVIEW_DEMO_*` values set (§9).
- A real Google Maps server key (`GOOGLE_MAPS_API_KEY`) — ETAs need it.
- Cloudinary configured (donation screenshots).
- `EXPO_PUBLIC_SENTRY_DSN` set in the build, so crashes reach Sentry.

### Accounts you need

| Role | How to get it |
|---|---|
| Guest | none — "Continue as guest" |
| Member A, Member B | register two real numbers you control (§2), approve them as admin |
| Admin | an existing admin, or Super admin → Admins → create |
| Super admin | an existing super admin |
| Rider captain + Rider helper | Super admin → Riders → create two riders; Delivery teams → make one captain with a zone that contains Member A's building, add the other as helper |
| Reviewer demo member / rider | the `REVIEW_DEMO_*` numbers (§9) |

### A poll to test with

Most of the day's flow depends on a poll being open. Do the poll sections
between **10 pm and 10 am IST**, or ask a super admin to open one ("Open
tomorrow's poll" works from 10 pm; before that, "Open voting" extends the
current day's poll until 10 pm at the latest).

---

## 1. Guest (both phones)

| # | Step | Expected |
|---|---|---|
| 1.1 | Fresh install → open app | Sign-in screen: logo, phone + password fields, "Continue as guest", links to Privacy Policy / Terms / Community Guidelines at the bottom |
| 1.2 | Tap **Continue as guest** | Home: greeting "welcome to OneMessage", today's namaz card with a live countdown, Ayat of the day, a "Sign in to vote" invite where the poll would be |
| 1.3 | Tap the namaz card | Sheet with the full day's times; current namaz marked "now". Swipe down / tap outside closes it |
| 1.4 | Qur'an tab → search "baqarah" → open Al-Baqarah | Reader opens; Arabic right-aligned in the Amiri font, translation under each verse, verse markers in Arabic digits |
| 1.5 | Dua tab → a category → expand a dua | Arabic, transliteration and translation; source credited |
| 1.6 | Chat / Donate / Track tabs | Each shows a "for members" message with a Sign in button — no crash, no empty screen |
| 1.7 | Profile / sign out path | Guest can get back to the sign-in screen |

## 2. Member (user)

### Registration and approval

| # | Step | Expected |
|---|---|---|
| 2.1 | Sign-in → "Create account" → enter your number → Send code | SMS arrives within ~1 min. "Resend" is disabled with a countdown |
| 2.2 | Enter the code | Moves to the details form |
| 2.3 | Fill name, pick building from the list, landmark, gender, occupation; accept the Terms checkbox; submit | "Account created — pending admin approval" |
| 2.4 | Try to sign in before approval | Clear message that the account is waiting for admin approval (code `ACCOUNT_PENDING`), not "wrong password" |
| 2.5 | Admin approves (§3.2) → sign in | Home, with the member's full name in the greeting |

### Daily use

| # | Step | Expected |
|---|---|---|
| 2.6 | Home during voting | Poll card with Yes / No; the phase chip says voting. Vote **Yes** → confirmation, the choice is shown as selected |
| 2.7 | Change the vote to **No**, then back | Each change is accepted until 10 am; after 10 am the buttons are gone and the card says voting has closed |
| 2.8 | Between 10 am and 5 pm | Special-case options (opt in/out) appear per the poll's rules |
| 2.9 | Profile → Vote history | Past answers listed with dates |
| 2.10 | Profile → edit name/landmark → Submit for approval | "Pending admin approval" badge; the change appears only after an admin approves |
| 2.11 | Donate → View payment details | **Both phones**: the OneMessage website's home page (`onemessage-official.vercel.app`) opens in the system browser (Safari / Chrome or the default browser), showing the UPI ID, QR code, Copy and "Open UPI app". The Donate screen itself shows **no** payment number and has no Copy or "pay" button. Return to the app with the back gesture / app switcher: the form is still there |
| 2.11a | Donate with no browser able to open the page (Android: disable Chrome and have no other browser) | "Couldn't open the payment details — visit https://onemessage-official.vercel.app in your browser" — no crash |
| 2.12 | Donate → enter amount → attach screenshot → submit | "Submitted — a super admin will verify it". Donation history shows it as pending, and **the screenshot opens** from history |
| 2.13 | Feedback → send a message | Appears in "Your feedback" |

### Chat — report and block (Member A and B in the same zone)

| # | Step | Expected |
|---|---|---|
| 2.14 | A opens the zone chat, sends "Assalamu alaikum" | Appears for B within a second or two |
| 2.15 | A sends a message containing a common English swear word, then one in romanised Hindi/Urdu | Refused with a plain message about community guidelines; nothing posted |
| 2.16 | A sends "Inshallah, see you at Fajr" and "Mashallah" | Posted normally (religious phrases must never be blocked) |
| 2.17 | B long-presses A's message → **Report** → pick a reason → submit | "Report sent". Super admin sees it in Chat reports (§4) |
| 2.18 | B long-presses A's message → **Block** → confirm | A's messages disappear for B, including after leaving and re-entering the room |
| 2.19 | B → Profile → Blocked people → unblock A | A's messages come back |
| 2.20 | With VoiceOver/TalkBack on (§12), B focuses A's message and uses the Actions rotor / menu → "Message options" | The same Report / Block menu opens |

### Delete account, then re-register the same number

| # | Step | Expected |
|---|---|---|
| 2.21 | Member B: vote Yes in the current poll, send a chat message, submit a donation with a screenshot | — |
| 2.22 | B → Profile → Delete account → read the summary → confirm with password | Signed out to the sign-in screen |
| 2.23 | Member A looks at the chat | B's message now reads "[deleted]"; the sender shows as a former member |
| 2.24 | Super admin → Donations | B's donation is still listed (amount kept) with no name, no note and **no screenshot** |
| 2.25 | Admin → today's poll stats | B's pending Yes is gone from the count; the kitchen total dropped by one |
| 2.26 | Try to sign in as B | "No account found" with a link to create one — not "wrong password" |
| 2.27 | Register again with B's number (§2.1–2.5) | Works end to end; the new account has **no** old votes, chats, blocks or donations |

## 3. Admin

| # | Step | Expected |
|---|---|---|
| 3.1 | Sign in as admin | Admin dashboard: today's poll stats for their zone(s) |
| 3.2 | Users → Pending → approve a member | Moves to Approved; the member can now sign in |
| 3.3 | Users → Requests → approve/reject a profile edit | Member sees the change / the rejection |
| 3.4 | Dashboard during voting | Yes/No counts update when a member votes (pull to refresh) |
| 3.5 | Chat | Admin can read and post in their zone's room |
| 3.6 | Feedback | Members' feedback for their zone is listed |
| 3.7 | Role switcher (if the admin is also a member) | Switching roles changes the tab set without signing out |

## 4. Super admin

| # | Step | Expected |
|---|---|---|
| 4.1 | Dashboard | Community totals; sandbox (reviewer) accounts are **not** counted |
| 4.2 | Polls → before 10 pm → Open voting | Extends the current day's poll; it closes on its own at **10 pm** at the latest |
| 4.3 | Polls → after 10 pm → **Open tomorrow's poll** | New poll opens; every member with notifications gets "Sehri poll is open" |
| 4.4 | Polls → tap Open on a poll whose day is over | Message: "This poll's day has ended. Open tomorrow's poll instead." Nothing changes |
| 4.5 | Special cases (10 am–5 pm) | Members' special-case requests listed; sandbox zone absent |
| 4.6 | Allotment (5–6 pm) | Final numbers can be set; after 6 pm read-only |
| 4.7 | Delivery teams | Create a team: captain, optional helper, zones. A zone already on another team is locked |
| 4.8 | Donations → open a screenshot | Image opens. Copy its link, wait **over an hour**, open the link again: it no longer works (links expire) |
| 4.9 | Donations → verify one, reject one with a reason | Member sees verified / rejected with the reason |
| 4.10 | Chat reports → the report from 2.17 | Shows the message snapshot and reason; "Delete message" removes it for everyone; "Stop posting" prevents that member sending |
| 4.11 | Broadcast → send to one zone | Only members of that zone receive it |
| 4.12 | Admins → try to promote the reviewer demo member | Refused ("sandbox account") |
| 4.13 | Riders → delete a rider who delivered earlier | Rider gone; past stops still show as delivered |

## 5. Rider captain and helper

Use the Android phone as captain and the iPhone as helper for one run, then
swap for a second run, so both platforms are tested in both roles.

| # | Step | Expected |
|---|---|---|
| 5.1 | Sign-in → "I'm delivering today" → rider phone + password | Rider map. First time: location permission prompt → choose **While using the app** (Android: "While using the app"; do **not** grant "All the time" — the app never asks for it) |
| 5.2 | Android 14+: tap **Start delivery** | A persistent notification appears ("sharing your location…") and stays while the round runs |
| 5.3 | iPhone: Start delivery | Blue location indicator in the status bar while the round runs |
| 5.4 | Members in the team's zones | Get "Sehri is on the way — <captain> and <helper> started the delivery round" |
| 5.5 | Deliveries tab | Stops in order with packet counts; captain can mark **Delivered** |
| 5.6 | Helper's phone | Same stop list; marking delivered on one phone shows on the other after refresh |
| 5.7 | Mark a stop delivered | It moves to the done list; the member at that stop sees "delivered" on Track |
| 5.8 | Tap **Stop delivery** | Notification / blue indicator disappears; members' Track shows the round ended |
| 5.9 | Start again, then force-quit the app | Android: the notification stays and location keeps flowing. iPhone: sharing stops (iOS ends it when the app is swiped away) — the member sees the last position go stale, not a crash |

### Long-run tests (do both; they are the ones most likely to fail in the field)

| # | Step | Expected |
|---|---|---|
| 5.10 | Start delivery, lock the phone, put it in a pocket for **25 minutes** (walk or drive if you can) | A member watching Track sees the marker keep moving for the whole 25 minutes. On unlock the rider app is still in the round |
| 5.11 | Same, but the phone stays locked **past 15 minutes** (the access token's lifetime) | Location keeps arriving after minute 15 — the app refreshes its sign-in in the background. Server log shows a `POST /api/auth/refresh` around then and **no** 401 streak |
| 5.12 | iPhone specifically: restart the phone, **do not unlock it**, then… | (Skip — iOS cannot run the task before first unlock. After unlocking once, 5.10 must pass with the phone locked again.) |
| 5.13 | Start delivery, turn on **airplane mode for 20 minutes**, then turn it off | While off: the member's Track shows the last position (stale). Within ~1 minute of reconnecting the marker jumps to the current position and keeps updating. The rider is **not** signed out |
| 5.14 | Leave a round running (or simulate with the server clock) past **10 hours** | The round stops on its own; the notification disappears |

## 6. Maps and live ETA (member watching a running round)

| # | Step | Expected |
|---|---|---|
| 6.1 | Member A (in the team's zone) → Track | Map with the rider's marker and A's building; an ETA line ("about N min") |
| 6.2 | Watch for 3 minutes as the rider moves | Marker moves smoothly; the ETA updates about once a minute |
| 6.3 | Recenter / fit buttons | Recenter follows the rider; "fit both" shows rider and building |
| 6.4 | Rider comes within ~5 minutes of A's stop | A gets **one** "Your Sehri is close" notification — not one per minute |
| 6.5 | A member in a zone with no running round | Track says no round is running — no spinner that never ends |
| 6.6 | Server with no Google key / quota exhausted (staging only: unset the key) | Track still shows the marker; the ETA is missing or "unavailable", not an error screen |

## 7. Push notifications (both phones, Member A)

| # | State of the app | Trigger | Expected |
|---|---|---|---|
| 7.1 | **Android 13+**, first sign-in | — | The system "Allow notifications?" prompt appears (after sign-in, not on the very first launch screen). Allow |
| 7.2 | Android 12 | — | No prompt; notifications work |
| 7.3 | iPhone, first sign-in | — | "Allow notifications?" prompt. Allow |
| 7.4 | **Foreground** (app open on Home) | Super admin broadcast to A's zone | A banner/alert shows while the app is open |
| 7.5 | **Background** (home button, app in the switcher) | Broadcast | System notification; tapping it opens the app on the right screen |
| 7.6 | **Killed** (swiped away) | Broadcast | System notification arrives; tapping it cold-starts the app into the right screen |
| 7.7 | Each state | "Open tomorrow's poll" | "Sehri poll is open" → tapping opens Home |
| 7.8 | Each state | Rider starts a round for A's zone | "Sehri is on the way" → tapping opens Track |
| 7.9 | Notifications denied in system settings | Broadcast | Nothing arrives; the app still works; no repeated nagging |
| 7.10 | Sign out, broadcast | — | The signed-out phone receives nothing |

## 8. Offline and slow network (airplane mode)

| # | Step | Expected |
|---|---|---|
| 8.1 | Online: open Home, Qur'an list, one surah, Dua list, one dua category. Then **airplane mode** and force-quit | — |
| 8.2 | Open the app | Signed in still (no forced sign-out) |
| 8.3 | Home | Today's namaz times and the Ayat shown from the saved copy, with a note "You're offline — showing the copy saved <time>" |
| 8.4 | Qur'an list, the surah you opened, Dua list, the category you opened | Load from the saved copy, same note |
| 8.5 | A surah you never opened | "You're offline or the server can't be reached. Check your connection and try again." with **Try again** |
| 8.6 | Poll, Chat, Donate, Track, admin screens | Plain offline message + Try again; **no spinner that never ends** (every request gives up after 15 s at most) |
| 8.7 | Turn airplane mode off → Try again / pull to refresh | Fresh data; the offline note disappears |
| 8.8 | Next day, still offline | Yesterday's prayer times are **not** shown as today's; the card says it can't load |
| 8.9 | Slow network (Android developer options → network throttling, or a weak signal) | Screens load slowly but finish; a timeout shows "The connection is slow and the request timed out…" |

## 9. Reviewer demo login (what Apple and Google will do)

| # | Step | Expected |
|---|---|---|
| 9.1 | Sign in with `REVIEW_DEMO_PHONE` / `REVIEW_DEMO_PASSWORD` | Signed in as an approved member; sandbox chat room only |
| 9.2 | Sign-up with the demo phone, code `REVIEW_DEMO_OTP` | Accepted without an SMS; account lands in the sandbox, auto-approved |
| 9.3 | Forgot password with the demo phone + code | Works |
| 9.4 | The demo OTP with any **other** number | Rejected |
| 9.5 | Rider sign-in with `REVIEW_DEMO_RIDER_PHONE` | Rider map for the sandbox zone; Start delivery works |
| 9.6 | Super admin dashboards / stats / delivery lists | No sandbox votes, members or stops appear in real numbers |
| 9.7 | Delete the demo account, then sign in again with the documented password | Account is recreated |
| 9.8 | Set `REVIEW_DEMO_ENABLED=false`, restart | Demo sign-in fails like any wrong password |

## 10. Sign-in security (quick checks)

| # | Step | Expected |
|---|---|---|
| 10.1 | Wrong password 5 times from one phone | "Too many attempts" with a wait time. The **real owner on a different network/phone** can still sign in |
| 10.2 | Forgot password → reset | Sign-in works with the new password; old sessions on other phones are signed out |
| 10.3 | Leave the app open 20+ minutes, then use it | Keeps working (silent refresh); never kicked to sign-in |
| 10.4 | Open the app on a poor connection so several screens refresh at once after 15 min | Still signed in (concurrent refreshes are tolerated) |

## 11. Upgrade from the previous build (one phone each)

| # | Step | Expected |
|---|---|---|
| 11.1 | Install the previous store/preview build, sign in, then install this build over it | Still signed in; no crash on launch |
| 11.2 | iPhone rider: after the upgrade, run 5.10 with the phone locked | Works (the sign-in is re-saved so the background task can read it while locked) |

## 12. Accessibility, small screen, large text

| # | Step | Expected |
|---|---|---|
| 12.1 | Largest system text size (iOS: Settings → Accessibility → Larger Text, max; Android: Font size max + Display size max) | Every screen still usable: text wraps rather than overlapping; buttons readable; the Android tab bar grows instead of clipping labels. (iOS tab labels stay small by design — long-press a tab shows the large label) |
| 12.2 | Smallest phone you have (iPhone SE / mini, or a 5" Android) | Sign-in, Home, poll, Track, rider map and chat composer fit; nothing hidden behind the keyboard or the home indicator |
| 12.3 | VoiceOver (iPhone) / TalkBack (Android): swipe through Sign-in, Home, Qur'an, Chat, Donate, Profile | Every control is announced with a name and "button" (or tab/checkbox); icon-only buttons have names (Back, Close, Refresh, Clear search…); order follows the screen top-to-bottom |
| 12.4 | VoiceOver on the namaz sheet, role switcher, and zone/row action sheets | Each option inside the sheet is reachable; the sheet can be closed (Close / Cancel button, or two-finger scrub on iOS) |
| 12.5 | VoiceOver on Arabic verses and duas | Read in an Arabic voice |
| 12.6 | Dark/bright sunlight check | Grey timestamps and teal links readable (the palette now meets 4.5:1) |

---

## After the pass: what to check in Sentry and the logs

### Sentry (the React Native project)

- **Issues → last 24 h, filtered by the release/build you tested.** Expect
  zero new unhandled errors. Anything with "TaskManager", "Location",
  "SecureStore" or "Keychain" in the stack is a rider-tracking problem —
  prioritise it.
- Open one event and confirm scrubbing: **no phone numbers, tokens or names**
  in breadcrumbs or request data; **no IP address** stored.
- Source maps: stack frames show real file names (`src/app/…`), not
  `index.android.bundle:1:123456`. If they don't, the `SENTRY_AUTH_TOKEN` /
  `SENTRY_ORG` / `SENTRY_PROJECT` EAS variables are missing.

### Server logs (hosting platform)

Search the time window of your test for:

| Look for | Healthy | Problem |
|---|---|---|
| `status=5` (5xx) | none | any — open the stack trace |
| `POST /api/auth/refresh` during 5.10–5.13 | a refresh every ~15 min while the round runs | long runs of `401` on `/api/tracking/location` → background refresh failing |
| `refresh token reuse detected` | none | a session revoked for token reuse — a real phone was signed out (the concurrent-refresh grace should prevent this; if seen, note the phone and time) |
| `[eta]` | `proximity pushes: sent=1` once per stop as the rider nears it | repeated "Directions returned no usable route" or "no pending stop has map coordinates" → Google key/quota problem, or buildings without pins (Super admin → Locations) |
| `[push]` / `DeviceNotRegistered` | occasional | a burst → stale tokens are being cleaned; check a real phone still receives |
| `LOGIN_LOCKED` / `LOGIN_STEP_UP` | only from 10.1 | from phones you didn't test with → someone is guessing passwords |
| `[polls]` | "created poll … phase=voting" at the time of 4.3 | a poll created with another phase at night |
| `SANDBOX_ACCOUNT` | only from 4.12 | — |

### Database spot checks (read-only)

```sql
-- the deleted member (§2.21–2.27) is gone everywhere
SELECT COUNT(*) FROM users WHERE phone = '<B''s number>';          -- 1 (the new account) or 0
SELECT COUNT(*) FROM donations WHERE user_id IS NULL AND screenshot_public_id IS NOT NULL;  -- 0
-- no stale login throttles for B
SELECT * FROM login_throttles WHERE throttle_key LIKE '%<B''s number>%';
-- today's delivery stops agree with the yes votes
SELECT location_id, packet_count FROM delivery_stops WHERE status = 'pending';
```

Cloudinary → Media library → `onemessage/donations`: the test donation's
screenshot is **Authenticated** (a lock icon / "authenticated" type), and B's
screenshot is gone after 2.22.
