# Sehri OneMessage

A community-scale Sehri (pre-dawn Ramadan meal) coordination app for
Bangalore. Residents vote nightly on whether they need food, the kitchen
prepares zone-by-zone, and a delivery team rides out with live GPS
tracking so everyone can see their food coming.

## Repository layout

| Directory | Description |
|---|---|
| `backend/` | Node.js + Express 5 + Sequelize (MySQL) + Socket.IO |
| `frontend/` | Expo (React Native) app with `expo-router` file-based routing |
| `store-assets/` | Icons and store artwork, all generated from one source file — see [`store-assets/README.md`](store-assets/README.md) |

## Core concepts

A few ideas recur everywhere; knowing them makes the rest of the code
read quickly.

**The location tree.** `locations` is a self-referencing tree:
`city → region → area → zone → address (PG)`. Nothing assumes a fixed
depth — code walks `parent_id` upward instead. A *zone* is the unit
almost everything is scoped by, and a PG (`type: 'address'`) is where
food is actually delivered.

**Zones are dynamic.** A zone's identity lives in `locations.zone_key`,
assigned once at creation and never rewritten, so renaming a zone does
not orphan its history. Super admins add zones at runtime; chat groups
and delivery coverage follow automatically. There is no hardcoded list.

**Polymorphic identity in chat.** A chat participant is
`(user_id, user_type)` where `user_type ∈ user | admin | super_admin` —
three tables, so no foreign keys on those columns. The same pair shape
appears in messages, memberships, reports and blocks.

**Soft deletes.** A deleted chat message keeps its row (`is_deleted`) so
reply threads do not break; clients render "This message was deleted".

**Response envelope.** Every endpoint returns
`{ success, message, data }` or `{ success, message, errors, code? }`.

## Backend — what ships

### Endpoints

Paths are relative to each domain's mount: `/api/auth`, `/api/users`,
`/api/polls`, `/api/tracking`, `/api/chat`, `/api/locations`,
`/api/broadcasts`, `/api/donations` + `/api/admin/donations`,
`/api/feedback`, `/api/quran`, `/api/dua`, `/api/prayers`,
`/api/admin`, `/api/payment`.

| Domain | Endpoints |
|---|---|
| Auth | `POST /send-otp`, `POST /verify-otp`, `POST /register`, `POST /login`, `POST /switch-role`, `POST /forgot-password/verify-otp`, `POST /refresh-token` |
| Users | `GET /me`, `DELETE /me`, `PATCH /me/push-token`, `POST /request-profile-edit`, `GET /profile-edit-requests`, `PATCH /profile-edit-requests/:id/review`, `GET /`, `PATCH /:id/status`, `DELETE /:id` |
| Polls | `GET /active`, `GET /active/stats`, `PATCH /active/toggle`, `POST /create-today`, `POST /:id/respond`, `GET /my-responses`, `GET /:id/zone-voters`, `POST /:id/special-case`, `POST /:id/special-case/undo`, `GET /special-cases`, `POST /special-cases/allot`, `GET /history`, `GET /date/:date/stats` |
| Tracking — riders | `POST /rider-login`, `POST /`, `GET /all`, `GET /me`, `PATCH /:id/toggle`, `PATCH /:id/location`, `PATCH /:id/push-location`, `DELETE /:id` |
| Tracking — teams | `GET /teams`, `PUT /teams/:captainId/zones`, `PUT /teams/:captainId/helper` |
| Tracking — the run | `POST /delivery-run/assign`, `GET /delivery-run`, `GET /my-stops`, `POST /my-route/recompute`, `PATCH /stops/:id/mark-delivered`, `PATCH /stops/:id/undo-delivered`, `GET /delivery-list`, `PATCH /:id/assign-today`, `PATCH /unassign-today` |
| Tracking — users | `GET /active`, `GET /eta` |
| Chat | `GET /groups`, `POST /groups`, `GET /groups/:id`, `DELETE /groups/:id`, `GET /groups/:id/messages`, `POST /groups/:id/messages`, `POST /groups/:id/read`, `POST /groups/:id/members`, `DELETE /groups/:id/members/:userId`, `DELETE /groups/:id/messages/:msgId`, `POST /groups/:id/zones`, `DELETE /groups/:id/zones/:zoneId`, `GET /admins`, `GET /zones` |
| Chat — trust & safety | `POST /groups/:id/messages/:msgId/report`, `GET /blocks`, `POST /blocks`, `DELETE /blocks/:userId` |
| Moderation (`/api/admin/chat`) | `GET /reports`, `PATCH /reports/:id`, `GET /bans`, `DELETE /groups/:groupId/bans/:userId` |
| Locations | `GET /` (public — cascading picker), `GET /addresses`, `GET /needs-coordinates`, `POST /`, `POST /address`, `PATCH /:id`, `PATCH /:id/coordinates`, `DELETE /:id` |
| Broadcasts | `POST /`, `GET /` |
| Donations | `POST /`, `GET /my` · admin: `GET /`, `GET /summary`, `PATCH /:id/verify`, `PATCH /:id/reject` |
| Feedback | `POST /`, `GET /my`, `GET /`, `PATCH /:id/read` |
| Quran | `GET /chapters`, `GET /:surah`, `GET /ayat-of-the-day`, `POST /sync` (super_admin) |
| Dua | `GET /categories`, `GET /featured`, `GET /:categorySlug`, `POST /sync` (super_admin) |
| Prayers | `GET /`, `POST /refresh` |
| Admin management | `POST /create-admin`, `POST /create-super-admin`, `GET /list-admins`, `GET /users/search`, `POST /users/:id/promote`, `POST /link-user-account`, `DELETE /admins/:id`, `PATCH /admins/:id/link-user` |
| Payment | `GET /info` |
| Ops | `GET /health` (mounted at the root, not under `/api`) |

### Real-time

Socket.IO shares the HTTP port; JWT auth is required on the handshake.
Emitters live in `src/services/socketService.js`.

| Room | Carries |
|---|---|
| `group:{id}` | `new_message`, `message_deleted`, member updates |
| `team:{captainId}` | `rider_position` — a delivery team's live GPS |
| `user:{id}` | `eta_update`, `stop_delivered`, `stop_reopened` |

**Subscriptions are server-derived, never client-supplied.** A socket
asking to watch a particular team or zone is ignored; the server
resolves what that account is entitled to from its own PG or role. A
resident follows only the captain delivering to their own address.

### Delivery teams

A team is one **Captain**, who drives and owns the route, plus zero or
one **Helper**, who rides along and hands parcels to people.

- Coverage is standing configuration: `captain_zone_assignments` maps a
  zone to exactly one captain (DB-enforced UNIQUE). One captain covering
  every zone is the normal case today; splitting zones across N captains
  works through the identical code path.
- Each captain's route, stop list and packet counts are computed only
  from their own zones. Two captains' runs never share a stop.
- A helper shares the captain's stop list rather than owning one, and
  the helper's phone is the tracked device — the captain is driving.
- Route order comes from Google Directions waypoint optimization,
  recomputed at assign, on "Start delivery", and after each stop.

### Trust & safety

Required by both stores for any app carrying user messaging.

- **Report a message** — long-press any message. The report stores a
  *snapshot* of the content and sender, because soft-delete overwrites
  the original: without it, a reported person could erase the evidence
  with two taps.
- **Block a person** — one-way and silent. The blocker stops seeing
  them; the blocked person's view is unchanged and they are never told.
  Mutual blocking is deliberately not implemented: in a shared zone room
  it would let any member make *themselves* invisible to the admin
  coordinating their food. Filtering is **server-side**, excluded in the
  SQL, so a modified client cannot recover the content.
- **Moderate** — admins (own zone) and super admins get a queue showing
  the reported text, both parties, and how many times that person has
  been reported. Actions: soft-delete the message, and/or stop the
  member posting in that group. Bans, not removals — a zone group
  auto-adds entitled members continuously, so a removal would be undone
  within seconds by the reconciler.

### Push notifications

Expo Push via `expo-server-sdk` (not Firebase Admin — Expo handles both
APNs and FCM behind one token). One token per user, stored on
`users.fcm_token`; signing in on a new device replaces it.

Triggers: poll opening, delivery started, proximity (~5 min ETA, once
per person per night), and admin broadcasts. Receipts are checked ~15
minutes after send and `DeviceNotRegistered` tokens are cleared.

### Google Maps integration

`GET /api/tracking/eta` returns the driving ETA and a road-following
polyline from the team's tracked device to the caller's PG. The
destination is the PG's *pinned coordinate*, so every resident at one
address sees the identical route and number. Server-side reverse-geocode
backfills `current_address` when the device could not resolve one.

Set `GOOGLE_MAPS_API_KEY` in `.env` — see `.env.example`.

### Quran + Dua content sync

Content lives in our own DB so the app never depends on a third party at
request time. Populate the tables once, and refresh whenever you want
newer translations:

```bash
cd backend
node scripts/sync-quran.js     # ~30–60s, pulls 114 surahs + verses
node scripts/sync-duas.js      # pulls all categories + entries
```

Super admins can also trigger a sync at runtime via `POST /api/quran/sync`
and `POST /api/dua/sync` (fire-and-forget), or from the Content sync
screen. The upstream base URL is configurable — see `QURAN_API_BASE_URL`
in `.env.example`.

Ayat of the Day is cached per UTC day in its own table, fetched lazily on
first request with a stale-fallback if upstream is down.

### Database

Sequelize migrations under `src/migrations/`. Run:

```bash
cd backend
npm install
cp .env.example .env       # fill in secrets
npm run migrate
npm run seed
npm run dev                # nodemon
```

## Frontend — what ships

| Screen | State |
|---|---|
| Auth — Login, Verify phone, Register, Forgot password | Live |
| User — Home (poll, phases, prayer times, Ayat of the Day) | Live |
| User — Track (live team map, ETA, delivered state) | Live |
| User — Chat list + room (real-time, report, block) | Live |
| User — Donate (submit + history) | Live |
| User — Quran (114 surahs, search, full-surah reader with RTL) | Live |
| User — Dua (categories, featured-today, expandable cards) | Live |
| User — Feedback (submit + history) | Live |
| User — Profile (edit requests, blocked people, delete account) | Live |
| Rider — Login, Map (background GPS), Deliveries queue | Live |
| Admin — Dashboard, Users approval, Feedback, Chat, Reported | Live |
| Super Admin — Dashboard, Polls, Special cases, Requests | Live |
| Super Admin — Users, Zone admins, Donations, Feedback | Live |
| Super Admin — Riders, Delivery teams | Live |
| Super Admin — Group chat, Reported messages | Live |
| Super Admin — Location tree, PG coordinates | Live |
| Super Admin — Broadcast, Content sync | Live |

### Run

```bash
cd frontend
npm install
npm start                  # then press a / i / w
```

Set the API base URL in `src/api/client.js` to your backend/ngrok URL.

**Expo Go will not exercise everything.** Background location, push
notifications and native Google Maps all need a dev build:

```bash
npx expo prebuild --clean
eas build --profile development --platform android
```

## Play Store / App Store readiness

### Done

- **Account deletion** — required by both stores. `DELETE /api/users/me`
  performs a genuine erasure: the `users` row is deleted and the phone
  number is freed, so signing in afterwards says "no account found" and
  re-registering with the same number works. Polls and history the
  member created are preserved — past `poll_responses` are detached
  (`user_id → NULL`, zone snapshot retained so counts stay correct)
  while any *pending* obligation for today is withdrawn. "Deactivated"
  remains a separate, admin-imposed state and is never conflated with
  deletion.
- **Report and block** — in-app reporting of abusive messages, in-app
  blocking of abusive members, and a working moderation queue for acting
  on reports. See *Trust & safety* above.
- **Push notifications** — built on Expo Push with receipt handling and
  dead-token cleanup.

### Before you ship

- **Decide the app ID.** Still `com.anonymous.onemessage`, and
  `ios.bundleIdentifier` is unset. This is permanent after the first
  Play release.
- **Run `eas init`** to write `extra.eas.projectId`. Without it
  `getExpoPushTokenAsync` fails and push cannot work in a real build.
  Then add an APNs key and an FCM v1 service-account JSON via
  `eas credentials`.
- **Issue a separate, IP-restricted server Maps key.** `backend/.env`
  currently holds the same key that ships inside the APK. Restrict the
  client key to your Android package name + iOS bundle id in the Google
  Cloud console.
- **JWT secrets** — generate long random strings for `JWT_SECRET` and
  `JWT_REFRESH_SECRET`.
- **CORS** — set `CORS_ORIGIN` to your exact frontend origin(s);
  development defaults to `*`.
- **Never commit `.env`** (covered by the root and `backend/.gitignore`).
- **Store listing copy** — both stores expect a stated moderation policy
  and a contact method alongside the in-app mechanism. That is console
  metadata, not code.
