-- Queue refinements: add retry tracking columns, locking helpers, and partial indexes.
-- Apply this migration after 20260428_initial_schema.sql.

-- ─── Column additions ─────────────────────────────────────────────────────────

alter table campaign_recipients
  add column if not exists last_attempt_at timestamptz;

alter table campaign_dispatch_jobs
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts  integer not null default 3,
  add column if not exists last_attempt_at timestamptz;

-- ─── Atomic job claim ────────────────────────────────────────────────────────
-- The worker calls this via supabase.rpc('claim_dispatch_job', {p_worker_id}).
-- FOR UPDATE SKIP LOCKED prevents two worker instances from claiming the same job.

create or replace function claim_dispatch_job(p_worker_id text)
returns setof campaign_dispatch_jobs
language sql
as $$
  update campaign_dispatch_jobs
  set status         = 'running',
      locked_by      = p_worker_id,
      locked_at      = now(),
      attempt_count  = attempt_count + 1,
      last_attempt_at = now()
  where id = (
    select id
    from   campaign_dispatch_jobs
    where  status in ('scheduled', 'queued')
      and  run_at <= now()
      and  attempt_count < max_attempts
    order  by run_at
    limit  1
    for update skip locked
  )
  returning *;
$$;

-- ─── Atomic recipient batch claim ────────────────────────────────────────────
-- The worker calls this in a loop until it gets an empty result set.

create or replace function claim_recipient_batch(
  p_campaign_id uuid,
  p_batch_size   int default 50
)
returns setof campaign_recipients
language sql
as $$
  update campaign_recipients
  set status          = 'sending',
      attempt_count   = attempt_count + 1,
      last_attempt_at = now()
  where id in (
    select id
    from   campaign_recipients
    where  campaign_id = p_campaign_id
      and  status in ('pending', 'queued')
    order  by created_at
    limit  p_batch_size
    for update skip locked
  )
  returning *;
$$;

-- ─── Stale lease recovery ─────────────────────────────────────────────────────
-- Requeue jobs whose worker crashed and left them in 'running' state.

create or replace function reset_stale_jobs(p_timeout_minutes int default 15)
returns int
language sql
as $$
  with updated as (
    update campaign_dispatch_jobs
    set status    = 'queued',
        locked_by = null,
        locked_at = null
    where status     = 'running'
      and locked_at < now() - (p_timeout_minutes || ' minutes')::interval
    returning id
  )
  select count(*)::int from updated;
$$;

-- ─── Partial indexes for efficient queue polling ──────────────────────────────

drop index if exists idx_campaign_dispatch_jobs_due;

create index if not exists idx_dispatch_jobs_due
  on campaign_dispatch_jobs(run_at)
  where status in ('scheduled', 'queued');

create index if not exists idx_recipients_pending
  on campaign_recipients(campaign_id, created_at)
  where status in ('pending', 'queued');
