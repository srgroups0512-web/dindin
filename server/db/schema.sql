CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE subscription_platform AS ENUM ('android', 'ios');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('pending', 'active', 'grace_period', 'paused', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE check_in_status AS ENUM ('scheduled', 'waiting', 'safe', 'missed', 'send_failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  display_name text NOT NULL,
  phone_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_challenges_phone_created_idx ON otp_challenges (phone_e164, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_push_tokens_user_idx ON device_push_tokens (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications boolean NOT NULL DEFAULT true,
  sounds boolean NOT NULL DEFAULT true,
  request_location_after_missed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS vibration boolean NOT NULL DEFAULT true;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS safety_location_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_safety_locations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters double precision CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  captured_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform subscription_platform NOT NULL,
  product_id text NOT NULL,
  status subscription_status NOT NULL DEFAULT 'pending',
  store_transaction_id text NOT NULL UNIQUE,
  original_transaction_id text,
  purchase_token_hash text,
  current_period_ends_at timestamptz,
  raw_store_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS purchase_type text NOT NULL DEFAULT 'subscription';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS base_plan_id text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_renewing boolean NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS purchase_token_encrypted text;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_purchase_type_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_purchase_type_check
  CHECK (purchase_type IN ('subscription', 'lifetime'));
CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx ON subscriptions (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_purchase_token_hash_idx
  ON subscriptions (purchase_token_hash) WHERE purchase_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_phone_e164 text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, member_phone_e164)
);
CREATE INDEX IF NOT EXISTS family_members_owner_idx
  ON family_members (owner_user_id, created_at);

CREATE TABLE IF NOT EXISTS relatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  relationship text NOT NULL,
  phone_e164 text NOT NULL,
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, phone_e164)
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  relationship text NOT NULL,
  phone_e164 text NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS emergency_contacts_owner_idx ON emergency_contacts (owner_user_id, created_at);

CREATE TABLE IF NOT EXISTS self_check_in_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  local_time time NOT NULL,
  interval_days smallint NOT NULL CHECK (interval_days BETWEEN 1 AND 30),
  times_per_day smallint NOT NULL DEFAULT 1 CHECK (times_per_day BETWEEN 1 AND 12),
  intra_day_interval_minutes smallint NOT NULL DEFAULT 0 CHECK (intra_day_interval_minutes BETWEEN 0 AND 1439),
  reminder_times text[] NOT NULL DEFAULT ARRAY['18:00']::text[],
  weekdays smallint[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::smallint[],
  reminders jsonb NOT NULL DEFAULT '[]'::jsonb,
  development_preview boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  status check_in_status NOT NULL DEFAULT 'scheduled',
  stage smallint NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 2),
  started_at timestamptz,
  last_response_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE self_check_in_schedules ADD COLUMN IF NOT EXISTS times_per_day smallint NOT NULL DEFAULT 1;
ALTER TABLE self_check_in_schedules ADD COLUMN IF NOT EXISTS intra_day_interval_minutes smallint NOT NULL DEFAULT 0;
ALTER TABLE self_check_in_schedules ADD COLUMN IF NOT EXISTS reminder_times text[];
ALTER TABLE self_check_in_schedules ADD COLUMN IF NOT EXISTS weekdays smallint[];
ALTER TABLE self_check_in_schedules ADD COLUMN IF NOT EXISTS reminders jsonb;
ALTER TABLE self_check_in_schedules ADD COLUMN IF NOT EXISTS development_preview boolean NOT NULL DEFAULT false;
UPDATE self_check_in_schedules schedule
SET reminder_times = ARRAY(
  SELECT to_char(
    schedule.local_time + make_interval(mins => slot * schedule.intra_day_interval_minutes),
    'HH24:MI'
  )
  FROM generate_series(0, GREATEST(schedule.times_per_day - 1, 0)) AS slot
)
WHERE reminder_times IS NULL OR cardinality(reminder_times) = 0;
UPDATE self_check_in_schedules
SET weekdays = ARRAY[0,1,2,3,4,5,6]::smallint[]
WHERE weekdays IS NULL OR cardinality(weekdays) = 0;
UPDATE self_check_in_schedules schedule
SET reminders = (
  SELECT jsonb_agg(jsonb_build_object(
    'id', 'legacy-' || item.ordinality,
    'time', item.reminder_time,
    'weekdays', to_jsonb(schedule.weekdays)
  ) ORDER BY item.ordinality)
  FROM unnest(schedule.reminder_times) WITH ORDINALITY AS item(reminder_time, ordinality)
)
WHERE reminders IS NULL OR reminders = '[]'::jsonb;
ALTER TABLE self_check_in_schedules ALTER COLUMN reminder_times SET DEFAULT ARRAY['18:00']::text[];
ALTER TABLE self_check_in_schedules ALTER COLUMN reminder_times SET NOT NULL;
ALTER TABLE self_check_in_schedules ALTER COLUMN weekdays SET DEFAULT ARRAY[0,1,2,3,4,5,6]::smallint[];
ALTER TABLE self_check_in_schedules ALTER COLUMN weekdays SET NOT NULL;
ALTER TABLE self_check_in_schedules ALTER COLUMN reminders SET DEFAULT '[]'::jsonb;
ALTER TABLE self_check_in_schedules ALTER COLUMN reminders SET NOT NULL;
ALTER TABLE self_check_in_schedules DROP CONSTRAINT IF EXISTS self_check_in_schedules_interval_days_check;
ALTER TABLE self_check_in_schedules ADD CONSTRAINT self_check_in_schedules_interval_days_check CHECK (interval_days BETWEEN 1 AND 30);
ALTER TABLE self_check_in_schedules DROP CONSTRAINT IF EXISTS self_check_in_schedules_times_per_day_check;
ALTER TABLE self_check_in_schedules ADD CONSTRAINT self_check_in_schedules_times_per_day_check CHECK (times_per_day BETWEEN 1 AND 12);
ALTER TABLE self_check_in_schedules DROP CONSTRAINT IF EXISTS self_check_in_schedules_intra_day_interval_minutes_check;
ALTER TABLE self_check_in_schedules ADD CONSTRAINT self_check_in_schedules_intra_day_interval_minutes_check CHECK (intra_day_interval_minutes BETWEEN 0 AND 1439);
CREATE INDEX IF NOT EXISTS self_check_in_schedules_due_idx ON self_check_in_schedules (next_run_at) WHERE active;

CREATE TABLE IF NOT EXISTS self_check_in_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES self_check_in_schedules(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS self_check_in_events_schedule_created_idx ON self_check_in_events (schedule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS safety_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES self_check_in_schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurrence_at timestamptz,
  source text NOT NULL CHECK (source IN ('missed', 'user-not-okay', 'development-test')),
  latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  accuracy_meters double precision CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  location_captured_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE safety_alerts ADD COLUMN IF NOT EXISTS occurrence_at timestamptz;
CREATE INDEX IF NOT EXISTS safety_alerts_schedule_created_idx
  ON safety_alerts (schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS safety_alerts_expiry_idx ON safety_alerts (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS safety_alerts_schedule_occurrence_unique_idx
  ON safety_alerts (schedule_id, occurrence_at)
  WHERE occurrence_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS safety_alert_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES safety_alerts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES emergency_contacts(id) ON DELETE CASCADE,
  reminder_count smallint NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 3),
  delivery_failure_count smallint NOT NULL DEFAULT 0 CHECK (delivery_failure_count BETWEEN 0 AND 3),
  next_reminder_at timestamptz,
  acknowledged_at timestamptz,
  last_template_name text,
  last_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, contact_id)
);
CREATE INDEX IF NOT EXISTS safety_alert_recipients_pending_idx
  ON safety_alert_recipients (next_reminder_at)
  WHERE acknowledged_at IS NULL AND next_reminder_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS safety_alert_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES safety_alert_recipients(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'techies',
  provider_message_id text NOT NULL UNIQUE,
  template_name text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_alert_deliveries_recipient_idx
  ON safety_alert_deliveries (recipient_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS check_in_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relative_id uuid NOT NULL REFERENCES relatives(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  local_time time NOT NULL,
  interval_days smallint NOT NULL CHECK (interval_days IN (1, 2, 7)),
  reminder_count smallint NOT NULL DEFAULT 2 CHECK (reminder_count BETWEEN 0 AND 2),
  request_location_after_missed boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS check_in_schedules_due_idx ON check_in_schedules (next_run_at) WHERE active;

-- The current product checks in the app user. Disable schedules from the retired
-- relative-messaging flow so a migration cannot continue sending legacy prompts.
UPDATE check_in_schedules SET active = false, updated_at = now() WHERE active = true;

CREATE TABLE IF NOT EXISTS check_in_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES check_in_schedules(id) ON DELETE CASCADE,
  status check_in_status NOT NULL DEFAULT 'scheduled',
  scheduled_for timestamptz NOT NULL,
  started_at timestamptz,
  responded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS check_in_runs_schedule_time_idx ON check_in_runs (schedule_id, scheduled_for);
CREATE INDEX IF NOT EXISTS check_in_runs_status_idx ON check_in_runs (status, scheduled_for);

CREATE TABLE IF NOT EXISTS check_in_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_in_run_id uuid NOT NULL REFERENCES check_in_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  external_message_id text,
  idempotency_key text UNIQUE,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS check_in_events_run_created_idx ON check_in_events (check_in_run_id, created_at);

CREATE TABLE IF NOT EXISTS location_share_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_run_id uuid NOT NULL REFERENCES check_in_runs(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consented_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_share_grants_expiry_idx ON location_share_grants (expires_at);

CREATE TABLE IF NOT EXISTS location_points (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES location_share_grants(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters double precision CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_points_grant_captured_idx ON location_points (grant_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS processed_webhooks (
  provider text NOT NULL,
  external_event_id text NOT NULL,
  payload_sha256 text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_event_id)
);
