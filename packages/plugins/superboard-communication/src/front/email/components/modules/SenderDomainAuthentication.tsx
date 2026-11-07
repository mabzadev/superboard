import { Button, Select } from "@superboard/front-ui/kumo";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useAutosave } from "../../../marketing/studio/settings-autosave.js";
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

const tokenSeparator = /[\s,]+/;
const statusVariants: Record<string, "success" | "destructive" | "warning" | "default"> = {
	verified: "success",
	mismatch: "destructive",
	missing: "warning",
	unconfigured: "default",
};

export function SenderDomainAuthentication({
	project,
	profileId,
	onVerified,
}: {
	project: string;
	profileId: string;
	onVerified?: () => void;
}) {
	const [authentication, setAuthentication] = useState<SenderAuthentication | null>(null);
	useEffect(() => {
		let active = true;
		void Promise.resolve()
			.then(() => getSenderAuthentication(project, profileId))
			.then(
				(value) => {
					if (active) setAuthentication(value);
				},
				(cause: unknown) => {
					showErrorNotification(moduleErrorMessage(cause));
				},
			);
		return () => {
			active = false;
		};
	}, [project, profileId]);
	if (!authentication) return null;
	return (
		<DomainAuthenticationForm
			project={project}
			profileId={profileId}
			initial={authentication}
			onVerified={onVerified}
		/>
	);
}

function DomainAuthenticationForm({
	project,
	profileId,
	initial,
	onVerified,
}: {
	project: string;
	profileId: string;
	initial: SenderAuthentication;
	onVerified?: () => void;
}) {
	const { t, locale } = useEmailI18n();
	const [authentication, setAuthentication] = useState(initial);
	const [config, setConfig] = useState<DomainAuthenticationConfig>(initial.config);
	const [tokens, setTokens] = useState((initial.config.dkim_tokens ?? []).join(", "));
	const [report, setReport] = useState<DomainAuthenticationReport | null>(initial.report);
	const [busy, setBusy] = useState(false);
	const { indicator } = useAutosave({
		resourceKey: profileId,
		value: { config, tokens },
		save: async (next) => {
			const saved = await saveSenderAuthentication(project, profileId, {
				...next.config,
				dkim_tokens: next.tokens
					.split(tokenSeparator)
					.map((token) => token.trim())
					.filter(Boolean),
			});
			setAuthentication(saved);
			setReport(saved.report);
		},
	});
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
	const checks = new Map((report?.records ?? []).map((record) => [record.id, record]));
	const rows: Array<DnsRecord & Partial<DnsRecordCheck>> = authentication.records.map((record) => ({
		...record,
		...checks.get(record.id),
	}));
	const field = (key: keyof DomainAuthenticationConfig, label: string) => (
		<SettingsRow>
			<SettingsTextField
				label={t(label)}
				value={String(config[key] ?? "")}
				onChange={(event) => {
					setConfig((value) => ({ ...value, [key]: event.target.value || null }));
				}}
			/>
		</SettingsRow>
	);
	return (
		<div className="space-y-4">
			<SettingsSection
				title={t("Domain authentication · {domain}", { domain: authentication.domain })}
				description={t("Add these DNS records at your DNS provider, then verify them.")}
			>
				<SettingsRow className="flex items-center justify-between gap-4 space-y-0">
					<div className="min-w-0 space-y-0.5">
						<p className="text-sm font-medium">{t("Verification")}</p>
						{report && (
							<p className="text-xs text-kumo-subtle">
								{report.ready ? "" : `${t("Fix the records marked below.")} `}
								{t("Last checked {date}", {
									date: new Date(report.checkedAt).toLocaleString(locale),
								})}
							</p>
						)}
					</div>
					<Badge variant={report?.ready ? "success" : report ? "warning" : "default"}>
						{report?.ready ? t("Ready to send") : report ? t("Not ready") : t("Not checked yet")}
					</Badge>
				</SettingsRow>
				{authentication.provider === "aws-ses" ? (
					<>
						<SettingsRow>
							<SettingsTextField
								label={t("Amazon SES DKIM tokens (up to 3, comma separated)")}
								value={tokens}
								onChange={(event) => {
									setTokens(event.target.value);
								}}
							/>
						</SettingsRow>
						{field(
							"mail_from_domain",
							"Custom MAIL FROM subdomain (optional, for example: mail.example.com)",
						)}
					</>
				) : (
					<>
						{field("spf_include", "SPF include of your provider (for example: _spf.provider.com)")}
						{field("dkim_selector", "DKIM selector")}
						<SettingsRow>
							<Select
								className="w-full"
								label={t("DKIM record type")}
								value={config.dkim_type ?? "txt"}
								onValueChange={(next) => {
									setConfig((value) => ({
										...value,
										dkim_type: next === "cname" ? "cname" : "txt",
									}));
								}}
								items={{ txt: t("TXT (public key)"), cname: t("CNAME (provider target)") }}
							/>
						</SettingsRow>
						{field("dkim_value", "DKIM value from your provider")}
					</>
				)}
				{field("dmarc_rua", "DMARC report address (optional)")}
				<SettingsRow className="overflow-x-auto">
					<table className="w-full text-start text-xs">
						<thead>
							<tr className="text-kumo-subtle">
								<th className="p-1 text-start">{t("Type")}</th>
								<th className="p-1 text-start">{t("Host")}</th>
								<th className="p-1 text-start">{t("Value")}</th>
								<th className="p-1 text-start">{t("Status")}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((record) => (
								<tr key={record.id} className="border-t border-kumo-line align-top">
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
									<td className="space-y-1 p-1">
										<Badge variant={statusVariants[record.status ?? ""] ?? "default"}>
											{record.status
												? t(EMAIL_VALUE_LABELS[record.status] ?? record.status)
												: t("Not checked yet")}
										</Badge>
										{record.detail && (
											<p className="text-kumo-subtle">
												{record.detail_key
													? t(record.detail_key, record.detail_params)
													: record.detail}
											</p>
										)}
										{record.status && record.status !== "verified" && record.found?.length ? (
											<p className="break-all font-mono text-kumo-subtle">
												{t("Found: {value}", { value: record.found.join(" | ") })}
											</p>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</SettingsRow>
			</SettingsSection>
			<SettingsActions>
				<Button icon={RefreshCw} loading={busy} onClick={() => void verify()}>
					{t("Verify records")}
				</Button>
			</SettingsActions>
			{indicator}
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
					size="xs"
					shape="square"
					className="shrink-0"
					icon={<Copy className="size-3" />}
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
				/>
			)}
		</span>
	);
}
