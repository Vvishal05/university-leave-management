# University Leave Management Assistant

A database-backed leave workflow for students, faculty, and university administrators. React provides the responsive portal UI; Express enforces authenticated role access; MySQL is the system of record. No dashboard count or CRUD result comes from a frontend array or browser storage.

## Included capabilities

- Student leave submission with policy, date-range, duplicate, balance, attendance, and file-validation checks.
- Faculty-only review of assigned students' requests, with transactionally stored decisions and notifications.
- Admin dashboard statistics calculated from MySQL and student management with database search, status changes, and account creation.
- Controlled student and administrator assistant endpoints. They only receive data already authorized by the API and cannot execute arbitrary SQL or approve leave.
- 100 varied student records across nine schools and programs, 15 faculty accounts, and one admin account from the idempotent `npm run seed` command. The seed passwords and identities are configured only in `.env`.
- Docker deployment and persistent MySQL/uploads volumes.

## Architecture

```text
Browser
  │ HTTPS
  ▼
Frontend (Nginx + React) ── /api and /uploads ──► Express API ──► MySQL
                                                      │
                                                      └── optional LLM / SMTP credentials from environment
```

## Deploy with Docker

Docker Engine (Linux) or Docker Desktop (Windows/macOS) with Docker Compose v2 is the only required local runtime. The application needs no globally installed Node, MySQL, or Bash.

1. Create the private runtime configuration:

   ```bash
   cp .env.example .env
   ```

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env`. Replace every `CHANGE_ME` value. Generate different values for `JWT_SECRET`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, and the three seed passwords. Keep `.env` private and never commit it.

   Bash example for generating a secret:

   ```bash
   openssl rand -base64 48
   ```

   PowerShell example:

   ```powershell
   [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
   ```

3. Configure the public address before going live:

   ```dotenv
   APP_ORIGIN=https://leave.example.edu
   WEB_PORT=8080
   VITE_API_BASE_URL=/api
   API_UPSTREAM=backend:5000
   DB_HOST=db
   ```

   `APP_ORIGIN` is the browser origin that the API will permit. `VITE_API_BASE_URL=/api` keeps API calls same-origin behind Nginx. `DB_HOST=db` and `API_UPSTREAM=backend:5000` are Compose service addresses; set their equivalents if you separate the containers or use a managed database.

4. Run one of the supplied setup scripts. Each script stops before starting containers if `.env` is missing or still contains a `CHANGE_ME` placeholder. It then builds the images, starts MySQL/API/web services, and runs the repeatable seed process.

   ```bash
   bash scripts/setup.sh
   ```

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
   ```

5. Put an HTTPS reverse proxy or your hosting provider's TLS endpoint in front of `WEB_PORT`. Point the university hostname at that endpoint, then open the address set in `APP_ORIGIN`.

The first database start imports `database/schema.sql`. Data persists in Docker named volumes, so subsequent restarts do not erase the database. To watch health and logs:

```bash
docker compose ps
docker compose logs --follow
```

The API health endpoint is available at `<your origin>/api/health`.

## Deploy the API to Render

Render must run only the Express service. A persistent external MySQL-compatible database is required; do not expose the database port publicly. The repository includes [`render.yaml`](render.yaml) with `rootDir: backend`, a pnpm lockfile build, `pnpm start`, and `/api/health` as the health check.

1. Create a Render Web Service from this repository, or apply the included Blueprint. Confirm that the service root directory is `backend`.
2. Set the build command to `corepack enable && pnpm install --frozen-lockfile` and the start command to `pnpm start`. Render supplies `PORT`; do not set a fixed production port.
3. Add the database and application variables from [`.env.example`](.env.example) to the Render environment. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` to the private database connection values. Set a strong unique `JWT_SECRET` and the final Vercel origin in `APP_ORIGIN`.
4. Run the schema against the database, then run `pnpm seed` from the backend service shell with the `SEED_*` variables configured. Never put seed passwords, SMTP credentials, LLM keys, or database credentials in the repository.
5. Verify `https://<render-service>.onrender.com/api/health` returns HTTP 200 and `{"status":"ok"}` before configuring the frontend.

## Deploy the frontend to Vercel

1. Import this repository as a Vercel project and set the project root directory to `frontend`.
2. Select the Vite framework. Use `pnpm build` as the build command and `dist` as the output directory.
3. Add only the public variable `VITE_API_BASE_URL=https://<render-service>.onrender.com/api` in the Vercel environment. Do not add backend secrets or database variables to Vercel.
4. Set Render `APP_ORIGIN` to the exact final Vercel production origin, without a trailing path, then redeploy the API. CORS will reject other browser origins.
5. Open the Vercel URL, sign in, and verify the dashboard can load data from the Render API. Vite's SPA fallback is provided by Vercel automatically; the Docker Nginx configuration provides the equivalent fallback for local Compose use.

For updates, deploy the approved revision on each provider and run the health check again. Take a database dump and back up the uploads volume before destructive infrastructure changes. If the API is unhealthy, check database reachability and all required `DB_*`, `JWT_SECRET`, and `APP_ORIGIN` values first; if the browser reports CORS errors, compare `APP_ORIGIN` with the exact Vercel origin.

## Updating a running deployment

Pull your approved source revision, update any required environment values, then run:

```bash
bash scripts/deploy.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy.ps1
```

The deployment scripts validate Compose and block unset placeholders before rebuilding. Existing MySQL and uploads volumes are preserved.

## Environment variables

All runtime configuration is documented in [`.env.example`](.env.example). In particular:

- `DB_*` controls MySQL; no credential appears in source.
- `JWT_SECRET` signs access tokens and must be a long, unique secret.
- `APP_ORIGIN`, `WEB_PORT`, `VITE_API_BASE_URL`, and `API_UPSTREAM` control how the app is exposed.
- `LLM_*` and `SMTP_*` are optional integrations; leave them empty until configured.
- `SEED_*` controls non-production demonstration accounts. Set secure values before `npm run seed`; the seed process bcrypt-hashes passwords and never puts them in SQL.

## Development without Docker

Use separate MySQL and Node installations only if you prefer a local development loop. Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, and `APP_ORIGIN` in `.env`, then:

```bash
cd backend && npm install && npm run seed && npm run dev
cd frontend && npm install && npm run dev
```

Set `VITE_API_BASE_URL` to the backend's full public API URL only for this split development setup. For Compose/production, `/api` is recommended.

### Connect this VS Code workspace to TiDB Cloud

1. In TiDB Cloud, open the cluster's **Connect** dialog, reset the database password if necessary, download the CA certificate, and allow the current development IP in the cluster network access list.
2. Copy `.env.example` to `.env` in the workspace root. Keep `.env` uncommitted.
3. Replace the database section with the TiDB values. For the current `Cluster2` connection, the non-secret values are:

   ```dotenv
   DB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
   DB_PORT=4000
   DB_NAME=smartmart
   DB_USER=UDatoMLunGYen8f.root
   DB_PASSWORD=YOUR_TIDB_PASSWORD
   DB_SSL=true
   DB_CA_CERT_PATH=C:/path/to/ca.pem
   ```

   `DB_CA_CERT_PATH` may be an absolute Windows path. Public TiDB Cloud endpoints require TLS. For a first connection check, run `npm install` in `backend`, then `npm run seed`; a successful seed confirms the application can authenticate and write to TiDB. Run the API with `npm run dev` afterward. Never put the password or CA certificate in Git, React, or Vercel.

## Security notes

- Do not expose the MySQL port publicly. Only the frontend's reverse-proxied web port needs to be reachable.
- Terminate TLS at a managed load balancer or reverse proxy, redirect HTTP to HTTPS, and set `APP_ORIGIN` to the exact HTTPS site address.
- Store production secrets in the hosting provider's secret manager or protected environment configuration instead of committing `.env`.
- Back up the `mysql_data` and `uploads_data` volumes before infrastructure changes.
