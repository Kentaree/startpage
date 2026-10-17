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

`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BASE_URL` are reserved for the upcoming login feature; the server does not read them yet.
