# Email Automation App

Single-page internal dashboard for composing HTML email campaigns, loading recipients, and sending or scheduling them through your own SMTP server.

## Stack

- React + Vite + TypeScript frontend
- Hosted Supabase for Postgres and Edge Functions
- Node SMTP worker with Nodemailer
- Dockerized web and worker services

## Workspace

- `apps/web`: SPA for compose, recipients, scheduling, queue, and history
- `apps/smtp-worker`: background polling and SMTP delivery worker
- `packages/shared`: shared schemas and types
- `supabase`: SQL migrations and Edge Functions

## Prerequisites

- Node.js 20+ (tested on Node 24)
- npm 10+
- A hosted Supabase project
- SMTP credentials

## Environment variables

1. Copy `.env.example` to `.env`.
2. Replace all example values with your real credentials.

Variables used by the app:

- `VITE_SUPABASE_URL`: Supabase project URL (web app)
- `VITE_SUPABASE_ANON_KEY`: Supabase anon key (web app)
- `SUPABASE_URL`: Supabase project URL (worker)
- `SUPABASE_SERVICE_ROLE_KEY`: service role key (worker + Edge Functions)
- `SMTP_HOST`: SMTP server host
- `SMTP_PORT`: SMTP server port
- `SMTP_USER`: SMTP username
- `SMTP_PASS`: SMTP password
- `SMTP_FROM`: sender email (From header)
- `APP_POLL_INTERVAL_MS`: worker polling interval

The app now validates env vars at startup:

- Web: validates `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Worker: validates `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `APP_POLL_INTERVAL_MS`
- Worker SMTP config: validates `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

If a variable is missing/invalid, startup fails fast with a clear validation error.

## Supabase setup

Apply migrations in order:

1. `supabase/migrations/20260428_initial_schema.sql`
2. `supabase/migrations/20260428_queue_refinements.sql`

Deploy Edge Functions:

- `create-campaign`
- `list-campaigns`
- `get-campaign`
- `cancel-campaign`

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the web app:

```bash
npm run dev:web
```

3. In another terminal, start the worker:

```bash
npm run dev:worker
```

4. Optional validation commands:

```bash
npm run typecheck
npm run build
```

## How to use the program

1. Open the web app in your browser.
2. In `Compose`:
	- Set campaign name, subject, and HTML body.
	- Add recipients by paste or CSV upload.
	- Choose `Send immediately` or `Schedule for later`.
3. Submit the form to create a campaign.
4. Switch to `History` to:
	- Monitor campaign states (`scheduled`, `queued`, `sending`, `completed`, `failed`, `cancelled`)
	- Open campaign details and inspect per-recipient status/errors
	- Cancel upcoming/running campaigns when available
5. Keep the worker running: it leases queue jobs, sends emails through SMTP, and updates recipient/campaign statuses.

## Docker

Run both services with:

```bash
docker compose up --build
```

This starts:

- `web`: static frontend container
- `smtp-worker`: queue polling + SMTP sender

Both containers read variables from your local `.env` file.
