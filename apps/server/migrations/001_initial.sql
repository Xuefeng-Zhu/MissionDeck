CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS missions (
  id text PRIMARY KEY, owner_id text NOT NULL, workspace_id text NOT NULL,
  revision integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mission_scope ON missions(owner_id, workspace_id);
CREATE TABLE IF NOT EXISTS criteria (id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS evidence (id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, content_hash text NOT NULL, data jsonb NOT NULL, UNIQUE(mission_id, content_hash));
CREATE TABLE IF NOT EXISTS proposals (id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, payload_hash text NOT NULL, state text NOT NULL, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, proposal_id text NOT NULL UNIQUE REFERENCES proposals(id) ON DELETE CASCADE, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS operations (
  id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  idempotency_key text UNIQUE NOT NULL, state text NOT NULL, data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE, owner_id text NOT NULL, workspace_id text NOT NULL,
  payload jsonb NOT NULL, state text NOT NULL CHECK (state IN ('pending','running','done','failed','outcome_unknown','conflict')),
  claimed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_fixtures (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, owner_id text NOT NULL, workspace_id text NOT NULL, origin text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS integration_verifications (identity_key text PRIMARY KEY, create_verified boolean NOT NULL DEFAULT false, update_verified boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
