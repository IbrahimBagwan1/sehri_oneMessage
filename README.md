# Sehri OneMessage

A community-scale Sehri (pre-dawn Ramadan meal) coordination app for
Bangalore. Residents vote nightly on whether they need food, the kitchen
prepares zone-by-zone, and a rider delivers with live GPS tracking.

## Repository layout

| Directory | Description |
|---|---|
| `backend/` | Node.js + Express 5 + Sequelize (MySQL) + Socket.IO |
| `frontend/` | Expo (React Native) app with `expo-router` file-based routing |

## Backend — what ships

### Endpoints

| Domain | Endpoints |
|---|---|
| Auth | `POST /send-otp`, `POST /register`, `POST /login`, `POST /switch-role`, `POST /forgot-password/verify-otp`, `POST /refresh-token` |
| Users | `GET /me`, `DELETE /me`, `POST /request-profile-edit`, `GET /profile-edit-requests`, `PATCH /profile-edit-requests/:id/review`, `GET /`, `PATCH /:id/status`, `DELETE /:id` |
| Polls | `GET /active`, `POST /:id/respond`, `GET /my-responses`, `GET /active/stats`, `GET /:id/zone-voters`, `POST /:id/special-case`, `POST /:id/special-case/undo`, `GET /special-cases`, `POST /special-cases/allot`, `PATCH /active/toggle`, `GET /history`, `GET /date/:date/stats` |
| Tracking | `POST /rider-login`, `POST /`, `GET /all`, `PATCH /:id/assign-today`, `PATCH /:id/toggle`, `PATCH /:id/location`, `PATCH /:id/push-location`, `GET /active`, `GET /eta`, `GET /delivery-list`, `DELETE /:id` |
| Chat | `GET /groups`, `POST /groups`, `GET /admins`, `GET /groups/:id`, `DELETE /groups/:id`, `GET /groups/:id/messages`, `POST /groups/:id/messages`, `POST /groups/:id/read`, `POST /groups/:id/members`, `DELETE /groups/:id/messages/:msgId`, `DELETE /groups/:id/members/:userId` |
| Donations | `POST /submit`, `GET /history`, `GET /all`, `GET /summary`, `PATCH /:id/status` |
| Feedback | `POST /`, `GET /my`, `GET /`, `PATCH /:id/read` |
| Quran | `GET /chapters`, `GET /:surah`, `POST /sync` (super_admin) |
| Dua | `GET /categories`, `GET /featured`, `GET /:categorySlug`, `POST /sync` (super_admin) |
| Prayers | `GET /`, `POST /refresh` |
| Locations | `GET /` (public — cascading picker) |
| Admin management | `POST /create-admin`, `POST /create-super-admin`, `GET /list-admins`, `DELETE /admins/:id`, `PATCH /admins/:id/link-user` |
| Ops | `GET /health` |

### Real-time
Socket.IO shares the HTTP port. Rooms are per chat group; JWT auth is
required on the socket handshake. Emitters live in
`src/services/socketService.js`.

### Google Maps integration
Server-side reverse-geocode fallback fires (fire-and-forget) when the
rider push omits `current_address`. `GET /api/tracking/eta` returns
driving ETA from the assigned rider to the calling user's address using
Distance Matrix. Set `GOOGLE_MAPS_API_KEY` in `.env` — see `.env.example`.

### Quran + Dua content sync
Quran and dua content lives in our own DB so the app never depends on a
third-party at request time. Populate the tables once (and refresh
whenever you want the latest translations):

```bash
cd backend
node scripts/sync-quran.js     # ~30–60s, pulls 114 surahs + verses
node scripts/sync-duas.js      # pulls all categories + entries
```

Super admins can also trigger the sync at runtime via
`POST /api/quran/sync` and `POST /api/dua/sync` (fire-and-forget). The
upstream base URL is configurable — see `ISLAMIC_API_BASE_URL` in
`.env.example`.

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
| Auth — Login, Register, Forgot Password | Live |
| Rider — Login, Map (GPS broadcast), Deliveries | Live |
| User — Home (poll + phases + prayer times) | Live |
| User — Track (live rider map) | Live |
| User — Donate (submit + history) | Live |
| User — Quran (114 surah list + search + full-surah reader with RTL) | Live |
| User — Dua (categories + featured-today + expandable dua cards) | Live |
| User — Feedback (submit + history) | Live (reached from Profile) |
| User — Profile (edit-request workflow + delete account) | Live |
| Admin — Dashboard, Users approval | Live |
| Admin — Special cases | Live |
| Admin — Feedback | Live |
| Admin — Chat | Placeholder (backend live, frontend chat UI TBD) |
| Super Admin — Dashboard, Poll history, Special cases | Live |
| Super Admin — Donations, Feedback, Requests approval | Live |
| Super Admin — Users, Admins management, Chat | Placeholder (uses mock/legacy — backend endpoints available) |

### Run

```bash
cd frontend
npm install
npm start                  # then press a / i / w
```

Set the API base URL in `src/api/client.js` to your backend/ngrok URL.

## Play Store / App Store readiness

- **Account deletion** — required by both stores. `DELETE /api/users/me`
  soft-deletes and anonymizes (name/phone/address/fcm_token). The profile
  screen exposes a two-step confirmation flow.
- **Environment secrets** — never commit `.env` (covered by root and
  `backend/.gitignore`). Rotate the Google Maps key in `frontend/app.json`
  before release and restrict it to your Android package name + iOS bundle
  id in the Google Cloud console.
- **JWT secrets** — generate long random strings for `JWT_SECRET` and
  `JWT_REFRESH_SECRET` in production.
- **CORS** — set `CORS_ORIGIN` in production `.env` to your exact
  frontend origin(s); development defaults to `*`.
- **Push notifications** — Expo notifications currently skipped in Expo
  Go; wire Expo push tokens to the `fcm_token` column in a dev/prod build.
