-- Complete the public OpenGrow rename without modifying an already-applied migration.
ALTER TABLE billing_mirror_comparisons
  RENAME COLUMN grovs_active_entitlements TO opengrow_active_entitlements;
