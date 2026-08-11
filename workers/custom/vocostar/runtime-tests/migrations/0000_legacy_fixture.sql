CREATE TABLE users (
  id TEXT PRIMARY KEY,
  premium INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  is_anonymous INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE app_vocals (
  id TEXT PRIMARY KEY,
  refs TEXT
);

CREATE TABLE users_vocals (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  refs TEXT,
  language TEXT,
  progress REAL DEFAULT 0.2,
  job INTEGER DEFAULT 0,
  processed_at TEXT,
  error TEXT,
  created_at TEXT
);

CREATE TABLE users_medias (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  vocal_id TEXT,
  vocal_type TEXT,
  media_type TEXT,
  job INTEGER DEFAULT 0,
  progress REAL DEFAULT 0.2,
  input TEXT,
  output TEXT,
  processed_at TEXT,
  created_at TEXT
);

CREATE TABLE send_users_vocals (
  id TEXT PRIMARY KEY,
  user_vocal_id TEXT,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT,
  processed_at TEXT
);

CREATE TABLE send_users_medias (
  id TEXT PRIMARY KEY,
  user_media_id TEXT,
  event_type TEXT,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT,
  processed_at TEXT
);
