import { Button, Checkbox, Dialog, Input, Select } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { useMemo, useState } from "react";

import type { SubscriberList } from "../api/marketing/marketingService.js";
import {
	importAudience,
	type AudienceField,
	type ImportConsent,
	type ImportResult,
} from "./audience-service.js";
import {
	guessColumnMapping,
	mapCsvRows,
	MAX_IMPORT_ROWS,
	parseCsvTable,
	type ColumnTarget,
} from "./contact-csv.js";
import { useStudioI18n } from "./i18n.js";

const reasonLabels: Record<string, string> = {
	invalid_email: "Invalid email",
	duplicate: "Duplicate in file",
	suppressed: "Suppressed address",
	no_consent: "No consent",
	invalid_field: "Invalid field value",
	invalid_tag: "Invalid tag",
};

/**
 * Three short steps in one dialog: choose a file, check the column mapping
 * and state how consent was collected, then read the result summary.
 */
export function ContactImport({
	project,
	open,
	lists,
	fields,
	onClose,
	onImported,
}: {
	project: string;
	open: boolean;
	lists: SubscriberList[];
	fields: AudienceField[];
	onClose: () => void;
	onImported: () => void;
}) {
	const { t, locale } = useStudioI18n();
	const [table, setTable] = useState<{
		headers: string[];
		columns: string[];
		rows: string[][];
	} | null>(null);
	const [mapping, setMapping] = useState<ColumnTarget[]>([]);
	const [consent, setConsent] = useState<ImportConsent>("confirmed");
	const [attested, setAttested] = useState(false);
	const [listIds, setListIds] = useState<string[]>([]);
	const [updateExisting, setUpdateExisting] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [result, setResult] = useState<ImportResult | null>(null);
	const reset = () => {
		setTable(null);
		setMapping([]);
		setConsent("confirmed");
		setAttested(false);
		setListIds([]);
		setUpdateExisting(true);
		setError("");
		setResult(null);
	};
	const targets = useMemo(
		() => ({
			ignore: t("Do not import"),
			email: t("Email"),
			name: t("Name"),
			locale: t("Preferred language"),
			tags: t("Tags"),
			consent: t("Consent"),
			...Object.fromEntries(fields.map((field) => [`field:${field.key}`, field.label])),
		}),
		[fields, t],
	);
	const emailColumns = mapping.filter((target) => target === "email").length;
	const hasConsentColumn = mapping.includes("consent");
	const ready =
		table !== null &&
		emailColumns === 1 &&
		(consent === "double_opt_in" || attested) &&
		(consent !== "column" || hasConsentColumn);
	const doubleListSelected = lists.some(
		(list) => listIds.includes(list.id) && list.optin_mode === "double",
	);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) {
					reset();
					onClose();
				}
			}}
		>
			<Dialog className="max-h-[90vh] w-full max-w-3xl overflow-auto p-6">
				<Dialog.Title>{t("Import contacts")}</Dialog.Title>
				<Dialog.Description>
					{t("Upload a CSV file with up to {count} contacts and one email column.", {
						count: MAX_IMPORT_ROWS.toLocaleString(locale),
					})}
				</Dialog.Description>
				<div className="mt-4 space-y-5">
					{result ? (
						<ImportSummary result={result} />
					) : (
						<>
							<Input
								type="file"
								accept=".csv,text/csv"
								label={t("CSV file")}
								onChange={(event) => {
									(async () => {
										const file = event.target.files?.[0];
										if (!file) return;
										try {
											const parsed = parseCsvTable(await file.text());
											setTable({
												...parsed,
												columns: parsed.headers.map((header, position) => `${position}:${header}`),
											});
											setMapping(
												guessColumnMapping(
													parsed.headers,
													fields.map((field) => field.key),
												),
											);
											setError("");
										} catch (cause) {
											setTable(null);
											setError(
												t(
													cause instanceof Error && cause.message === "CSV_TOO_MANY_ROWS"
														? "This file has more than {count} contacts. Split it into smaller files."
														: "This file could not be read. Check that it is a CSV file with a header row.",
													{ count: MAX_IMPORT_ROWS.toLocaleString(locale) },
												),
											);
										}
									})().catch(() => undefined);
								}}
							/>
							{table && (
								<>
									<section className="space-y-2">
										<h3 className="font-semibold">
											{t("Match your columns")} · {t("{count} rows", { count: table.rows.length })}
										</h3>
										<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
											{table.headers.map((header, column) => (
												<div
													key={table.columns[column]}
													className="grid items-center gap-3 p-3 sm:grid-cols-[1fr_1fr_220px]"
												>
													<p className="font-medium">
														{header || t("Column {number}", { number: column + 1 })}
													</p>
													<p className="truncate text-sm text-kumo-subtle">
														{table.rows[0]?.[column] ?? ""}
													</p>
													<Select
														aria-label={t("Import {column} as", { column: header })}
														value={mapping[column] ?? "ignore"}
														onValueChange={(next) => {
															if (next)
																setMapping(
																	mapping.map((target, position) =>
																		position === column ? next : target,
																	),
																);
														}}
														items={targets}
													/>
												</div>
											))}
										</div>
										{emailColumns !== 1 && (
											<p role="alert" className="text-sm text-kumo-danger">
												{t("Choose exactly one email column.")}
											</p>
										)}
									</section>
									<section className="space-y-2">
										<h3 className="font-semibold">{t("Consent")}</h3>
										<Select
											label={t("How did these contacts agree to receive your emails?")}
											value={consent}
											onValueChange={(next) => {
												if (next) setConsent(next);
											}}
											items={{
												confirmed: t("They all agreed to receive my emails"),
												column: t("Use the consent column of the file"),
												double_opt_in: t("Ask new contacts to confirm by email (double opt-in)"),
											}}
										/>
										{consent === "column" && !hasConsentColumn && (
											<p role="alert" className="text-sm text-kumo-danger">
												{t("Choose which column contains the consent.")}
											</p>
										)}
										{consent !== "double_opt_in" && (
											<Checkbox
												label={t("I confirm that I have consent to email every contact I import")}
												checked={attested}
												onCheckedChange={(checked) => {
													setAttested(checked);
												}}
											/>
										)}
										<p className="text-xs text-kumo-subtle">
											{t(
												"Existing contacts keep their current subscription status. Unsubscribed and blocked addresses are never resubscribed by an import.",
											)}
										</p>
									</section>
									<section className="space-y-2">
										<h3 className="font-semibold">{t("Options")}</h3>
										{lists.map((list) => (
											<Checkbox
												key={list.id}
												label={t("Add to {list}", { list: list.name })}
												checked={listIds.includes(list.id)}
												onCheckedChange={(checked) => {
													setListIds(
														checked
															? [...listIds, list.id]
															: listIds.filter((id) => id !== list.id),
													);
												}}
											/>
										))}
										{doubleListSelected && consent !== "double_opt_in" && (
											<p className="text-xs text-kumo-subtle">
												{t(
													"A selected list uses double opt-in: new contacts will receive a confirmation email.",
												)}
											</p>
										)}
										<Checkbox
											label={t("Update the name, tags and fields of existing contacts")}
											checked={updateExisting}
											onCheckedChange={(checked) => {
												setUpdateExisting(checked);
											}}
										/>
									</section>
								</>
							)}
							{error && (
								<p role="alert" className="text-kumo-danger">
									{error}
								</p>
							)}
						</>
					)}
				</div>
				<div className="mt-6 flex justify-end gap-2">
					{result ? (
						<Button
							variant="primary"
							onClick={() => {
								reset();
								onClose();
							}}
						>
							{t("Done")}
						</Button>
					) : (
						<>
							<Button
								disabled={busy}
								onClick={() => {
									reset();
									onClose();
								}}
							>
								{t("Cancel")}
							</Button>
							<Button
								variant="primary"
								disabled={!ready || busy}
								loading={busy}
								onClick={() => {
									(async () => {
										if (!table) return;
										setBusy(true);
										setError("");
										try {
											setResult(
												await importAudience(project, {
													rows: mapCsvRows(table.rows, mapping),
													consent,
													consent_confirmed: consent !== "double_opt_in" && attested,
													list_ids: listIds,
													update_existing: updateExisting,
												}),
											);
											onImported();
										} catch (cause) {
											setError(moduleErrorMessage(cause, locale));
										} finally {
											setBusy(false);
										}
									})().catch(() => undefined);
								}}
							>
								{t("Import {count} contacts", {
									count: (table?.rows.length ?? 0).toLocaleString(locale),
								})}
							</Button>
						</>
					)}
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

function ImportSummary({ result }: { result: ImportResult }) {
	const { t } = useStudioI18n();
	const stats: Array<[string, number]> = [
		["Created", result.created],
		["Updated", result.updated],
		["Unchanged", result.unchanged],
		["Skipped", result.skipped],
	];
	return (
		<div className="space-y-4" role="status">
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{stats.map(([label, value]) => (
					<div key={label} className="rounded-lg border border-kumo-line p-3">
						<p className="text-xs text-kumo-subtle">{t(label)}</p>
						<p className="text-2xl font-semibold">{value}</p>
					</div>
				))}
			</div>
			{result.confirmation_sent > 0 && (
				<p className="text-sm">
					{t("{count} confirmation emails are on their way.", { count: result.confirmation_sent })}
				</p>
			)}
			{result.skipped > 0 && (
				<details>
					<summary className="cursor-pointer text-sm font-medium">
						{Object.entries(result.skipped_by_reason)
							.map(([reason, count]) => `${t(reasonLabels[reason] ?? reason)}: ${count}`)
							.join(" · ")}
					</summary>
					<ul className="mt-2 max-h-60 space-y-1 overflow-auto text-sm">
						{result.skipped_rows.map((row) => (
							<li key={`${row.line}-${row.reason}`} className="flex gap-3">
								<span className="text-kumo-subtle">{t("Line {line}", { line: row.line })}</span>
								<span className="truncate">{row.email || "—"}</span>
								<span>
									{t(reasonLabels[row.reason] ?? row.reason)}
									{row.detail ? ` (${row.detail})` : ""}
								</span>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
