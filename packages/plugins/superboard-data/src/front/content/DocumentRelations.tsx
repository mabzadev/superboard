import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import { useState } from "react";

import { GET, POST } from "./transport.js";
import {
	responseData,
	collectionPath,
	encode,
	TextField,
	useDataI18n,
	useOperation,
	useResource,
	type Document,
} from "./workspace.js";

interface Revision {
	id: string;
	createdAt: string;
	data: Record<string, unknown>;
}
interface Comparison {
	hasChanges: boolean;
	live: Record<string, unknown> | null;
	draft: Record<string, unknown> | null;
}
export function DocumentHistory({ path, onChanged }: { path: string; onChanged(): void }) {
	const { t, locale } = useDataI18n();
	const operation = useOperation();
	const revisions = useResource<{ items: Revision[]; total: number }>(
		`${path}/revisions?limit=100`,
	);
	const [selected, setSelected] = useState<Revision | null>(null);
	const [comparison, setComparison] = useState<Comparison | null>(null);
	return (
		<div className="space-y-4">
			{operation.feedback}
			{revisions.error && <p role="alert">{revisions.error}</p>}
			<Button
				disabled={operation.busy}
				onClick={() => {
					operation.run(async () => {
						setComparison(await responseData<Comparison>(await GET(`${path}/compare`)));
					});
				}}
			>
				{t.compare}
			</Button>
			{comparison && (
				<div className="grid gap-4 lg:grid-cols-2">
					{!comparison.hasChanges && <p>{t.noChanges}</p>}
					<div>
						<h3>{t.live}</h3>
						<pre className="overflow-auto">{JSON.stringify(comparison.live, null, 2)}</pre>
					</div>
					<div>
						<h3>{t.current}</h3>
						<pre className="overflow-auto">{JSON.stringify(comparison.draft, null, 2)}</pre>
					</div>
				</div>
			)}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t.date}</TableHead>
						<TableHead>{t.revisions}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{revisions.data?.items.map((item) => (
						<TableRow key={item.id}>
							<TableCell>{new Date(item.createdAt).toLocaleString(locale)}</TableCell>
							<TableCell>
								<Button
									onClick={() => {
										setSelected(item);
									}}
								>
									{t.showRevision}
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{revisions.data && !revisions.data.items.length && <p>{t.noRevisions}</p>}
			{selected && (
				<div className="space-y-3">
					<pre className="max-h-96 overflow-auto">{JSON.stringify(selected.data, null, 2)}</pre>
					<Button
						disabled={operation.busy}
						onClick={() => {
							operation.run(async () => {
								await POST(`/_emdash/api/revisions/${encode(selected.id)}/restore`, {});
								onChanged();
							});
						}}
					>
						{t.restoreRevision}
					</Button>
				</div>
			)}
		</div>
	);
}
export function DocumentTranslations({
	collection,
	item,
	onSelect,
}: {
	collection: string;
	item: Document;
	onSelect(item: Document): void;
}) {
	const { t } = useDataI18n();
	const operation = useOperation();
	const [language, setLanguage] = useState("");
	const [slug, setSlug] = useState(item.slug ?? "");
	const resource = useResource<{ translations: Document[] }>(
		`${collectionPath(collection)}/${encode(item.id)}/translations`,
	);
	return (
		<div className="space-y-4">
			{operation.feedback}
			{resource.error && <p role="alert">{resource.error}</p>}
			<ul>
				{resource.data?.translations.map((translation) => (
					<li key={translation.id}>
						<Button
							disabled={translation.id === item.id}
							onClick={() => {
								onSelect(translation);
							}}
						>
							{translation.locale} · {translation.slug}
						</Button>
					</li>
				))}
			</ul>
			<form
				className="grid max-w-md gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					operation.run(async () => {
						const response = await POST(collectionPath(collection), {
							locale: language,
							translationOf: item.id,
							slug,
							data: item.data,
						});
						onSelect((await responseData<{ item: Document }>(response)).item);
					});
				}}
			>
				<TextField label={t.targetLocale} value={language} onChange={setLanguage} required />
				<TextField label={t.slug} value={slug} onChange={setSlug} />
				<Button
					type="submit"
					disabled={
						operation.busy ||
						resource.data?.translations.some((translation) => translation.locale === language)
					}
				>
					{t.addTranslation}
				</Button>
			</form>
		</div>
	);
}
