export async function isFlowsLegacyCutoverEnabled(
  db: D1Database,
  projectId: number,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT enabled FROM flows_legacy_cutover_state
     WHERE project_id = ? LIMIT 1`,
  ).bind(projectId).first<{ enabled: number }>().catch(() => null);
  return Number(row?.enabled ?? 0) === 1;
}
