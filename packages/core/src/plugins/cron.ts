import { Cron } from "croner";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { ulid } from "ulidx";

import type { Database } from "../database/types.js";
import { isMissingTableError } from "../utils/db-errors.js";
import type { CronAccess, CronEvent, CronTaskInfo } from "./types.js";

const STALE_LOCK_MINUTES = 10;

export type InvokeCronHookFn = (pluginId: string, event: CronEvent) => Promise<void>;

export type RescheduleFn = () => void;

export class CronExecutor {
	private readonly resolveDb: () => Kysely<Database>;

	constructor(
		db: Kysely<Database> | (() => Kysely<Database>),
		private invokeCronHook: InvokeCronHookFn,
	) {
		this.resolveDb = typeof db === "function" ? db : () => db;
	}

	private get db(): Kysely<Database> {
		return this.resolveDb();
	}

	async tick(): Promise<number> {
		const now = new Date().toISOString();
		let processed = 0;

		const claimed = await sql<{
			id: string;
			plugin_id: string;
			task_name: string;
			schedule: string;
			is_oneshot: number;
			data: string | null;
			next_run_at: string;
		}>`
			UPDATE _emdash_cron_tasks
			SET status = 'running', locked_at = ${now}
			WHERE id IN (
				SELECT id FROM _emdash_cron_tasks
				WHERE next_run_at <= ${now}
				  AND status = 'idle'
				  AND enabled = 1
				ORDER BY next_run_at ASC
				LIMIT 10
			)
			RETURNING id, plugin_id, task_name, schedule, is_oneshot, data, next_run_at
		`.execute(this.db);

		for (const task of claimed.rows) {
			let parsedData: Record<string, unknown> | undefined;
			if (task.data) {
				try {
					parsedData = JSON.parse(task.data) as Record<string, unknown>;
				} catch {
					console.error(
						`[cron] Invalid JSON data for ${task.plugin_id}:${task.task_name}, skipping`,
					);
					await sql`
						UPDATE _emdash_cron_tasks
						SET status = 'idle', locked_at = NULL
						WHERE id = ${task.id}
					`.execute(this.db);
					continue;
				}
			}

			const event: CronEvent = {
				name: task.task_name,
				data: parsedData,
				scheduledAt: task.next_run_at,
			};

			let hookFailed = false;
			try {
				await this.invokeCronHook(task.plugin_id, event);
			} catch (error) {
				hookFailed = true;
				console.error(`[cron] Hook failed for ${task.plugin_id}:${task.task_name}:`, error);
			}

			if (task.is_oneshot) {
				if (hookFailed) {
					const meta =
						parsedData?.__emdash != null && typeof parsedData.__emdash === "object"
							? (parsedData.__emdash as Record<string, unknown>)
							: undefined;
					const raw = meta?.retryCount;
					const retryCount =
						typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
					const MAX_ONESHOT_RETRIES = 5;

					if (retryCount >= MAX_ONESHOT_RETRIES) {
						console.error(
							`[cron] One-shot task ${task.plugin_id}:${task.task_name} exceeded ${MAX_ONESHOT_RETRIES} retries, removing`,
						);
						await sql`
						DELETE FROM _emdash_cron_tasks WHERE id = ${task.id}
					`.execute(this.db);
					} else {
						const backoffMs = 60_000 * Math.pow(2, retryCount);
						const retryAt = new Date(Date.now() + backoffMs).toISOString();
						const updatedData = JSON.stringify({
							...parsedData,
							__emdash: { ...meta, retryCount: retryCount + 1 },
						});
						await sql`
						UPDATE _emdash_cron_tasks
						SET status = 'idle', locked_at = NULL, next_run_at = ${retryAt}, data = ${updatedData}
						WHERE id = ${task.id}
					`.execute(this.db);
					}
				} else {
					await sql`
						DELETE FROM _emdash_cron_tasks WHERE id = ${task.id}
					`.execute(this.db);
				}
			} else {
				const nextRun = nextCronTime(task.schedule);
				await sql`
					UPDATE _emdash_cron_tasks
					SET status = 'idle',
						locked_at = NULL,
						last_run_at = ${now},
						next_run_at = ${nextRun}
					WHERE id = ${task.id}
				`.execute(this.db);
			}

			processed++;
		}

		return processed;
	}

	async recoverStaleLocks(): Promise<number> {
		const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000).toISOString();

		const result = await sql`
			UPDATE _emdash_cron_tasks
			SET status = 'idle', locked_at = NULL
			WHERE status = 'running'
			  AND locked_at < ${cutoff}
		`.execute(this.db);

		return Number(result.numAffectedRows ?? 0);
	}

	async getNextDueTime(): Promise<string | null> {
		const result = await sql<{ next: string | null }>`
			SELECT MIN(next_run_at) as next
			FROM _emdash_cron_tasks
			WHERE status = 'idle' AND enabled = 1
		`.execute(this.db);

		return result.rows[0]?.next ?? null;
	}
}

export class CronAccessImpl implements CronAccess {
	constructor(
		private db: Kysely<Database>,
		private pluginId: string,
		private reschedule: RescheduleFn,
	) {}

	async schedule(
		name: string,
		opts: { schedule: string; data?: Record<string, unknown> },
	): Promise<void> {
		validateTaskName(name);
		validateSchedule(opts.schedule);

		const oneshot = isOneShot(opts.schedule);
		const nextRun = oneshot ? opts.schedule : nextCronTime(opts.schedule);
		const dataJson = opts.data ? JSON.stringify(opts.data) : null;
		const id = ulid();

		await sql`
			INSERT INTO _emdash_cron_tasks (id, plugin_id, task_name, schedule, is_oneshot, data, next_run_at, status, enabled)
			VALUES (${id}, ${this.pluginId}, ${name}, ${opts.schedule}, ${oneshot ? 1 : 0}, ${dataJson}, ${nextRun}, 'idle', 1)
			ON CONFLICT (plugin_id, task_name) DO UPDATE SET
				schedule = ${opts.schedule},
				is_oneshot = ${oneshot ? 1 : 0},
				data = ${dataJson},
				next_run_at = ${nextRun},
				status = CASE WHEN _emdash_cron_tasks.status = 'running' THEN 'running' ELSE 'idle' END,
				locked_at = CASE WHEN _emdash_cron_tasks.status = 'running' THEN _emdash_cron_tasks.locked_at ELSE NULL END,
				enabled = 1
		`.execute(this.db);

		this.reschedule();
	}

	async cancel(name: string): Promise<void> {
		await sql`
			DELETE FROM _emdash_cron_tasks
			WHERE plugin_id = ${this.pluginId} AND task_name = ${name}
		`.execute(this.db);

		this.reschedule();
	}

	async list(): Promise<CronTaskInfo[]> {
		const rows = await sql<{
			task_name: string;
			schedule: string;
			next_run_at: string;
			last_run_at: string | null;
		}>`
			SELECT task_name, schedule, next_run_at, last_run_at
			FROM _emdash_cron_tasks
			WHERE plugin_id = ${this.pluginId} AND enabled = 1
			ORDER BY next_run_at ASC
		`.execute(this.db);

		return rows.rows.map((row) => ({
			name: row.task_name,
			schedule: row.schedule,
			nextRunAt: row.next_run_at,
			lastRunAt: row.last_run_at,
		}));
	}
}

export async function setCronTasksEnabled(
	db: Kysely<Database>,
	pluginId: string,
	enabled: boolean,
): Promise<void> {
	try {
		await sql`
			UPDATE _emdash_cron_tasks
			SET enabled = ${enabled ? 1 : 0}
			WHERE plugin_id = ${pluginId}
		`.execute(db);
	} catch (error) {
		if (!isMissingTableError(error)) throw error;
	}
}

export function nextCronTime(expression: string): string {
	const job = new Cron(expression);
	const next = job.nextRun();
	if (!next) {
		throw new Error(`Invalid cron expression or no future run: "${expression}"`);
	}
	return next.toISOString();
}

function isCronExpression(schedule: string): boolean {
	try {
		const _cron = new Cron(schedule);
		void _cron;
		return true;
	} catch {
		return false;
	}
}

export function isOneShot(schedule: string): boolean {
	if (schedule.startsWith("@")) return false;
	if (isCronExpression(schedule)) return false;
	return !isNaN(Date.parse(schedule));
}

const MAX_TASK_NAME_LENGTH = 128;
const TASK_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function validateTaskName(name: string): void {
	if (!name || name.length > MAX_TASK_NAME_LENGTH) {
		throw new Error(
			`Invalid task name: must be 1-${MAX_TASK_NAME_LENGTH} characters, got ${name.length}`,
		);
	}
	if (!TASK_NAME_RE.test(name)) {
		throw new Error(
			`Invalid task name "${name}": must start with a letter and contain only letters, numbers, dashes, or underscores`,
		);
	}
}

export function validateSchedule(schedule: string): void {
	if (!schedule || schedule.length > 256) {
		throw new Error(`Invalid schedule: must be 1-256 characters, got ${schedule.length}`);
	}

	if (isCronExpression(schedule)) return;

	const parsed = Date.parse(schedule);
	if (isNaN(parsed)) {
		throw new Error(
			`Invalid schedule "${schedule}": must be a valid cron expression or ISO 8601 datetime`,
		);
	}
}
