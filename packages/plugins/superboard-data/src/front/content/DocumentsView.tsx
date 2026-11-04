import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import { useEffect, useState } from "react";

import { DocumentEditor } from "./DocumentEditor.js";
import { POST } from "./transport.js";
import {
	collectionPath,
	documentTitle,
	encode,
	TextField,
	useDataI18n,
	useOperation,
	useResource,
	type Collection,
	type Document,
	type Page,
} from "./workspace.js";

const SEARCH_DELAY_MS = 300;

export function DocumentsView({
	collections,
	collection,
	onCollectionChange,
	trash,
}: {
	collections: Collection[];
	collection: string;
	onCollectionChange(value: string): void;
	trash: boolean;
}) {
	const { t, locale } = useDataI18n();
	const operation = useOperation();
	const [language, setLanguage] = useState<string>(locale);
	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState("");
	const [cursor, setCursor] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => {
			const next = search.trim();
			if (next === query) return;
			setQuery(next);
			setCursor("");
		}, SEARCH_DELAY_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [search, query]);
	const params = new URLSearchParams({
		limit: "50",
		...(cursor ? { cursor } : {}),
		...(!trash
			? { locale: language, ...(query ? { q: query } : {}), ...(status ? { status } : {}) }
			: {}),
	});
	const resource = useResource<Page<Document>>(
		`${collectionPath(collection)}${trash ? "/trash" : ""}?${params}`,
	);
	if (selected !== null)
		return (
			<DocumentEditor
				key={`${collection}:${selected}:${language}`}
				collection={collection}
				id={selected}
				language={language}
				onBack={() => {
					setSelected(null);
					resource.refresh();
				}}
				onSelect={(item) => {
					setLanguage(item.locale);
					setSelected(item.id);
				}}
			/>
		);
	return (
		<div className="space-y-4 pt-4">
			{operation.feedback}
			<div className="flex flex-wrap items-end gap-3">
				<label className="grid gap-2">
					{t.collection}
					<select
						value={collection}
						onChange={(event) => {
							onCollectionChange(event.target.value);
						}}
					>
						{collections.map((row) => (
							<option key={row.slug} value={row.slug}>
								{row.label}
							</option>
						))}
					</select>
				</label>
				{trash ? (
					<p className="text-sm text-muted-foreground">{t.allLanguages}</p>
				) : (
					<>
						<TextField
							label={t.language}
							value={language}
							onChange={(value) => {
								setLanguage(value);
								setCursor("");
							}}
						/>
						<TextField label={t.search} type="search" value={search} onChange={setSearch} />
						<label className="grid gap-2">
							{t.status}
							<select
								value={status}
								onChange={(event) => {
									setStatus(event.target.value);
									setCursor("");
								}}
							>
								{["", "draft", "published", "archived"].map((value) => (
									<option key={value} value={value}>
										{value === "draft"
											? t.draft
											: value === "published"
												? t.published
												: value === "archived"
													? t.archived
													: t.all}
									</option>
								))}
							</select>
						</label>
						<Button
							className="ms-auto"
							onClick={() => {
								setSelected("");
							}}
						>
							{t.new}
						</Button>
					</>
				)}
			</div>
			{resource.error ? (
				<div role="alert">
					{resource.error}
					<Button onClick={resource.refresh}>{t.retry}</Button>
				</div>
			) : !resource.data ? (
				<p role="status">{t.loading}</p>
			) : (
				<>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t.name}</TableHead>
								<TableHead>{t.language}</TableHead>
								<TableHead>{t.status}</TableHead>
								{trash && <TableHead />}
							</TableRow>
						</TableHeader>
						<TableBody>
							{resource.data.items.map((item) => (
								<TableRow key={item.id}>
									<TableCell>
										{trash ? (
											documentTitle(item)
										) : (
											<Button
												variant="link"
												className="h-auto px-0 py-0 font-medium text-foreground"
												onClick={() => {
													setSelected(item.id);
												}}
											>
												{documentTitle(item)}
											</Button>
										)}
									</TableCell>
									<TableCell>{item.locale}</TableCell>
									<TableCell>
										{item.status === "published"
											? t.published
											: item.status === "archived"
												? t.archived
												: t.draft}
									</TableCell>
									{trash && (
										<TableCell>
											<Button
												disabled={operation.busy}
												onClick={() => {
													operation.run(async () => {
														await POST(
															`${collectionPath(collection)}/${encode(item.id)}/restore`,
															{},
														);
														resource.refresh();
													});
												}}
											>
												{t.restore}
											</Button>
										</TableCell>
									)}
								</TableRow>
							))}
						</TableBody>
					</Table>
					{!resource.data.items.length && <p>{t.empty}</p>}
					<div className="flex gap-2">
						{cursor && (
							<Button
								onClick={() => {
									setCursor("");
								}}
							>
								{t.first}
							</Button>
						)}
						{resource.data.nextCursor && (
							<Button
								onClick={() => {
									setCursor(resource.data?.nextCursor ?? "");
								}}
							>
								{t.next}
							</Button>
						)}
					</div>
				</>
			)}
		</div>
	);
}
