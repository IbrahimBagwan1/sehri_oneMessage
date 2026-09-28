# Reviewer access — design and the text to paste

## Why reviewers need a special path

Sign-up needs an SMS OTP to an Indian mobile number, then an admin's
approval. App Review (Cupertino) and Play review cannot do either, and "we
couldn't sign in" is an automatic rejection (App Review 2.1, Play "App
access").

## Design (`backend/src/services/reviewDemoService.js`)

- **Off by default.** Only active when `REVIEW_DEMO_ENABLED=true` on the
  server. Turn it on for review, off after approval.
- **Demo member** — `REVIEW_DEMO_PHONE` + `REVIEW_DEMO_PASSWORD`, already
  approved.
- **Demo rider** (optional) — `REVIEW_DEMO_RIDER_PHONE` + the same password,
  signs in on the rider screen and is the captain of the sandbox zone, so
  the reviewer can see the one feature that uses location (and its
  permission prompt).
- **Fixed OTP** — `REVIEW_DEMO_OTP` is accepted for `REVIEW_DEMO_PHONE`
  **only**, so the sign-up and forgot-password screens can be tested end to
  end. No SMS is sent to that number; no other number accepts the code
  (covered by `tests/integration/reviewDemo.test.js`).
- **Sandbox, no real data** — both accounts live in a hidden branch of the
  location tree (`locations.is_sandbox`): not in the public location
  picker, not in zone statistics or kitchen counts, not in real delivery
  runs, and with its own chat room. Registering with the demo number is
  forced into the sandbox and auto-approved, whatever location the form
  sent. A sandbox account cannot be promoted to admin or super admin, linked
  to a staff record, or made a rider (the server refuses with
  `SANDBOX_ACCOUNT`), and there is no client-side switch that enables the
  demo mode.
- **Self-healing** — reviewers are asked to try account deletion. A sign-in
  with the documented password recreates the demo account (and restores
  its password, sandbox location and approval) if a previous reviewer
  deleted or changed it.
- **What reviewers will see**: prayer times, Qur'an, duas, verse of the day,
  their sandbox chat room (super admins are members of every room, so they
  can see what reviewers post), donations (their submission goes to your
  review queue — reject it), feedback, profile, blocked people, delete
  account. **Poll voting and live tracking only work while a poll exists and
  is in its window** (see the note in the review text).

## Server settings for the review period

```
REVIEW_DEMO_ENABLED=true
REVIEW_DEMO_PHONE=<a 10-digit number you control that no member uses>
REVIEW_DEMO_RIDER_PHONE=<a second such number>
REVIEW_DEMO_PASSWORD=<10+ characters>
REVIEW_DEMO_OTP=<6 digits>
```

Restart the API, then sign in once with each account yourself to confirm.

## App Store Connect → App Review Information → Notes

Sign-in required: **Yes**. User name: `<REVIEW_DEMO_PHONE>` · Password:
`<REVIEW_DEMO_PASSWORD>`. Then paste into Notes:

```
OneMessage is a community app for a Muslim residential community in
Bangalore: nightly Sehri (pre-dawn Ramadan meal) coordination, prayer times,
Qur'an and duas, group chat, and donations.

DEMO ACCOUNTS (sandboxed — they cannot see or affect real members' data)
• Member: phone <REVIEW_DEMO_PHONE>, password <REVIEW_DEMO_PASSWORD>
• Rider (delivery volunteer): tap "I'm delivering today" on the sign-in screen,
  phone <REVIEW_DEMO_RIDER_PHONE>, password <REVIEW_DEMO_PASSWORD>
• Sign-up / forgot password: use phone <REVIEW_DEMO_PHONE>; the verification
  code is <REVIEW_DEMO_OTP> (real users receive it by SMS).
• You may delete the demo account (Profile → Delete account); signing in
  again with the details above recreates it.

WITHOUT SIGNING IN: "Continue as guest" shows prayer times, the Qur'an,
duas and the verse of the day.

SEASONAL FEATURES: The Sehri poll and live delivery tracking run during
Ramadan, when an organiser opens each night's poll (voting 10 PM–10 AM
India time). Outside that window the Home screen shows the poll as closed.

LOCATION: Only delivery volunteers (the rider account) share location, and
only after they tap "Start delivery" in the app. It uses "While Using the
App" permission; the background location mode keeps the round going with
the screen off, with the blue location indicator shown, and stops when they
tap "Stop delivery" (or automatically after 10 hours). Members' location is
never read.

DONATIONS: The app never processes payments and does not display payment
details. "View payment details" opens a web page in Safari with the UPI
number; the donor pays in their own UPI app and can then upload a screenshot
so a volunteer can confirm it.

USER-GENERATED CONTENT: Long-press any chat message to Report or Block the
sender. Objectionable language is filtered before posting. Reports go to a
moderation queue where admins can delete messages and stop members posting.
Community Guidelines, Terms and contact details are linked from Profile →
Legal & support and from the sign-in screen.
```

## Google Play Console → App content → App access

Choose **"All or some functionality is restricted"** → **Add instructions**:

- Name: `Demo member account`
- Username: `<REVIEW_DEMO_PHONE>` · Password: `<REVIEW_DEMO_PASSWORD>`
- Any other information:

```
Sandboxed demo account; it cannot see real members' data. Sign-up and
forgot-password: use the same phone; the verification code is
<REVIEW_DEMO_OTP> (real users receive it by SMS). A second account for the
delivery-volunteer screen: tap "I'm delivering today", phone
<REVIEW_DEMO_RIDER_PHONE>, same password. Deleting the demo account is
allowed; signing in again recreates it. The Sehri poll and live tracking are
seasonal (Ramadan) and only open 10 PM–10 AM India time. Donations: the app
never processes payments or shows payment details — "View payment details"
opens a web page in the browser; the donor pays in their own UPI app and
uploads a screenshot for a volunteer to confirm.
```

## After approval

Set `REVIEW_DEMO_ENABLED=false` and restart. The sandbox rows stay (hidden);
the demo accounts simply stop working. Re-enable for each future review.
