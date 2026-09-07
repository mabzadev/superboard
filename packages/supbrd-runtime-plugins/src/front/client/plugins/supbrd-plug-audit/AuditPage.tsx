import { useFrontContext } from "@superboard/front-ui/context";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { GET, POST } from "./transport.js";

interface Entry {
	sequence: number;
	operation_id: string;
	hash: string;
	payload: { plugin_id?: string; action?: string; status?: string };
}
interface Verification {
	verified: boolean;
	entries: number;
	broken_sequence?: number;
	has_more: boolean;
}
interface Archive {
	archive_id: string;
	from_sequence: number;
	to_sequence: number;
	checksum: string;
}
const base = "/_emdash/api/superboard/audit";
const messages = {
	en: {
		title: "Audit ledger",
		verify: "Synchronize and verify",
		valid: "Ledger chain verified",
		invalid: "Ledger integrity failure",
		more: "More technical receipts remain to synchronize",
		search: "Search receipts",
		next: "Next page",
		start: "First page",
		from: "First sequence",
		to: "Last sequence",
		archive: "Create immutable archive",
		archives: "Archives",
		empty: "No receipts imported yet. Synchronize the technical journal to populate the ledger.",
		operation: "Operation",
		action: "Action",
		status: "Status",
	},
	fr: {
		title: "Journal d’audit",
		verify: "Synchroniser et vérifier",
		valid: "Chaîne du journal vérifiée",
		invalid: "Échec de vérification du journal",
		more: "D’autres reçus techniques restent à synchroniser",
		search: "Rechercher des reçus",
		next: "Page suivante",
		start: "Première page",
		from: "Première séquence",
		to: "Dernière séquence",
		archive: "Créer une archive immuable",
		archives: "Archives",
		empty: "Aucun reçu importé. Synchronisez le journal technique pour alimenter l’audit.",
		operation: "Opération",
		action: "Action",
		status: "État",
	},
};
export default function AuditPage() {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const [entries, setEntries] = useState<Entry[]>([]);
	const [archives, setArchives] = useState<Archive[]>([]);
	const [search, setSearch] = useState("");
	const [cursor, setCursor] = useState(0);
	const [next, setNext] = useState<number | null>(null);
	const [verification, setVerification] = useState<Verification | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [from, setFrom] = useState(1);
	const [to, setTo] = useState(1);
	const load = useCallback(async () => {
		const params = new URLSearchParams({ cursor: String(cursor), ...(search ? { search } : {}) });
		const [ledger, saved] = await Promise.all([
			GET(`${base}${search ? "/ledger/search" : "/ledger"}?${params}`),
			GET(`${base}/archives`),
		]);
		setEntries(ledger.data.data.items);
		setNext(ledger.data.data.next_cursor);
		setArchives(saved.data.data.items);
	}, [cursor, search]);
	useEffect(() => {
		void load().catch((cause) => setError(String(cause)));
	}, [load]);
	async function run(work: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await work();
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="grid gap-5 p-6">
			<h1 className="text-xl font-semibold">{t.title}</h1>
			{error && <p role="alert">{error}</p>}
			<Button
				disabled={busy}
				onClick={() =>
					void run(async () => {
						const response = await POST(`${base}/verify`, {});
						const result: Verification = response.data.data;
						setVerification(result);
						setTo(Math.min(1000, result.entries || 1));
					})
				}
			>
				{t.verify}
			</Button>
			{verification && (
				<p role={verification.verified ? "status" : "alert"}>
					{verification.verified ? t.valid : t.invalid} · {verification.entries}
					{verification.broken_sequence ? ` · ${verification.broken_sequence}` : ""}
					{verification.has_more && ` · ${t.more}`}
				</p>
			)}
			<label>
				{t.search}
				<Input
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setCursor(0);
					}}
				/>
			</label>
			<table>
				<thead>
					<tr>
						<th>#</th>
						<th>{t.operation}</th>
						<th>{t.action}</th>
						<th>{t.status}</th>
					</tr>
				</thead>
				<tbody>
					{entries.map((entry) => (
						<tr key={entry.sequence}>
							<td>{entry.sequence}</td>
							<td>{entry.operation_id}</td>
							<td>{entry.payload.action}</td>
							<td>{entry.payload.status}</td>
						</tr>
					))}
				</tbody>
			</table>
			{!entries.length && <p>{t.empty}</p>}
			<div className="flex gap-3">
				{cursor > 0 && <Button onClick={() => setCursor(0)}>{t.start}</Button>}
				{next !== null && <Button onClick={() => setCursor(next)}>{t.next}</Button>}
			</div>
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void run(async () => {
						await POST(`${base}/archives`, { from_sequence: from, to_sequence: to });
					});
				}}
			>
				<label>
					{t.from}
					<Input
						type="number"
						min={1}
						value={from}
						onChange={(event) => setFrom(Number(event.target.value))}
					/>
				</label>
				<label>
					{t.to}
					<Input
						type="number"
						min={from}
						max={from + 999}
						value={to}
						onChange={(event) => setTo(Number(event.target.value))}
					/>
				</label>
				<Button type="submit" disabled={busy || !verification?.verified || !verification.entries}>
					{t.archive}
				</Button>
			</form>
			<h2>{t.archives}</h2>
			<ul>
				{archives.map((archive) => (
					<li key={archive.archive_id}>
						{archive.from_sequence}–{archive.to_sequence} · <code>{archive.checksum}</code>
					</li>
				))}
			</ul>
		</section>
	);
}
