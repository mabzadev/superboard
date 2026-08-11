export interface RuntimeD1Migration {
  name: string;
  queries: string[];
}

export function d1RuntimeBindings(migrations: RuntimeD1Migration[]): {
  D1_EXPECTED_MIGRATION: string;
  TEST_MIGRATIONS: RuntimeD1Migration[];
};
