import { useFrontContext } from "@superboard/front-ui/context";
import { Button } from "@superboard/front-ui/kumo";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useCallback, useEffect, useState } from "react";

import { auditText, isAuditStatus } from "./audit-i18n.js";
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

export default function AuditPage() {
	const { locale } = useFrontContext();
	const t = auditText(locale);
	const number = new Intl.NumberFormat(locale);
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
		<section className="ds-page space-y-8">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("title")}</h1>
					<p className="ds-page-description">{t("description")}</p>
				</div>
			</header>
			<SectionNavigation />
			{error && (
				<p role="alert" className="text-sm text-kumo-danger">
					{error}
				</p>
			)}
			<SettingsSection title={t("integrity")} description={t("integrityDescription")}>
				<SettingsRow>
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm font-medium">{t("chain")}</p>
						<Badge
							variant={
								!verification ? "default" : verification.verified ? "success" : "destructive"
							}
						>
							{!verification
								? t("notVerified")
								: verification.verified
									? t("verified")
									: t("failed")}
						</Badge>
					</div>
					{verification && (
						<div
							role={verification.verified ? "status" : "alert"}
							className="space-y-1 text-sm text-kumo-subtle"
						>
							<p>{t("checked", { count: number.format(verification.entries) })}</p>
							{verification.broken_sequence ? (
								<p className="text-kumo-danger">
									{t("broken", { sequence: verification.broken_sequence })}
								</p>
							) : null}
							{verification.has_more && <p>{t("more")}</p>}
						</div>
					)}
					<SettingsActions>
						<Button
							type="button"
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
							{t("verify")}
						</Button>
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection title={t("receipts")} description={t("receiptsDescription")}>
				<SettingsRow>
					<SettingsTextField
						label={t("search")}
						type="search"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							setCursor(0);
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					{entries.length ? (
						<div className="overflow-x-auto">
							<FrontTable className="w-full text-start">
								<FrontTableHeader>
									<FrontTableRow>
										<FrontTableHead scope="col">{t("sequence")}</FrontTableHead>
										<FrontTableHead scope="col">{t("operation")}</FrontTableHead>
										<FrontTableHead scope="col">{t("action")}</FrontTableHead>
										<FrontTableHead scope="col">{t("status")}</FrontTableHead>
									</FrontTableRow>
								</FrontTableHeader>
								<FrontTableBody>
									{entries.map((entry) => (
										<FrontTableRow key={entry.sequence}>
											<FrontTableCell>{number.format(entry.sequence)}</FrontTableCell>
											<FrontTableCell className="break-all font-mono text-xs">
												{entry.operation_id}
											</FrontTableCell>
											<FrontTableCell className="font-mono text-xs">
												{entry.payload.action}
											</FrontTableCell>
											<FrontTableCell>
												<StatusBadge
													status={entry.payload.status}
													label={
														isAuditStatus(entry.payload.status)
															? t(`status:${entry.payload.status}`)
															: entry.payload.status
													}
												/>
											</FrontTableCell>
										</FrontTableRow>
									))}
								</FrontTableBody>
							</FrontTable>
						</div>
					) : (
						<p className="text-sm text-kumo-subtle">{t("empty")}</p>
					)}
					{(cursor > 0 || next !== null) && (
						<SettingsActions>
							{cursor > 0 && (
								<Button
									type="button"
									onClick={() => {
										setCursor(0);
									}}
								>
									{t("start")}
								</Button>
							)}
							{next !== null && (
								<Button
									type="button"
									onClick={() => {
										setCursor(next);
									}}
								>
									{t("next")}
								</Button>
							)}
						</SettingsActions>
					)}
				</SettingsRow>
			</SettingsSection>
			<div className="space-y-6 border-t border-kumo-line pt-8">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold">{t("advanced")}</h2>
					<p className="text-sm text-kumo-subtle">{t("advancedDescription")}</p>
				</div>
				<SettingsSection title={t("archiveTitle")} description={t("archiveDescription")}>
					<SettingsRow>
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								void run(async () => {
									await POST(`${base}/archives`, { from_sequence: from, to_sequence: to });
								});
							}}
						>
							<SettingsTextField
								label={t("from")}
								type="number"
								min={1}
								value={from}
								onChange={(event) => setFrom(Number(event.target.value))}
							/>
							<SettingsTextField
								label={t("to")}
								type="number"
								min={from}
								max={from + 999}
								value={to}
								onChange={(event) => setTo(Number(event.target.value))}
							/>
							<SettingsActions>
								<Button
									type="submit"
									disabled={busy || !verification?.verified || !verification.entries}
								>
									{t("archive")}
								</Button>
							</SettingsActions>
						</form>
					</SettingsRow>
					<SettingsRow>
						<h3 className="text-sm font-medium">{t("archives")}</h3>
						{archives.length ? (
							<ul className="divide-y divide-kumo-line text-sm">
								{archives.map((archive) => (
									<li key={archive.archive_id} className="space-y-1 py-2">
										<p>
											{t("range", {
												from: number.format(archive.from_sequence),
												to: number.format(archive.to_sequence),
											})}
										</p>
										<p className="text-xs text-kumo-subtle">{t("checksum")}</p>
										<code className="block break-all text-xs">{archive.checksum}</code>
									</li>
								))}
							</ul>
						) : (
							<p className="text-sm text-kumo-subtle">{t("noArchives")}</p>
						)}
					</SettingsRow>
				</SettingsSection>
			</div>
		</section>
	);
}

function StatusBadge({ status, label }: { status: string | undefined; label: string | undefined }) {
	if (!label) return <span className="text-kumo-subtle">—</span>;
	return (
		<Badge
			variant={
				status === "failed"
					? "destructive"
					: status === "completed" || status === "succeeded"
						? "success"
						: "default"
			}
		>
			{label}
		</Badge>
	);
}
