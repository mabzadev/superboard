import { useFrontContext } from "@superboard/front-ui/context";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { useProjectSelection } from "../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
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
		failed: "The file operation failed",
	},
	fr: {
		title: "Fichiers",
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
		failed: "L’opération sur le fichier a échoué",
	},
};

export default function FilesPage() {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const { selectedProject } = useProjectSelection();
	const base = `/api/v1/files/projects/${selectedProject?.id ?? ""}`;
	const [file, setFile] = useState<File | null>(null);
	const [items, setItems] = useState<StoredFile[]>([]);
	const [usage, setUsage] = useState<{ files: number; bytes: number } | null>(null);
	const [deleted, setDeleted] = useState(false);
	const [cursor, setCursor] = useState<string | null>(null);
	const [next, setNext] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		const query = new URLSearchParams({ deleted: String(deleted), ...(cursor ? { cursor } : {}) });
		const [files, totals] = await Promise.all([
			GET(`${base}/objects?${query}`),
			GET(`${base}/usage`),
		]);
		setItems(files.data.data.items);
		setNext(files.data.data.next_cursor);
		setUsage(totals.data.data);
	}, [selectedProject, base, deleted, cursor]);
	useEffect(() => {
		void load().catch((cause) => setError(cause instanceof Error ? cause.message : t.failed));
	}, [load, t]);
	async function run(action: () => Promise<void>) {
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
	return (
		<section className="grid gap-5 p-6">
			<h1 className="text-xl font-semibold">{t.title}</h1>
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
					void run(async () => {
						if (!file) return;
						setProgress(0);
						const ticket = (
							await POST(`${base}/upload-tickets`, {
								filename: file.name,
								content_type: file.type || "application/octet-stream",
								byte_size: file.size,
							})
						).data.data;
						await PUT(ticket.upload_url, file, { onProgress: setProgress });
						await POST(`${base}/upload-tickets/${encodeURIComponent(ticket.id)}/complete`, {});
						setFile(null);
						setMessage(t.saved);
					});
				}}
			>
				<label>
					{t.choose}
					<Input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
				</label>
				<Button type="submit" disabled={busy || !file || !selectedProject}>
					{busy ? `${t.uploading} ${progress}%` : t.upload}
				</Button>
			</form>
			<div className="flex gap-3">
				<Button
					variant="outline"
					onClick={() => {
						setDeleted(!deleted);
						setCursor(null);
					}}
				>
					{deleted ? t.active : t.trash}
				</Button>
				<Button
					variant="outline"
					disabled={busy}
					onClick={() =>
						void run(async () => {
							const result = await POST(`${base}/collect-garbage`, {});
							setMessage(`${result.data.data.collected}`);
						})
					}
				>
					{t.clean}
				</Button>
			</div>
			<table>
				<thead>
					<tr>
						<th>{t.name}</th>
						<th>{t.size}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{items.map((item) => (
						<tr key={item.id}>
							<td>{item.filename}</td>
							<td>{item.byte_size.toLocaleString(locale)}</td>
							<td className="flex gap-2">
								{item.deleted_at ? (
									<Button
										disabled={busy}
										onClick={() =>
											void run(async () => {
												await POST(`${base}/objects/${item.id}/restore`, {});
											})
										}
									>
										{t.restore}
									</Button>
								) : (
									<>
										<Button
											disabled={busy}
											onClick={() =>
												void run(async () => {
													const ticket = (await GET(`${base}/objects/${item.id}/download-ticket`))
														.data.data;
													const response = await GET(ticket.download_url, { responseType: "blob" });
													const url = URL.createObjectURL(response.data);
													const link = document.createElement("a");
													link.href = url;
													link.download = item.filename;
													link.click();
													setTimeout(() => URL.revokeObjectURL(url), 1000);
												})
											}
										>
											{t.download}
										</Button>
										<Button
											variant="outline"
											disabled={busy}
											onClick={() =>
												void run(async () => {
													await DELETE(`${base}/objects/${item.id}`);
												})
											}
										>
											{t.remove}
										</Button>
									</>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{!items.length && <p>{t.empty}</p>}
			<div className="flex gap-3">
				{cursor && <Button onClick={() => setCursor(null)}>{t.first}</Button>}
				{next && <Button onClick={() => setCursor(next)}>{t.next}</Button>}
			</div>
		</section>
	);
}
