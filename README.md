# Sehri One Message — What's Built vs What's Missing

## Backend

### What's done ✅

| Area | Implemented Endpoints |
|---|---|
| Auth | `POST /send-otp`, `POST /register`, `POST /login`, `POST /refresh`, forgot-password flow (3 endpoints), `POST /switch-role`, `POST /fcm-token`, `POST /create-admin`, `POST /create-super-admin`, `GET /list-admins`, `DELETE /admins/:id`, `PATCH /admins/:id/link-user` |
| Polls | `GET /active`, `POST /:id/respond`, `GET /my-responses`, `GET /active/stats`, `GET /:id/zone-voters` |
| Tracking | Full — rider login, create/delete rider, assign today, toggle, manual location, push-location, get active, delivery list |
| Prayers | `GET /` (today's schedule), `POST /refresh` (force refresh) |
| Users | `GET /` (list users), `PATCH /:id/status` (approve/reject) |
| Locations | Public location/zone picker for registration |

### What's missing ❌

1. **Poll — Special Cases** (5 endpoints in the docs, all stubbed in `polls.js` as comments):
   - `POST /api/polls/:id/special-case` — user submits opt-in/opt-out
   - `POST /api/polls/:id/special-case/undo` — user undoes it
   - `GET /api/polls/special-cases` — super admin views list
   - `POST /api/polls/special-cases/allot` — super admin approves/rejects
   - `PATCH /api/polls/active/toggle` — super admin manually open/close poll

2. **Poll — History** (2 endpoints stubbed):
   - `GET /api/polls/history` — past polls list
   - `GET /api/polls/date/:date/stats` — stats for a specific date

3. **Donations** — zero backend routes, controller, or model
   - `POST /api/donations/submit`
   - `GET /api/donations/history`
   - `GET /api/donations/all`
   - `GET /api/donations/summary`
   - `PATCH /api/donations/:id/status`

4. **Chat** — zero backend routes, controller, or model
   - All `/api/chat/groups/*` endpoints (10+)
   - Socket.IO setup for real-time messaging

5. **Feedback** — zero backend routes, controller, or model
   - `POST /api/feedback`, `GET /api/feedback/my`, `GET /api/feedback/`, `PATCH /api/feedback/:id/read`

6. **User profile endpoints** missing:
   - `GET /api/users/me` (own profile)
   - `DELETE /api/users/:id` (delete user)
   - `POST /api/users/request-profile-edit`
   - `GET /api/users/profile-edit-requests`

7. **Database models missing**: `Donation`, `ChatGroup`, `ChatGroupMember`, `ChatMessage`, `Feedback`, `ProfileEditRequest`

8. **Cron jobs** — no scheduler file exists at all (`node-cron` scheduled tasks for poll open/close, prayer fetch, push notifications)

9. **Push notifications** — Firebase Admin SDK / `expoPushService.js` not present

---

## Frontend

### What's done ✅

| Screen | Status |
|---|---|
| Auth — Login, Register, Forgot Password | Built |
| Rider — Login, Map (GPS broadcast), Deliveries list | Built |
| User — Home (poll voting + phases + prayer times) | Built |
| User — Track (live rider map) | Built |
| User — Donate (UI shell exists) | Built (UI only) |
| User — Dua, Quran | Built |
| Admin — Dashboard (zone vote counts) | Built |
| Admin — Users (approve/reject) | Built |
| Admin — Feedback (view list) | Built |
| Admin — Chat (UI shell) | Built |
| Super Admin — Dashboard | Built |
| Super Admin — Users, Donations, Feedback, Poll History, Manage Admins, Chat | Built (mostly UI shells with mock data) |
| API layer | auth, polls, tracking, prayers, admin (partial) |

### What's missing ❌

1. **Special Cases screen** — `(admin)/special-cases.js` exists but is a "Coming soon" placeholder — needs full implementation wired to the backend endpoints

2. **Super Admin — Requests screen** (`super-admin/requests.js`) — profile edit request approval UI, needs `/api/users/profile-edit-requests` backend too

3. **Poll History screen** — `super-admin/polls.js` exists but likely a placeholder; the `adminApi.getPollHistory()` call hits `/api/polls/history` which doesn't exist on the backend yet

4. **Donations** — Frontend screen exists but uses hardcoded mock data and hits non-existent endpoint `/super-admin/donations`. Needs to be wired to the real donations API once backend is built

5. **Chat** — Super admin chat hits completely wrong endpoints (`/admin/chat/directory`, `/admin/chat/broadcast`) that don't exist. Needs to be rewritten against the real `/api/chat/groups/*` API once backend is done

6. **User feedback submit** — `(user)/feedback.js` or `(tabs)/feedback.js` — check if this screen even exists (not visible in the file list)

7. **Profile screen** — `profile.js` exists at root but unclear if profile edit requests are wired up

8. **User — Poll History screen** — `pollsApi.getMyResponses()` exists in the API layer but there's no dedicated Poll History screen for users (`(user)/poll-history`)

9. **Missing API files**: `donationsApi`, `chatApi`, `feedbackApi` — none of these files exist in `/src/api/`

10. **Push notifications** — no Expo notification registration or handling on the frontend

11. **Welcome/onboarding screen** — no `welcome.tsx` in `(auth)/`

---

## Priority Build Order

Given where things stand, the most logical order to complete the app:

**Backend first:**
1. Poll special cases + history endpoints + toggle (just controller functions + route wires)
2. Donations model + migration + all 5 endpoints
3. Feedback model + migration + 4 endpoints
4. Profile edit request model + migration + user endpoints
5. Chat models + migrations + Socket.IO setup + all group endpoints
6. Cron job scheduler (polls, prayer fetch, push notifications)
7. Push notification service (Firebase)

**Frontend after each backend piece:**
1. Special cases screen (admin)
2. Wire donations to real API
3. Wire feedback submit + admin feedback to real API
4. Profile edit requests screen
5. Rewrite chat to use real `/api/chat` endpoints
6. Add `donationsApi.js`, `chatApi.js`, `feedbackApi.js` in `/src/api/`
7. User poll history screen
8. Welcome/onboarding screen
