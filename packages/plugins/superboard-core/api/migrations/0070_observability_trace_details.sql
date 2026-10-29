CREATE TABLE IF NOT EXISTS observability_observation_details (
  instance_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (instance_id, observation_id),
  FOREIGN KEY (instance_id, observation_id)
    REFERENCES observability_observations(instance_id, observation_id) ON DELETE CASCADE
);
