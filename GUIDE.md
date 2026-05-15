# Email Sender — User Guide

This guide walks you through everything needed to get the app running: obtaining credentials, setting up the database, starting the services, and sending your first campaign.

---

## Table of Contents

1. [What the app does](#1-what-the-app-does)
2. [Prerequisites](#2-prerequisites)
3. [Getting your Supabase credentials](#3-getting-your-supabase-credentials)
4. [Getting your SMTP credentials](#4-getting-your-smtp-credentials)
5. [Setting up the `.env` file](#5-setting-up-the-env-file)
6. [Setting up the database and Edge Functions](#6-setting-up-the-database-and-edge-functions)
7. [Running the app locally](#7-running-the-app-locally)
8. [Using the app](#8-using-the-app)
9. [Running with Docker](#9-running-with-docker)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What the app does

The Email Sender is an internal dashboard for composing HTML email campaigns, loading a list of recipients, and dispatching them through your own SMTP server. A background worker polls a queue and handles the actual sending, so the browser can be closed after submitting a campaign.

---

## 2. Prerequisites

| Requirement | Minimum version |
|---|---|
| Node.js | 20 (tested on 24) |
| npm | 10 |
| Supabase account | Free tier works |
| SMTP server or email service | See section 4 |

---

## 3. Getting your Supabase credentials

You need a Supabase project for the database and serverless functions.

### 3.1 Create a project

1. Go to [https://supabase.com](https://supabase.com) and sign in (or create a free account).
2. Click **New project**.
3. Choose an organisation, enter a project name, set a database password, and pick a region close to you.
4. Wait ~2 minutes for the project to provision.

### 3.2 Find your Project URL (`SUPABASE_URL` / `VITE_SUPABASE_URL`)

1. Inside your project, open the left sidebar and click **Project Settings** (gear icon).
2. Click **API** in the settings menu.
3. Under **Project URL**, copy the value. It looks like:
   ```
   https://abcdefghijklmnop.supabase.co
   ```
4. Use this value for **both** `VITE_SUPABASE_URL` and `SUPABASE_URL` in `.env`.

### 3.3 Find the anon key (`VITE_SUPABASE_ANON_KEY`)

1. On the same **Settings → API** page, scroll to **Project API keys**.
2. Copy the **anon / public** key. It is a long JWT string starting with `eyJ...`.
3. This key is safe to expose in the browser — it is used by the React frontend.

### 3.4 Find the service role key (`SUPABASE_SERVICE_ROLE_KEY`)

1. On the same page, copy the **service_role** key (also starts with `eyJ...`).
2. **Keep this secret.** It bypasses Row Level Security and should only be used by the worker and Edge Functions running on a server or in your terminal.
3. Never commit this value to a public repository.

---

## 4. Getting your SMTP credentials

The worker sends emails through any standard SMTP server. Choose whichever provider you already have access to.

### Gmail (free, for low volume)

1. Your Gmail account must have **2-Step Verification** enabled:  
   Google Account → Security → 2-Step Verification → Turn On
2. Generate an **App Password**:  
   Google Account → Security → 2-Step Verification → App passwords
3. Choose app: **Mail**, device: **Other (custom name)** → click **Generate**.
4. Copy the 16-character password shown.
5. Use these values in `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=<the 16-character app password>
   SMTP_FROM=you@gmail.com
   ```

> Note: Gmail limits free accounts to ~500 emails/day. Use a transactional service for higher volumes.

### Outlook / Hotmail / Microsoft 365

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=you@outlook.com
SMTP_PASS=<your account password>
SMTP_FROM=you@outlook.com
```

### Mailgun

1. Log in to [https://app.mailgun.com](https://app.mailgun.com).
2. Go to **Sending → Domains** and select your domain (or add one and verify it).
3. Click **SMTP credentials** on the domain page.
4. Copy the SMTP hostname, port, login, and password shown.
5. Use the values directly in `.env`. `SMTP_FROM` must be an address on your verified Mailgun domain.

### Brevo (Sendinblue) / SendGrid / Other transactional services

All major transactional email providers expose standard SMTP. Look for an **SMTP relay** or **SMTP settings** page in their dashboard. The values you need are always:

| Variable | What it maps to |
|---|---|
| `SMTP_HOST` | The server hostname (e.g. `smtp-relay.brevo.com`) |
| `SMTP_PORT` | Usually `587` (STARTTLS) or `465` (SSL) |
| `SMTP_USER` | Your login / API key username |
| `SMTP_PASS` | Your password or API key |
| `SMTP_FROM` | A sender address verified in their dashboard |

---

## 5. Setting up the `.env` file

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` and replace every placeholder with your real values:

```dotenv
# ── Supabase (web app) ──────────────────────────────────────────────────────
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co   # Project URL (section 3.2)
VITE_SUPABASE_ANON_KEY=eyJ...                            # anon/public key (section 3.3)

# ── Supabase (worker + Edge Functions) ─────────────────────────────────────
SUPABASE_URL=https://abcdefghijklmnop.supabase.co        # same Project URL
SUPABASE_SERVICE_ROLE_KEY=eyJ...                         # service_role key (section 3.4)

# ── SMTP ────────────────────────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com      # SMTP server hostname
SMTP_PORT=587                 # 587 for STARTTLS, 465 for SSL
SMTP_USER=you@gmail.com       # SMTP login
SMTP_PASS=xxxx xxxx xxxx xxxx # SMTP password or app password
SMTP_FROM=you@gmail.com       # Sender address shown to recipients

# ── Worker tuning (optional) ────────────────────────────────────────────────
APP_POLL_INTERVAL_MS=5000     # How often the worker checks for new jobs (ms)
```

Both services validate these variables at startup and will print a clear error message if anything is missing or malformed.

---

## 6. Setting up the database and Edge Functions

### 6.1 Apply SQL migrations

There are two migration files that must be applied **in order**. The easiest way is through the Supabase SQL Editor:

1. In your Supabase project, click **SQL Editor** in the sidebar.
2. Click **New query**.
3. Open `supabase/migrations/20260428_initial_schema.sql` in your editor, copy the entire contents, paste into the SQL Editor, and click **Run**.
4. Repeat for `supabase/migrations/20260428_queue_refinements.sql`.

Alternatively, use the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push
```

### 6.2 Deploy Edge Functions

Install the Supabase CLI if you haven't:

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>   # the part before .supabase.co
```

Deploy all four functions:

```bash
supabase functions deploy create-campaign
supabase functions deploy list-campaigns
supabase functions deploy get-campaign
supabase functions deploy cancel-campaign
```

Set the service role key as a secret so Edge Functions can access it:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

---

## 7. Running the app locally

Install all dependencies (run once from the repo root):

```bash
npm install
```

Start the web app (terminal 1):

```bash
npm run dev:web
```

The frontend will be available at [http://localhost:5173](http://localhost:5173).

Start the SMTP worker (terminal 2):

```bash
npm run dev:worker
```

The worker prints a log line each time it polls and whenever it picks up a job. Keep this terminal open — emails are not sent without it.

---

## 8. Using the app

### 8.1 Compose a campaign

1. Open [http://localhost:5173](http://localhost:5173) in your browser.
2. You are on the **Compose** tab by default.
3. Fill in:
   - **Campaign name** — internal label, not visible to recipients.
   - **Subject** — the email subject line. Supports merge tags (see below).
   - **HTML body** — the full HTML of the email. Supports merge tags.
4. Add recipients (see section 8.2).
5. Choose when to send:
   - **Send immediately** — the campaign is queued as soon as you submit.
   - **Schedule for later** — pick a date and time; the worker will wait until then.
6. Click **Send campaign** (or **Schedule campaign**).

### 8.2 Adding recipients

You can add recipients in two ways:

**Paste directly** — type or paste one email per line in the text area:
```
alice@example.com
bob@example.com
```

**Upload a CSV** — click **Upload CSV**. The file must have at least one column named `email`. Any additional columns become merge tag data:

```csv
email,name,company
alice@example.com,Alice,Acme Corp
bob@example.com,Bob,Globex
```

### 8.3 Using merge tags

Merge tags let you personalise each email with recipient-specific data. Use double curly braces in the subject or HTML body:

```
Hello {{name}}, welcome to {{company}}!
```

The tag name must exactly match a column header in your CSV (case-sensitive). If a recipient is missing a value for a tag, the placeholder is left in the email unchanged.

### 8.4 Monitoring in the History tab

Click **History** to see all campaigns.

| Status | Meaning |
|---|---|
| `scheduled` | Waiting for the scheduled time |
| `queued` | Ready to send, worker will pick it up |
| `sending` | Worker is actively sending emails |
| `completed` | All emails dispatched |
| `failed` | Worker encountered an unrecoverable error |
| `cancelled` | You cancelled it before completion |

Click any campaign to open the detail view. You can see:
- Per-recipient delivery status (`sent`, `failed`, `pending`, etc.)
- Error messages for recipients that failed (hover or expand a row)

### 8.5 Cancelling a campaign

On the History tab or campaign detail page, click **Cancel** while the campaign is in `scheduled`, `queued`, or `sending` state. The worker will stop processing remaining recipients. Emails that were already sent cannot be recalled.

---

## 9. Running with Docker

Make sure `.env` is filled in (section 5), then:

```bash
docker compose up --build
```

This starts two containers:

- **web** — static frontend served on port 4173 ([http://localhost:4173](http://localhost:4173))
- **smtp-worker** — the polling worker

Both containers read all variables from your local `.env` file automatically. To stop:

```bash
docker compose down
```

---

## 10. Troubleshooting

### Startup fails with "Missing required environment variable"

The app validates all variables on boot and will print which variable is missing. Check your `.env` file and ensure the variable name is spelled exactly as shown in section 5.

### Emails are not being sent

1. Make sure the worker is running (check the terminal or `docker compose logs smtp-worker`).
2. Verify your SMTP credentials by logging in to your email provider's dashboard.
3. Confirm `SMTP_FROM` is a verified sender address on your email provider — many providers reject mail from unverified addresses silently.
4. Check the campaign detail in the History tab for per-recipient error messages.

### Campaign is stuck in "sending"

If the worker process crashed mid-campaign, the job will be automatically recovered after **15 minutes** and resumed. You do not need to do anything — just restart the worker if it is not running.

### Supabase Edge Function returns a 401 or 403 error

The `SUPABASE_SERVICE_ROLE_KEY` secret may not be set in your Supabase project. Re-run:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

Then redeploy the functions:

```bash
supabase functions deploy create-campaign
supabase functions deploy list-campaigns
supabase functions deploy get-campaign
supabase functions deploy cancel-campaign
```

### CSV upload fails silently

Check that your CSV has a column named exactly `email` (lowercase). Other columns are optional but must have headers to be usable as merge tags.
