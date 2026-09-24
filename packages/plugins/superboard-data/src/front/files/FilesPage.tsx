import { useFrontContext } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useCallback, useEffect, useState } from "react";

import { responseData } from "../content/workspace.js";
import { DELETE, GET, POST, PUT } from "./transport.js";

interface StoredFile {
	id: string;
	filename: string;
	content_type: string;
	byte_size: number;
	deleted_at: string | null;
}
const messages = {
	en: {
		title: "Files",
		settings: "File settings",
		choose: "Choose a file",
		upload: "Upload",
		uploading: "Uploading…",
		download: "Download",
		remove: "Move to trash",
		restore: "Restore",
		trash: "Trash",
		active: "Active files",
		clean: "Clean expired incomplete uploads",
		empty: "No files",
		next: "Next page",
		first: "First page",
		saved: "File saved",
		size: "Bytes",
		name: "Name",
		search: "Search this page",
		type: "File type",
		allTypes: "All types",
		details: "Details",
		back: "Back to files",
		failed: "The file operation failed",
	},
	fr: {
		title: "Fichiers",
		settings: "Paramètres des fichiers",
		choose: "Choisir un fichier",
		upload: "Transférer",
		uploading: "Transfert…",
		download: "Télécharger",
		remove: "Mettre à la corbeille",
		restore: "Restaurer",
		trash: "Corbeille",
		active: "Fichiers actifs",
		clean: "Nettoyer les transferts incomplets expirés",
		empty: "Aucun fichier",
		next: "Page suivante",
		first: "Première page",
		saved: "Fichier enregistré",
		size: "Octets",
		name: "Nom",
		search: "Rechercher dans cette page",
		type: "Type de fichier",
		allTypes: "Tous les types",
		details: "Détails",
		back: "Retour aux fichiers",
		failed: "L’opération sur le fichier a échoué",
	},
};

export default function FilesPage() {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const { selectedProject } = useProjectSelection();
	const base = `/api/v1/files/projects/${selectedProject?.id ?? ""}`;
	const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
	const [search, setSearch] = useState("");
	const [contentType, setContentType] = useState("");
	const [detail, setDetail] = useState<StoredFile | null>(null);
	const [items, setItems] = useState<StoredFile[]>([]);
	const [usage, setUsage] = useState<{ files: number; bytes: number } | null>(null);
	const [deleted, setDeleted] = useState(false);
	const [cursor, setCursor] = useState<string | null>(null);
	const [next, setNext] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const fetchFiles = useCallback(async () => {
		if (!selectedProject) return;
		const query = new URLSearchParams({ deleted: String(deleted), ...(cursor ? { cursor } : {}) });
		const [files, totals] = await Promise.all([
			GET(`${base}/objects?${query}`),
			GET(`${base}/usage`),
		]);
		const listing = await responseData<{ items: StoredFile[]; next_cursor: string | null }>(files);
		return { listing, usage: await responseData<{ files: number; bytes: number }>(totals) };
	}, [selectedProject, base, deleted, cursor]);
	const applyFiles = useCallback(
		(snapshot: {
			listing: { items: StoredFile[]; next_cursor: string | null };
			usage: { files: number; bytes: number };
		}) => {
			setItems(snapshot.listing.items);
			setNext(snapshot.listing.next_cursor);
			setUsage(snapshot.usage);
		},
		[],
	);
	const load = useCallback(async () => {
		const snapshot = await fetchFiles();
		if (snapshot) applyFiles(snapshot);
	}, [fetchFiles, applyFiles]);
	useEffect(() => {
		let active = true;
		fetchFiles()
			.then((snapshot) => {
				if (active && snapshot) applyFiles(snapshot);
			})
			.catch((cause: unknown) => {
				if (active) setError(cause instanceof Error ? cause.message : t.failed);
			});
		return () => {
			active = false;
		};
	}, [fetchFiles, applyFiles, t]);
	async function execute(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await action();
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t.failed);
		} finally {
			setBusy(false);
		}
	}
	function run(action: () => Promise<void>) {
		execute(action).catch((cause: unknown) => {
			setError(cause instanceof Error ? cause.message : t.failed);
		});
	}

	return (
		<section className="ds-page space-y-5">
			<h1 className="ds-page-title">{t.title}</h1>
			<a href={`/data/settings?tab=files&lang=${locale}`}>{t.settings}</a>
			{error && <p role="alert">{error}</p>}
			{message && <p role="status">{message}</p>}
			{usage && (
				<p>
					{usage.files} · {usage.bytes.toLocaleString(locale)} {t.size.toLowerCase()}
				</p>
			)}
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					run(async () => {
						if (!filesToUpload.length) return;
						for (const file of filesToUpload) {
							setProgress(0);
							const ticket = await responseData<{ id: string; upload_url: string }>(
								await POST(`${base}/upload-tickets`, {
									filename: file.name,
									content_type: file.type || "application/octet-stream",
									byte_size: file.size,
								}),
							);
							await PUT(ticket.upload_url, file, { onProgress: setProgress });
							await POST(`${base}/upload-tickets/${encodeURIComponent(ticket.id)}/complete`, {});
							setFilesToUpload((current) => current.filter((candidate) => candidate !== file));
							await load();
						}
						setMessage(t.saved);
					});
				}}
			>
				<label>
					{t.choose}
					<Input
						type="file"
						disabled={busy}
						multiple
						onChange={(event) => {
							setFilesToUpload(Array.from(event.target.files ?? []));
						}}
					/>
				</label>
				<Button type="submit" disabled={busy || !filesToUpload.length || !selectedProject}>
					{busy ? `${t.uploading} ${progress}%` : t.upload}
				</Button>
			</form>
			<div className="flex gap-3">
				<Button
					variant="outline"
					onClick={() => {
						setDeleted(!deleted);
						setDetail(null);
						setContentType("");
						setCursor(null);
					}}
				>
					{deleted ? t.active : t.trash}
				</Button>
				<Button
					variant="outline"
					disabled={busy}
					onClick={() => {
						run(async () => {
							const result = await POST(`${base}/collect-garbage`, {});
							setMessage(String((await responseData<{ collected: number }>(result)).collected));
						});
					}}
				>
					{t.clean}
				</Button>
			</div>
			<div className="flex flex-wrap gap-3">
				<label>
					{t.search}
					<Input
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
						}}
					/>
				</label>
				<label>
					{t.type}
					<select
						value={contentType}
						onChange={(event) => {
							setContentType(event.target.value);
						}}
					>
						<option value="">{t.allTypes}</option>
						{[...new Set(items.map((item) => item.content_type))].map((type) => (
							<option key={type} value={type}>
								{type}
							</option>
						))}
					</select>
				</label>
			</div>
			{detail && (
				<div className="space-y-3 rounded border p-4">
					<h2>{t.details}</h2>
					<dl>
						<dt>{t.name}</dt>
						<dd>{detail.filename}</dd>
						<dt>{t.type}</dt>
						<dd>{detail.content_type}</dd>
						<dt>{t.size}</dt>
						<dd>{detail.byte_size}</dd>
					</dl>
					<Button
						onClick={() => {
							setDetail(null);
						}}
					>
						{t.back}
					</Button>
				</div>
			)}
			<FrontTable>
				<FrontTableHeader>
					<FrontTableRow>
						<FrontTableHead>{t.name}</FrontTableHead>
						<FrontTableHead>{t.size}</FrontTableHead>
						<FrontTableHead></FrontTableHead>
					</FrontTableRow>
				</FrontTableHeader>
				<FrontTableBody>
					{items
						.filter(
							(item) =>
								item.filename
									.toLocaleLowerCase(locale)
									.includes(search.toLocaleLowerCase(locale)) &&
								(!contentType || item.content_type === contentType),
						)
						.map((item) => (
							<FrontTableRow key={item.id}>
								<FrontTableCell>
									<Button
										variant="ghost"
										onClick={() => {
											setDetail(item);
										}}
									>
										{item.filename}
									</Button>
								</FrontTableCell>
								<FrontTableCell>{item.byte_size.toLocaleString(locale)}</FrontTableCell>
								<FrontTableCell className="flex gap-2">
									{item.deleted_at ? (
										<Button
											disabled={busy}
											onClick={() => {
												run(async () => {
													await POST(`${base}/objects/${item.id}/restore`, {});
												});
											}}
										>
											{t.restore}
										</Button>
									) : (
										<>
											<Button
												disabled={busy}
												onClick={() => {
													run(async () => {
														const ticket = await responseData<{ download_url: string }>(
															await GET(`${base}/objects/${item.id}/download-ticket`),
														);
														const response = await GET(ticket.download_url, {
															responseType: "blob",
														});
														const blob: unknown = response.data;
														if (!(blob instanceof Blob)) throw new Error(t.failed);
														const url = URL.createObjectURL(blob);
														const link = document.createElement("a");
														link.href = url;
														link.download = item.filename;
														link.click();
														setTimeout(() => {
															URL.revokeObjectURL(url);
														}, 1000);
													});
												}}
											>
												{t.download}
											</Button>
											<Button
												variant="outline"
												disabled={busy}
												onClick={() => {
													run(async () => {
														await DELETE(`${base}/objects/${item.id}`);
													});
												}}
											>
												{t.remove}
											</Button>
										</>
									)}
								</FrontTableCell>
							</FrontTableRow>
						))}
				</FrontTableBody>
			</FrontTable>
			{!items.length && <p>{t.empty}</p>}
			<div className="flex gap-3">
				{cursor && (
					<Button
						onClick={() => {
							setCursor(null);
						}}
					>
						{t.first}
					</Button>
				)}
				{next && (
					<Button
						onClick={() => {
							setCursor(next);
						}}
					>
						{t.next}
					</Button>
				)}
			</div>
		</section>
	);
}
