import { Button } from "@superboard/front-ui/kumo";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useState } from "react";

import { DELETE, PATCH, POST } from "../transport.js";
import {
	encode,
	useDataAction,
	useDataPath,
	useDataResource,
	type AccessRule,
	type Page,
	type VectorCollection,
} from "./client.js";
import { useDataConsoleI18n } from "./i18n.js";
import {
	ConfirmPanel,
	DataPage,
	ErrorAlert,
	isAccessRule,
	LoadState,
	Notice,
	RuleSelect,
	StatusBadge,
} from "./shared.js";

type CollectionRules = VectorCollection["rules"];
const operations = ["read", "write"] as const;

export default function VectorsPage() {
	const { t } = useDataConsoleI18n();
	const base = useDataPath();
	if (!base)
		return (
			<DataPage title={t.vectors.title} description={t.vectors.description}>
				<Notice>{t.common.noProject}</Notice>
			</DataPage>
		);
	return (
		<DataPage title={t.vectors.title} description={t.vectors.description}>
			<Collections base={base} />
		</DataPage>
	);
}

function Collections({ base }: { base: string }) {
	const { t } = useDataConsoleI18n();
	const collections = useDataResource<Page<VectorCollection> & { available: boolean }>(
		`${base}/vector-collections`,
	);
	const available = collections.data?.available;
	return (
		<div className="space-y-6">
			{available !== undefined && (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">{t.vectors.service}</span>
					<StatusBadge state={available ? "enabled" : "unavailable"} />
				</div>
			)}
			{available === false && <Notice>{t.vectors.unavailable}</Notice>}
			<LoadState
				loading={collections.loading && !collections.data}
				error={collections.error}
				onRetry={collections.refresh}
			/>
			{collections.data && collections.data.items.length === 0 && (
				<Notice>{t.vectors.noCollections}</Notice>
			)}
			{collections.data?.items.map((collection) => (
				<CollectionCard
					key={collection.name}
					base={base}
					collection={collection}
					onDeleted={collections.refresh}
				/>
			))}
			<CreateCollectionForm base={base} onCreated={collections.refresh} />
		</div>
	);
}

function CollectionCard({
	base,
	collection,
	onDeleted,
}: {
	base: string;
	collection: VectorCollection;
	onDeleted(): void;
}) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [rules, setRules] = useState<CollectionRules>(collection.rules);
	const [confirming, setConfirming] = useState(false);
	const path = `${base}/vector-collections/${encode(collection.name)}`;
	const autosave = useSettingsAutosave({
		resourceKey: collection.name,
		value: rules,
		save: async (next) => {
			await PATCH(path, { rules: next });
		},
	});
	return (
		<SettingsSection
			title={
				<span className="flex flex-wrap items-center gap-2">
					<span className="font-mono">{collection.name}</span>
					<Badge>{t.vectors.items(collection.item_count ?? 0)}</Badge>
				</span>
			}
		>
			{operations.map((operation) => (
				<SettingsRow key={operation}>
					<RuleSelect
						label={t.common.ruleNames[operation]}
						value={rules[operation]}
						onChange={(rule) => {
							if (isAccessRule(rule)) setRules((current) => ({ ...current, [operation]: rule }));
						}}
					/>
				</SettingsRow>
			))}
			<SettingsRow>
				<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
				{confirming ? (
					<ConfirmPanel
						title={t.vectors.deleteCollection(collection.name)}
						message={t.vectors.deleteCollectionMessage(collection.name)}
						expected={collection.name}
						confirmLabel={t.common.delete}
						busy={action.busy}
						onCancel={() => {
							setConfirming(false);
						}}
						onConfirm={() => {
							action.run(async () => {
								await DELETE(`${path}?confirm=${encode(collection.name)}`);
								onDeleted();
							});
						}}
					/>
				) : (
					<SettingsActions>
						<Button
							type="button"
							variant="secondary-destructive"
							onClick={() => {
								setConfirming(true);
							}}
						>
							{t.vectors.deleteCollection(collection.name)}
						</Button>
					</SettingsActions>
				)}
				<ErrorAlert error={action.error} />
			</SettingsRow>
		</SettingsSection>
	);
}

function CreateCollectionForm({ base, onCreated }: { base: string; onCreated(): void }) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [name, setName] = useState("");
	const [rules, setRules] = useState<Record<(typeof operations)[number], AccessRule>>({
		read: "owner",
		write: "owner",
	});
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				action.run(async () => {
					await POST(`${base}/vector-collections`, { name: name.trim(), rules });
					setName("");
					onCreated();
				});
			}}
		>
			<SettingsSection title={t.vectors.createTitle}>
				<SettingsRow>
					<SettingsTextField
						label={t.vectors.collectionName}
						description={t.vectors.collectionNameHelp}
						value={name}
						autoComplete="off"
						required
						onChange={(event) => {
							setName(event.target.value);
						}}
					/>
				</SettingsRow>
				{operations.map((operation) => (
					<SettingsRow key={operation}>
						<RuleSelect
							label={t.common.ruleNames[operation]}
							value={rules[operation]}
							onChange={(rule) => {
								if (isAccessRule(rule)) setRules((current) => ({ ...current, [operation]: rule }));
							}}
						/>
					</SettingsRow>
				))}
			</SettingsSection>
			<ErrorAlert error={action.error} />
			<SettingsActions>
				<Button type="submit" variant="primary" disabled={action.busy || !name.trim()}>
					{t.vectors.createCollection}
				</Button>
			</SettingsActions>
		</form>
	);
}
