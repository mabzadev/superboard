import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { ApiError } from "@superboard/front-ui/lib/ApiError.js";
import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export const ACCESS_RULES = ["public", "authenticated", "owner", "service"] as const;
export type AccessRule = (typeof ACCESS_RULES)[number];
export const FUNCTION_ACCESS = ["public", "authenticated", "service"] as const;
export type FunctionAccess = (typeof FUNCTION_ACCESS)[number];
export const COLUMN_TYPES = [
	"text",
	"integer",
	"number",
	"boolean",
	"json",
	"timestamp",
	"uuid",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface Page<T> {
	items: T[];
	nextCursor?: string;
	count?: number;
}

export interface DataStatus {
	project_id: number;
	features: {
		realtime: boolean;
		functions: boolean;
		function_secrets: boolean;
		image_transformations: boolean;
		vectors: boolean;
	};
	counts: { tables: number; buckets: number; functions: number };
}

export interface Column {
	name: string;
	type: ColumnType;
	nullable: boolean;
	default: unknown;
	unique: boolean;
	indexed: boolean;
	position: number;
}

export interface TableRules {
	read: AccessRule;
	insert: AccessRule;
	update: AccessRule;
	delete: AccessRule;
}

export interface Table {
	name: string;
	label: string | null;
	rules: TableRules;
	realtime: boolean;
	columns: Column[];
	created_at: string;
	updated_at: string;
	row_count?: number;
}

export type Row = Record<string, unknown>;

export interface SqlResult {
	columns: string[];
	rows: unknown[][];
	truncated: boolean;
}

export interface BucketRules {
	read: AccessRule;
	write: AccessRule;
	delete: AccessRule;
}

export interface Bucket {
	name: string;
	public: boolean;
	max_bytes: number;
	allowed_types: string[];
	rules: BucketRules;
	created_at: string;
	updated_at: string;
}

export interface StoredObject {
	bucket: string;
	path: string;
	owner_id: string | null;
	content_type: string;
	size: number;
	etag: string;
	created_at: string;
	updated_at: string;
}

export interface FunctionSchedule {
	cron: string;
	enabled: boolean;
	next_run_at: string;
	last_run_at: string | null;
}

export interface DataFunction {
	name: string;
	access: FunctionAccess;
	active_version: number | null;
	timeout_ms: number;
	vars: Record<string, string>;
	secret_names: string[];
	schedule: FunctionSchedule | null;
	created_at: string;
	updated_at: string;
}

export interface FunctionVersion {
	version: number;
	source_hash: string;
	created_by: string | null;
	created_at: string;
}

export interface FunctionDetails extends DataFunction {
	versions: FunctionVersion[];
	source: string | null;
}

export interface FunctionLog {
	level: string;
	message: string;
	at: string;
}

export interface FunctionRun {
	id: string;
	version: number | null;
	trigger: string;
	status: number;
	outcome: "ok" | "error" | "timeout";
	duration_ms: number;
	logs: FunctionLog[];
	error: string | null;
	started_at: string;
}

export interface InvocationResult {
	run_id: string;
	status: number;
	headers: Record<string, string>;
	body: string;
	logs: FunctionLog[];
	duration_ms: number;
}

export interface VectorCollection {
	name: string;
	rules: { read: AccessRule; write: AccessRule };
	item_count?: number;
	created_at: string;
	updated_at: string;
}

export interface ServiceKey {
	id: string;
	name: string;
	hint: string;
	created_by: string | null;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

export interface ProjectSettings {
	realtime_anonymous: boolean;
}

export const encode = encodeURIComponent;

export function readBody<T>(response: { data: unknown }): T {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The Data worker defines these operator response contracts.
	return response.data as T;
}

export type DataBrick = "database" | "storage" | "functions" | "vectors";

export function useBrickPath(brick: DataBrick): string | null {
	const { selectedProject } = useProjectSelection();
	return selectedProject ? `/api/v1/data/${brick}/projects/${encode(selectedProject.id)}` : null;
}

export function objectPath(base: string, bucket: string, path: string): string {
	return `${base}/buckets/${encode(bucket)}/objects/${path.split("/").map(encode).join("/")}`;
}

export function physicalTableName(projectId: number, table: string): string {
	return `adb_${projectId}_${table}`;
}

export function errorCode(cause: unknown): string | null {
	return cause instanceof ApiError ? (cause.code ?? null) : null;
}

export function errorDetail(cause: unknown): string | null {
	return cause instanceof Error && cause.message ? cause.message : null;
}

export function dataResourceHook(get: (path: string) => Promise<{ data: unknown }>) {
	return function useDataResource<T>(path: string | null) {
		const [version, setVersion] = useState(0);
		const [result, setResult] = useState<{
			key: string;
			path: string;
			data: T | null;
			error: unknown;
		} | null>(null);
		const key = `${path ?? ""}#${version}`;
		useEffect(() => {
			if (!path) return;
			let active = true;
			const load = async () => {
				try {
					const response = await get(path);
					if (active) setResult({ key, path, data: readBody<T>(response), error: null });
				} catch (cause) {
					if (active) setResult({ key, path, data: null, error: cause });
				}
			};
			load().catch(() => undefined);
			return () => {
				active = false;
			};
		}, [path, key]);
		const refresh = useCallback(() => {
			setVersion((current) => current + 1);
		}, []);
		const current = result?.key === key ? result : null;
		const sameResource = result !== null && result.path === path;
		return {
			data: sameResource ? result.data : null,
			error: current?.error ?? null,
			loading: path !== null && current === null,
			refresh,
		};
	}
}

export function useDataAction() {
	const lock = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const run = useCallback((action: () => Promise<void>) => {
		if (lock.current) return;
		lock.current = true;
		setBusy(true);
		setError(null);
		const execute = async () => {
			try {
				await action();
			} catch (cause) {
				setError(cause);
			} finally {
				lock.current = false;
				setBusy(false);
			}
		};
		execute().catch((cause: unknown) => {
			setError(cause);
		});
	}, []);
	const clear = useCallback(() => {
		setError(null);
	}, []);
	return { busy, error, run, clear };
}

export function useAddressState(name: string) {
	const router = useRouter();
	const pathname = usePathname();
	const address = useSearchParams();
	const value = address.get(name) || null;
	const set = useCallback(
		(next: string | null, reset: readonly string[] = []) => {
			const query = new URLSearchParams(address);
			for (const key of reset) query.delete(key);
			if (next === null) query.delete(name);
			else query.set(name, next);
			const search = query.toString();
			router.push(search ? `${pathname}?${search}` : pathname);
		},
		[address, name, pathname, router],
	);
	return [value, set] as const;
}
