CREATE TABLE IF NOT EXISTS upgrade_records (
  id text PRIMARY KEY,
  kind text NOT NULL,
  owner_id text NOT NULL,
  workspace_id text NOT NULL,
  mission_id text REFERENCES missions(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS upgrade_record_scope ON upgrade_records(owner_id, workspace_id, kind, mission_id);
CREATE TABLE IF NOT EXISTS temporary_context (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL,
  mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  request_id text NOT NULL,
  data jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS temporary_context_expiry ON temporary_context(expires_at);
