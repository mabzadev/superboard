-- Complete the public SuperBoard rename without modifying an already-applied migration.
ALTER TABLE billing_mirror_comparisons
  RENAME COLUMN grovs_active_entitlements TO superboard_active_entitlements;
