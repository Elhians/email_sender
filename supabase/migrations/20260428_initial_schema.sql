create extension if not exists pgcrypto;

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text not null,
  html_body text not null,
  status text not null check (status in ('draft', 'scheduled', 'queued', 'sending', 'completed', 'cancel_requested', 'cancelled', 'failed')),
  mode text not null check (mode in ('send_now', 'schedule')),
  scheduled_at timestamptz,
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email text not null,
  merge_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
  last_error text,
  smtp_message_id text,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists campaign_dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  run_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'queued', 'running', 'completed', 'cancelled', 'failed')),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists campaign_recipient_events (
  id uuid primary key default gen_random_uuid(),
  campaign_recipient_id uuid not null references campaign_recipients(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_campaigns_created_at on campaigns(created_at desc);
create index if not exists idx_campaigns_status on campaigns(status, scheduled_at);
create index if not exists idx_campaign_recipients_campaign on campaign_recipients(campaign_id, status);
create index if not exists idx_campaign_dispatch_jobs_due on campaign_dispatch_jobs(status, run_at);
create index if not exists idx_campaign_recipient_events_recipient on campaign_recipient_events(campaign_recipient_id, created_at desc);
