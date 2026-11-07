CREATE INDEX IF NOT EXISTS idx_data_objects_owner_id ON data_objects(owner_id);
CREATE INDEX IF NOT EXISTS idx_data_uploads_owner_id ON data_uploads(owner_id);
CREATE INDEX IF NOT EXISTS idx_data_vector_items_owner_id ON data_vector_items(owner_id);
