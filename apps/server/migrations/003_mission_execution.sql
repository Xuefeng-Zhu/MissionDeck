CREATE UNIQUE INDEX IF NOT EXISTS execution_request_unique ON upgrade_records(owner_id, workspace_id, (data->>'requestId')) WHERE kind='mission_execution';
CREATE TABLE IF NOT EXISTS mission_execution_leases (
  mission_id text PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  holder text NOT NULL,
  expires_at timestamptz NOT NULL
);
