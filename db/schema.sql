CREATE TABLE IF NOT EXISTS ec_workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES "user"(id),
  state jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  background_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  lease_until timestamptz,
  lease_token text
);
CREATE TABLE IF NOT EXISTS ec_members (
  workspace_id text NOT NULL REFERENCES ec_workspaces(id),
  user_id text PRIMARY KEY REFERENCES "user"(id)
);
CREATE INDEX IF NOT EXISTS ec_members_workspace_idx ON ec_members(workspace_id);
CREATE TABLE IF NOT EXISTS ec_snapshots (
  id bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES ec_workspaces(id),
  revision integer NOT NULL,
  state jsonb NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ec_snapshots_workspace_idx ON ec_snapshots(workspace_id, id DESC);
CREATE TABLE IF NOT EXISTS ec_invites (
  token_hash text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES ec_workspaces(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
