export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_usage (
    owner_id TEXT PRIMARY KEY NOT NULL,
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0)
  );
  CREATE TABLE IF NOT EXISTS meetings (
    owner_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (owner_id, id)
  );
  CREATE TABLE IF NOT EXISTS matters (
    owner_id TEXT NOT NULL, id TEXT NOT NULL,
    reference TEXT COLLATE NOCASE NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (owner_id, id), UNIQUE (owner_id, reference)
  );
  CREATE TABLE IF NOT EXISTS exports (
    owner_id TEXT NOT NULL, meeting_id TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (owner_id, meeting_id)
  );
  CREATE TABLE IF NOT EXISTS metadata (
    owner_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (owner_id, key)
  );
`;
