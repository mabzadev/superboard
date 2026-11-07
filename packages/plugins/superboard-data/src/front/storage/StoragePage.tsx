import { Button, Input, SwitchField } from "@superboard/front-ui/kumo";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsDependents,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import {
	Table as FrontTable,
	TableBody as FrontTableBody,
	TableCell as FrontTableCell,
	TableHead as FrontTableHead,
	TableHeader as FrontTableHeader,
	TableRow as FrontTableRow,
} from "@superboard/front-ui/ui/table.js";
import { useId, useState } from "react";

import { useDataPath, useDataResource } from "./resource.js";
import { DELETE, GET, PATCH, POST, PUT } from "./transport.js";
import {
	encode,
	objectPath,
	readBody,
	useAddressState,
	useDataAction,
	type Bucket,
	type BucketRules,
	type Page,
	type StoredObject,
} from "../console/client.js";
import { useDataConsoleI18n } from "../console/i18n.js";
import {
	BackButton,
	ConfirmPanel,
	DataPage,
	ErrorAlert,
	formatBytes,
	formatDate,
	isAccessRule,
	LoadState,
	Notice,
	Pager,
	RuleSelect,
	SectionTabs,
} from "../console/shared.js";

const megabyte = 1024 * 1024;
const typeSeparator = /[,\s]+/u;

interface BucketForm {
	public: boolean;
	maxMegabytes: string;
	allowedTypes: string;
	rules: BucketRules;
}

function bucketForm(bucket: Bucket): BucketForm {
	return {
		public: bucket.public,
		maxMegabytes: String(Math.max(1, Math.round(bucket.max_bytes / megabyte))),
		allowedTypes: bucket.allowed_types.join(", "),
		rules: bucket.rules,
	};
}

function bucketPayload(form: BucketForm) {
	const megabytes = Number(form.maxMegabytes);
	return {
		public: form.public,
		max_bytes: Number.isFinite(megabytes) && megabytes > 0 ? Math.round(megabytes * megabyte) : 0,
		allowed_types: form.allowedTypes
			.split(typeSeparator)
			.map((type) => type.trim().toLowerCase())
			.filter(Boolean),
		rules: form.rules,
	};
}

export default function StoragePage() {
	const { t } = useDataConsoleI18n();
	const base = useDataPath();
	const [bucket, setBucket] = useAddressState("bucket");
	if (!base)
		return (
			<DataPage title={t.storage.title} description={t.storage.description}>
				<Notice>{t.common.noProject}</Notice>
			</DataPage>
		);
	if (bucket)
		return (
			<BucketDetail
				key={bucket}
				base={base}
				name={bucket}
				onBack={() => {
					setBucket(null, ["tab"]);
				}}
			/>
		);
	return (
		<DataPage title={t.storage.title} description={t.storage.description}>
			<BucketsOverview
				base={base}
				onOpen={(name) => {
					setBucket(name, ["tab"]);
				}}
			/>
		</DataPage>
	);
}

function BucketsOverview({ base, onOpen }: { base: string; onOpen(name: string): void }) {
	const { t, locale } = useDataConsoleI18n();
	const buckets = useDataResource<Page<Bucket>>(`${base}/buckets`);
	return (
		<div className="space-y-6">
			<LoadState
				loading={buckets.loading && !buckets.data}
				error={buckets.error}
				onRetry={buckets.refresh}
			/>
			{buckets.data && buckets.data.items.length === 0 && <Notice>{t.storage.noBuckets}</Notice>}
			{buckets.data && buckets.data.items.length > 0 && (
				<FrontTable>
					<FrontTableHeader>
						<FrontTableRow>
							<FrontTableHead>{t.common.name}</FrontTableHead>
							<FrontTableHead>{t.storage.maxSize}</FrontTableHead>
							<FrontTableHead>{t.storage.types}</FrontTableHead>
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{buckets.data.items.map((bucket) => (
							<FrontTableRow key={bucket.name}>
								<FrontTableCell>
									<Button
										type="button"
										variant="ghost"
										onClick={() => {
											onOpen(bucket.name);
										}}
									>
										{bucket.name}
									</Button>
									<Badge variant={bucket.public ? "warning" : "default"}>
										{bucket.public ? t.storage.publicBadge : t.storage.privateBadge}
									</Badge>
								</FrontTableCell>
								<FrontTableCell>{formatBytes(bucket.max_bytes, locale, t)}</FrontTableCell>
								<FrontTableCell>
									{bucket.allowed_types.length
										? bucket.allowed_types.join(", ")
										: t.storage.anyType}
								</FrontTableCell>
							</FrontTableRow>
						))}
					</FrontTableBody>
				</FrontTable>
			)}
			<CreateBucketForm
				base={base}
				onCreated={(name) => {
					buckets.refresh();
					onOpen(name);
				}}
			/>
		</div>
	);
}

function BucketFields({ form, onChange }: { form: BucketForm; onChange(form: BucketForm): void }) {
	const { t } = useDataConsoleI18n();
	const operations = ["read", "write", "delete"] as const;
	return (
		<>
			<SettingsRow>
				<SwitchField
					label={t.storage.publicLabel}
					description={t.storage.publicHelp}
					checked={form.public}
					onCheckedChange={(checked) => {
						onChange({ ...form, public: checked });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<SettingsTextField
					label={t.storage.maxSize}
					description={t.storage.maxSizeHelp}
					inputMode="decimal"
					value={form.maxMegabytes}
					onChange={(event) => {
						onChange({ ...form, maxMegabytes: event.target.value });
					}}
				/>
				<SettingsTextField
					label={t.storage.allowedTypes}
					description={t.storage.allowedTypesHelp}
					value={form.allowedTypes}
					onChange={(event) => {
						onChange({ ...form, allowedTypes: event.target.value });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<p className="text-sm font-medium">{t.storage.rulesTitle}</p>
				<p className="text-xs text-kumo-subtle">{t.storage.rulesDescription}</p>
				{operations.map((operation) =>
					operation === "read" && form.public ? (
						<p key={operation} className="text-sm text-kumo-subtle">
							{t.storage.readPublic}
						</p>
					) : (
						<RuleSelect
							key={operation}
							label={t.common.ruleNames[operation]}
							value={form.rules[operation]}
							onChange={(rule) => {
								if (isAccessRule(rule))
									onChange({ ...form, rules: { ...form.rules, [operation]: rule } });
							}}
						/>
					),
				)}
			</SettingsRow>
		</>
	);
}

function CreateBucketForm({ base, onCreated }: { base: string; onCreated(name: string): void }) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [name, setName] = useState("");
	const [form, setForm] = useState<BucketForm>({
		public: false,
		maxMegabytes: "50",
		allowedTypes: "",
		rules: { read: "owner", write: "owner", delete: "owner" },
	});
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				action.run(async () => {
					const created = readBody<Bucket>(
						await POST(`${base}/buckets`, { name: name.trim(), ...bucketPayload(form) }),
					);
					onCreated(created.name);
				});
			}}
		>
			<SettingsSection title={t.storage.createTitle}>
				<SettingsRow>
					<SettingsTextField
						label={t.storage.bucketName}
						description={t.storage.bucketNameHelp}
						value={name}
						autoComplete="off"
						required
						onChange={(event) => {
							setName(event.target.value);
						}}
					/>
				</SettingsRow>
				<BucketFields form={form} onChange={setForm} />
			</SettingsSection>
			<ErrorAlert error={action.error} />
			<SettingsActions>
				<Button type="submit" variant="primary" disabled={action.busy || !name.trim()}>
					{t.storage.createBucket}
				</Button>
			</SettingsActions>
		</form>
	);
}

type BucketTab = "objects" | "settings" | "advanced";
const bucketTabs: readonly BucketTab[] = ["objects", "settings", "advanced"];

function BucketDetail({ base, name, onBack }: { base: string; name: string; onBack(): void }) {
	const { t } = useDataConsoleI18n();
	const [tabParameter, setTab] = useAddressState("tab");
	const buckets = useDataResource<Page<Bucket>>(`${base}/buckets`);
	const bucket = buckets.data?.items.find((item) => item.name === name) ?? null;
	const tab = bucketTabs.find((candidate) => candidate === tabParameter) ?? "objects";
	return (
		<DataPage title={name} description={t.storage.description}>
			<div>
				<BackButton label={t.storage.backToBuckets} onClick={onBack} />
			</div>
			<LoadState
				loading={buckets.loading && !buckets.data}
				error={buckets.error}
				onRetry={buckets.refresh}
			/>
			{buckets.data && !bucket && <p role="alert">{t.errors.generic}</p>}
			{bucket && (
				<>
					<div>
						<Badge variant={bucket.public ? "warning" : "default"}>
							{bucket.public ? t.storage.publicBadge : t.storage.privateBadge}
						</Badge>
					</div>
					<SectionTabs
						tabs={[
							["objects", t.storage.objectsTab],
							["settings", t.storage.settingsTab],
							["advanced", t.common.advanced],
						]}
						current={tab}
						onChange={(next) => {
							setTab(next === "objects" ? null : next);
						}}
					/>
					{tab === "objects" && <ObjectsBrowser base={base} bucket={bucket} />}
					{tab === "settings" && (
						<BucketSettings base={base} bucket={bucket} onSaved={buckets.refresh} />
					)}
					{tab === "advanced" && <BucketAdvanced base={base} bucket={bucket} onDeleted={onBack} />}
				</>
			)}
		</DataPage>
	);
}

function BucketSettings({
	base,
	bucket,
	onSaved,
}: {
	base: string;
	bucket: Bucket;
	onSaved(): void;
}) {
	const { t } = useDataConsoleI18n();
	const [form, setForm] = useState(() => bucketForm(bucket));
	const autosave = useSettingsAutosave({
		resourceKey: bucket.name,
		value: form,
		save: async (next) => {
			await PATCH(`${base}/buckets/${encode(bucket.name)}`, bucketPayload(next));
			onSaved();
		},
	});
	return (
		<div className="space-y-5">
			<SettingsSection title={t.storage.settingsTitle}>
				<BucketFields form={form} onChange={setForm} />
			</SettingsSection>
			<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
		</div>
	);
}

function ObjectsBrowser({ base, bucket }: { base: string; bucket: Bucket }) {
	const { t, locale } = useDataConsoleI18n();
	const fileId = useId();
	const [prefix, setPrefix] = useState("");
	const [cursors, setCursors] = useState<string[]>([]);
	const [file, setFile] = useState<File | null>(null);
	const [target, setTarget] = useState("");
	const [progress, setProgress] = useState(0);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const action = useDataAction();
	const query = new URLSearchParams({ limit: "100" });
	if (prefix) query.set("prefix", prefix);
	const cursor = cursors.at(-1);
	if (cursor) query.set("cursor", cursor);
	const objects = useDataResource<Page<StoredObject>>(
		`${base}/buckets/${encode(bucket.name)}/objects?${query}`,
	);
	const uploadPath = (selected: File) =>
		target.trim() || `${prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix}${selected.name}`;
	return (
		<div className="space-y-5">
			<form
				className="space-y-3 rounded-lg border border-kumo-line p-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (!file) return;
					setMessage(null);
					action.run(async () => {
						setProgress(0);
						await PUT(objectPath(base, bucket.name, uploadPath(file)), file, {
							headers: { "Content-Type": file.type || "application/octet-stream" },
							onProgress: setProgress,
						});
						setFile(null);
						setTarget("");
						setMessage(t.storage.uploaded);
						objects.refresh();
					});
				}}
			>
				<div className="space-y-2">
					<label htmlFor={fileId} className="block text-sm font-medium">
						{t.storage.chooseFile}
					</label>
					<Input
						id={fileId}
						type="file"
						className="w-full"
						disabled={action.busy}
						onChange={(event) => {
							setFile(event.target.files?.[0] ?? null);
						}}
					/>
				</div>
				{file && (
					<SettingsDependents>
						<SettingsTextField
							label={t.storage.uploadPath}
							description={t.storage.uploadPathHelp}
							value={target}
							placeholder={uploadPath(file)}
							onChange={(event) => {
								setTarget(event.target.value);
							}}
						/>
					</SettingsDependents>
				)}
				<SettingsActions>
					<Button type="submit" variant="primary" disabled={action.busy || !file}>
						{action.busy && file ? t.storage.uploading(progress) : t.storage.upload}
					</Button>
				</SettingsActions>
			</form>
			<SettingsTextField
				label={t.storage.prefix}
				value={prefix}
				onChange={(event) => {
					setPrefix(event.target.value);
					setCursors([]);
				}}
			/>
			{deleting && (
				<ConfirmPanel
					title={t.storage.deleteObject(deleting)}
					message={t.storage.deleteObjectMessage(deleting)}
					confirmLabel={t.common.delete}
					busy={action.busy}
					onCancel={() => {
						setDeleting(null);
					}}
					onConfirm={() => {
						action.run(async () => {
							await DELETE(objectPath(base, bucket.name, deleting));
							setDeleting(null);
							setMessage(t.storage.objectDeleted);
							objects.refresh();
						});
					}}
				/>
			)}
			<ErrorAlert error={action.error} />
			{message && <Notice>{message}</Notice>}
			<LoadState
				loading={objects.loading && !objects.data}
				error={objects.error}
				onRetry={objects.refresh}
			/>
			{objects.data && objects.data.items.length === 0 && <Notice>{t.storage.noObjects}</Notice>}
			{objects.data && objects.data.items.length > 0 && (
				<FrontTable>
					<FrontTableHeader>
						<FrontTableRow>
							<FrontTableHead>{t.storage.path}</FrontTableHead>
							<FrontTableHead>{t.common.size}</FrontTableHead>
							<FrontTableHead>{t.common.type}</FrontTableHead>
							<FrontTableHead>{t.common.updated}</FrontTableHead>
							<FrontTableHead>{t.common.actions}</FrontTableHead>
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{objects.data.items.map((item) => (
							<FrontTableRow key={item.path}>
								<FrontTableCell className="font-mono break-all">{item.path}</FrontTableCell>
								<FrontTableCell>{formatBytes(item.size, locale, t)}</FrontTableCell>
								<FrontTableCell>{item.content_type}</FrontTableCell>
								<FrontTableCell>{formatDate(item.updated_at, locale)}</FrontTableCell>
								<FrontTableCell>
									<div className="flex gap-2">
										<Button
											type="button"
											variant="secondary"
											size="sm"
											aria-label={t.storage.downloadObject(item.path)}
											disabled={action.busy}
											onClick={() => {
												action.run(async () => {
													await download(objectPath(base, bucket.name, item.path), item.path);
												});
											}}
										>
											{t.storage.download}
										</Button>
										<Button
											type="button"
											variant="secondary-destructive"
											size="sm"
											aria-label={t.storage.deleteObject(item.path)}
											onClick={() => {
												setMessage(null);
												setDeleting(item.path);
											}}
										>
											{t.common.delete}
										</Button>
									</div>
								</FrontTableCell>
							</FrontTableRow>
						))}
					</FrontTableBody>
				</FrontTable>
			)}
			<Pager
				hasPrevious={cursors.length > 0}
				next={objects.data?.nextCursor}
				onFirst={() => {
					setCursors([]);
				}}
				onNext={(next) => {
					setCursors((current) => [...current, next]);
				}}
			/>
		</div>
	);
}

async function download(path: string, objectName: string) {
	const response = await GET(path, { responseType: "blob" });
	const blob: unknown = response.data;
	if (!(blob instanceof Blob)) throw new Error("DOWNLOAD_FAILED");
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = objectName.split("/").at(-1) ?? objectName;
	link.click();
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1000);
}

function BucketAdvanced({
	base,
	bucket,
	onDeleted,
}: {
	base: string;
	bucket: Bucket;
	onDeleted(): void;
}) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [confirming, setConfirming] = useState(false);
	return (
		<SettingsSection title={t.storage.deleteBucket}>
			<SettingsRow>
				<p className="text-sm">{t.storage.deleteBucketMessage(bucket.name)}</p>
				{confirming ? (
					<ConfirmPanel
						title={t.storage.deleteBucket}
						message={t.storage.deleteBucketMessage(bucket.name)}
						expected={bucket.name}
						confirmLabel={t.storage.deleteBucket}
						busy={action.busy}
						onCancel={() => {
							setConfirming(false);
						}}
						onConfirm={() => {
							action.run(async () => {
								await DELETE(
									`${base}/buckets/${encode(bucket.name)}?confirm=${encode(bucket.name)}`,
								);
								onDeleted();
							});
						}}
					/>
				) : (
					<SettingsActions>
						<Button
							type="button"
							variant="destructive"
							onClick={() => {
								setConfirming(true);
							}}
						>
							{t.storage.deleteBucket}
						</Button>
					</SettingsActions>
				)}
				<ErrorAlert error={action.error} />
			</SettingsRow>
		</SettingsSection>
	);
}
