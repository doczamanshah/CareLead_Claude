-- Security audit log for auth / session events.
--
-- This table is admin/service-only. Users can insert their own events
-- (fire-and-forget from the client) but can never read from it. Only the
-- service role can read.
--
-- HIPAA notes:
--   • Do NOT store IP address (policy: we don't log client IPs).
--   • device_info contains generic platform only ("ios" | "android" | "web"),
--     never device IDs or model strings.
--   • detail is non-PHI metadata only (auth method, success flags, error
--     codes). Never names, phone numbers, email addresses, or health data.

create table if not exists security_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  device_info text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_log_user_id_idx
  on security_audit_log (user_id, created_at desc);

create index if not exists security_audit_log_event_type_idx
  on security_audit_log (event_type, created_at desc);

alter table security_audit_log enable row level security;

-- Authenticated users can insert only their own events (or anonymous events
-- for failed sign-in attempts where user_id is null).
drop policy if exists "users_insert_own_audit_events" on security_audit_log;
create policy "users_insert_own_audit_events"
  on security_audit_log
  for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

-- Anonymous users can insert events with null user_id (e.g., otp_requested
-- before a session exists).
drop policy if exists "anon_insert_audit_events" on security_audit_log;
create policy "anon_insert_audit_events"
  on security_audit_log
  for insert
  to anon
  with check (user_id is null);

-- No select/update/delete policies. Only service role can read or modify.
