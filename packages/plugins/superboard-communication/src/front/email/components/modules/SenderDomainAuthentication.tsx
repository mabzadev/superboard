import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { CheckCircle2, Copy, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	getSenderAuthentication,
	saveSenderAuthentication,
	verifySmtpDomain,
	type DnsRecord,
	type DnsRecordCheck,
	type DomainAuthenticationConfig,
	type DomainAuthenticationReport,
	type SenderAuthentication,
} from "../../api/email/emailService.js";
import { EMAIL_VALUE_LABELS, useEmailI18n } from "./email-i18n.js";

const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const statusClass: Record<string, string> = {
	verified: "text-emerald-600",
	mismatch: "text-red-600",
	missing: "text-amber-600",
	unconfigured: "text-muted-foreground",
};

/**
 * Domain authentication wizard of one sender identity: generates the exact SPF,
 * DKIM, DMARC (and SES MAIL FROM) records, copies them, and verifies their values.
 */
export function SenderDomainAuthentication({
	project,
	profileId,
	onVerified,
}: {
	project: string;
	profileId: string;
	onVerified?: () => void;
}) {
	const { t, locale } = useEmailI18n();
	const [authentication, setAuthentication] = useState<SenderAuthentication | null>(null);
	const [config, setConfig] = useState<DomainAuthenticationConfig>({});
	const [tokens, setTokens] = useState("");
	const [report, setReport] = useState<DomainAuthenticationReport | null>(null);
	const [busy, setBusy] = useState(false);
	const apply = useCallback((value: SenderAuthentication) => {
		setAuthentication(value);
		setConfig(value.config);
		setTokens((value.config.dkim_tokens ?? []).join(", "));
		setReport(value.report);
	}, []);
	useEffect(() => {
		let active = true;
		void Promise.resolve()
			.then(() => getSenderAuthentication(project, profileId))
			.then(
				(value) => {
					if (active) apply(value);
				},
				(cause: unknown) => {
					showErrorNotification(moduleErrorMessage(cause));
				},
			);
		return () => {
			active = false;
		};
	}, [project, profileId, apply]);
	const save = async () => {
		setBusy(true);
		try {
			apply(
				await saveSenderAuthentication(project, profileId, {
					...config,
					dkim_tokens: tokens
						.split(/[\s,]+/)
						.map((token) => token.trim())
						.filter(Boolean),
				}),
			);
			showSuccessNotification(t("DNS settings saved"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	const verify = async () => {
		setBusy(true);
		try {
			setReport(await verifySmtpDomain(project, profileId));
			showSuccessNotification(t("DNS records checked"));
			onVerified?.();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	if (!authentication) return null;
	const checks = new Map((report?.records ?? []).map((record) => [record.id, record]));
	const rows: Array<DnsRecord & Partial<DnsRecordCheck>> = authentication.records.map((record) => ({
		...record,
		...checks.get(record.id),
	}));
	const field = (key: keyof DomainAuthenticationConfig, label: string) => (
		<Input
			aria-label={t(label)}
			placeholder={t(label)}
			value={String(config[key] ?? "")}
			onChange={(event) => {
				setConfig((value) => ({ ...value, [key]: event.target.value || null }));
			}}
		/>
	);
	return (
		<div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
			<div>
				<p className="font-medium">
					{t("Domain authentication")} · {authentication.domain}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("Add these DNS records at your DNS provider, then verify them.")}
				</p>
			</div>
			<div className="grid gap-2 md:grid-cols-2">
				{authentication.provider === "aws-ses" ? (
					<>
						<Input
							aria-label={t("Amazon SES DKIM tokens (up to 3, comma separated)")}
							placeholder={t("Amazon SES DKIM tokens (up to 3, comma separated)")}
							value={tokens}
							onChange={(event) => {
								setTokens(event.target.value);
							}}
						/>
						{field(
							"mail_from_domain",
							"Custom MAIL FROM subdomain (optional, for example: mail.example.com)",
						)}
					</>
				) : (
					<>
						{field("spf_include", "SPF include of your provider (for example: _spf.provider.com)")}
						{field("dkim_selector", "DKIM selector")}
						<select
							aria-label={t("DKIM record type")}
							className={selectClass}
							value={config.dkim_type ?? "txt"}
							onChange={(event) => {
								setConfig((value) => ({
									...value,
									dkim_type: event.target.value === "cname" ? "cname" : "txt",
								}));
							}}
						>
							<option value="txt">{t("TXT (public key)")}</option>
							<option value="cname">{t("CNAME (provider target)")}</option>
						</select>
						{field("dkim_value", "DKIM value from your provider")}
					</>
				)}
				{field("dmarc_rua", "DMARC report address (optional)")}
			</div>
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" size="sm" disabled={busy} onClick={() => void save()}>
					<Save />
					{t("Save DNS settings")}
				</Button>
				<Button size="sm" disabled={busy} onClick={() => void verify()}>
					<RefreshCw />
					{t("Verify records")}
				</Button>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-start text-xs">
					<thead>
						<tr className="text-muted-foreground">
							<th className="p-1 text-start">{t("Type")}</th>
							<th className="p-1 text-start">{t("Host")}</th>
							<th className="p-1 text-start">{t("Value")}</th>
							<th className="p-1 text-start">{t("Status")}</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((record) => (
							<tr key={record.id} className="border-t align-top">
								<td className="p-1 font-mono">{record.type}</td>
								<td className="p-1">
									<CopyValue value={record.host} label={t("Host")} />
								</td>
								<td className="p-1">
									<CopyValue
										value={`${record.priority ? `${record.priority} ` : ""}${record.value}`}
										label={t("Value")}
										disabled={Boolean(record.needs)}
									/>
								</td>
								<td className="p-1">
									<p className={statusClass[record.status ?? ""] ?? "text-muted-foreground"}>
										{record.status
											? t(EMAIL_VALUE_LABELS[record.status] ?? record.status)
											: t("Not checked yet")}
									</p>
									{record.detail && (
										<p className="text-muted-foreground">
											{record.detail_key
												? t(record.detail_key, record.detail_params)
												: record.detail}
										</p>
									)}
									{record.status && record.status !== "verified" && record.found?.length ? (
										<p className="break-all font-mono text-muted-foreground">
											{t("Found: {value}", { value: record.found.join(" | ") })}
										</p>
									) : null}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{report && (
				<p
					className={`flex items-center gap-1 text-xs ${report.ready ? "text-emerald-600" : "text-amber-600"}`}
				>
					{report.ready && <CheckCircle2 className="size-4" />}
					{report.ready ? t("Ready to send") : t("Not ready: fix the records marked above.")}{" "}
					{t("Last checked {date}", {
						date: new Date(report.checkedAt).toLocaleString(locale),
					})}
				</p>
			)}
		</div>
	);
}

export function CopyValue({
	value,
	label,
	disabled = false,
}: {
	value: string;
	label: string;
	disabled?: boolean;
}) {
	const { t } = useEmailI18n();
	return (
		<span className="flex items-start gap-1">
			<code className="break-all">{value}</code>
			{!disabled && (
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0"
					aria-label={t("Copy {name}", { name: label })}
					onClick={() => {
						void navigator.clipboard?.writeText(value).then(
							() => {
								showSuccessNotification(t("Copied"));
							},
							(cause: unknown) => {
								showErrorNotification(moduleErrorMessage(cause));
							},
						);
					}}
				>
					<Copy className="size-3" />
				</Button>
			)}
		</span>
	);
}
