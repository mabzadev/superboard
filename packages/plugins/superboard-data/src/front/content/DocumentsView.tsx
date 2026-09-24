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
	type Document,
	type Page,
} from "./workspace.js";

export function DocumentsView({ collection, trash }: { collection: string; trash: boolean }) {
	const { t, locale } = useDataI18n();
	const operation = useOperation();
	const [language, setLanguage] = useState<string>(locale);
	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState("");
	const [cursor, setCursor] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
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
			{!trash && (
				<form
					className="flex flex-wrap items-end gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						setCursor("");
						setQuery(search.trim());
					}}
				>
					<TextField
						label={t.language}
						value={language}
						onChange={(value) => {
							setLanguage(value);
							setCursor("");
						}}
					/>
					<TextField label={t.search} value={search} onChange={setSearch} />
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
					<Button type="submit">{t.search}</Button>
					<Button
						onClick={() => {
							setSelected("");
						}}
					>
						{t.new}
					</Button>
				</form>
			)}
			{trash && <p>{t.allLanguages}</p>}
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
								<TableHead>{t.edit}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{resource.data.items.map((item) => (
								<TableRow key={item.id}>
									<TableCell>{documentTitle(item)}</TableCell>
									<TableCell>{item.locale}</TableCell>
									<TableCell>
										{item.status === "published"
											? t.published
											: item.status === "archived"
												? t.archived
												: t.draft}
									</TableCell>
									<TableCell>
										{trash ? (
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
										) : (
											<Button
												onClick={() => {
													setSelected(item.id);
												}}
											>
												{t.edit}
											</Button>
										)}
									</TableCell>
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
