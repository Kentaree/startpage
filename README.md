# startpage

## Weather widget

The start page (`index.html`) shows the current temperature and conditions. It defaults to Dublin, Ireland and switches to "Your location" if the visitor allows geolocation. The °C/°F choice is remembered in `localStorage`. Coordinates are rounded and never stored.

Data comes from [Open-Meteo](https://open-meteo.com/); no API key is needed, and the free tier is for non-commercial use only.

Geolocation only works over HTTPS or on `localhost`. On plain HTTP the widget falls back to Dublin.

## Running the server

The page is served by a Node.js + TypeScript [Fastify](https://fastify.dev/) server (`server/`) from the `public/` directory, with a SQLite database behind it. Everything is same-origin, so no CORS setup is needed.

```sh
npm install
npm start        # http://localhost:3000
npm run dev      # restart on file changes
npm test         # vitest
```

`GET /healthz` returns `{"status":"ok"}`.

### Database

SQLite (via `better-sqlite3`) is stored at `DATABASE_PATH` (default `./data/app.db`). SQL migrations live in `server/migrations/` as numbered `.sql` files; they are applied on startup and recorded in a `schema_migrations` table, so restarts are idempotent. All SQL is wrapped in `server/repo/`.

**SQLite needs a persistent volume.** In Docker or any PaaS, mount a volume at the directory containing the database file, otherwise data is lost on redeploy. Run a single instance only.

```sh
docker build -t startpage .
docker run -p 3000:3000 -v startpage-data:/data \
  -e SESSION_SECRET=change-me -e BASE_URL=http://localhost:3000 startpage
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_PATH` | SQLite file path (default `./data/app.db`; `/data/app.db` in the Docker image) |
| `SESSION_SECRET` | Secret used for signing session cookies |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `BASE_URL` | Public URL of the app, e.g. `https://start.example.com` (used for OAuth redirects) |
| `PORT` / `HOST` | Listen port (default `3000`) / address (default `0.0.0.0`) |

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BASE_URL` enable Google sign-in (the redirect URI to register is `$BASE_URL/auth/google/callback`). `BASE_URL` also drives the CSRF Origin check and cookie flags: session cookies are `Secure` when it starts with `https:` (or, if unset, when `NODE_ENV=production`); use an `http://localhost` URL for local dev. Set `TRUST_PROXY=1` behind a reverse proxy so rate limiting sees client IPs. `SESSION_SECRET` is not used: sessions are opaque random tokens stored hashed in the `sessions` table.

## Authentication

Every route except `/login`, `/auth/*`, `/healthz` and the sign-in assets requires a session: pages redirect to `/login`, `/api/*` returns 401.

- **Email/password**: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`. Passwords are hashed with argon2id (minimum 10 characters), emails are lowercased, and login/signup are rate limited per IP (and per email for login) in memory.
- **Google**: `GET /auth/google` and `/auth/google/callback` use the OIDC authorization code flow with PKCE, state and nonce. Accounts are linked by Google `sub`; the email is only used if `email_verified` is true. A Google login is never linked to an existing account by email: the user is told to sign in with their existing method.
- **Sessions**: 30-day server-side sessions; the cookie holds a random token and only its SHA-256 is stored. Cookies are `HttpOnly; SameSite=Lax`.
- **CSRF**: all non-GET requests must carry a matching `Origin` (or `Referer`) header.
- New accounts get a weather and a clock widget and `lg`/`md`/`sm` layouts.

### Follow-ups (out of scope)

- Email verification
- Password reset
- Linking a Google identity to an existing account from a signed-in settings page
