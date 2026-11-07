"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import {
	SettingsActions,
	SettingsRow,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	ChevronLeft,
	ChevronRight,
	Copy,
	ExternalLink,
	Globe2,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AcquisitionPage } from "../../../../AcquisitionPage.js";
import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";
import { ConfirmDialog, SettingsCard, SettingsGroup } from "../../../../SettingsLayout.js";
import {
	createDomain,
	deleteDomain,
	getDomains,
	verifyDomain,
	type DomainVerification,
	type DomainVerificationRecord,
	type LinkDomain,
} from "../../../api/dynamic-links/dynamicLinksService.js";

const hostnamePlaceholder = "links.example.com";
const checkMessages = {
	not_found:
		"No TXT record was found at {name} yet. DNS changes can take several minutes to propagate.",
	mismatch: "A TXT record exists at {name}, but its value does not match. Value found: {values}",
	lookup_failed: "The DNS lookup could not be completed. Try again in a moment.",
} as const;

type FailedCheck = { domainId: string; result: keyof typeof checkMessages; found: string[] };

function verificationRecord(domain: LinkDomain): DomainVerificationRecord {
	return (
		domain.verification_record ?? {
			type: "TXT",
			name: `_superboard.${domain.hostname}`,
			value: domain.verification_token,
		}
	);
}

function failedCheck(domainId: string, verification: DomainVerification): FailedCheck {
	const result = verification.check?.result;
	return {
		domainId,
		result: result && result !== "verified" ? result : "not_found",
		found: verification.check?.found ?? [],
	};
}

export default function DomainPageContent() {
	const { tr } = useFlowI18n();
	const { selectedProject } = useProjectSelection();
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();
	const [domains, setDomains] = useState<LinkDomain[]>([]);
	const [hostname, setHostname] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [checking, setChecking] = useState(false);
	const [lastCheck, setLastCheck] = useState<FailedCheck | null>(null);
	const [removing, setRemoving] = useState<LinkDomain | null>(null);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			setDomains(await getDomains(selectedProject.id));
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [selectedProject]);
	useEffect(() => {
		void load();
	}, [load]);

	const selected = domains.find((domain) => domain.id === search.get("domain"));
	const record = selected ? verificationRecord(selected) : null;
	const show = (domainId: string | null) => {
		const next = new URLSearchParams(search);
		if (domainId) next.set("domain", domainId);
		else next.delete("domain");
		const query = next.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	};
	const add = async () => {
		if (!selectedProject || !hostname.trim()) return;
		setSaving(true);
		try {
			const created = await createDomain(selectedProject.id, {
				hostname: hostname.trim().toLowerCase(),
				is_default: domains.length === 0,
			});
			setHostname("");
			showSuccessNotification(tr("Domain added. Publish the DNS record before verification."));
			await load();
			show(created.id);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};
	const verify = async (domain: LinkDomain) => {
		if (!selectedProject) return;
		setChecking(true);
		try {
			const verification = await verifyDomain(selectedProject.id, domain.id);
			if (verification.verified) {
				setLastCheck(null);
				showSuccessNotification(tr("Domain verified"));
			} else setLastCheck(failedCheck(domain.id, verification));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setChecking(false);
		}
	};
	const remove = async (domain: LinkDomain) => {
		if (!selectedProject) return;
		setSaving(true);
		try {
			await deleteDomain(selectedProject.id, domain.id);
			showSuccessNotification(tr("Domain removed"));
			show(null);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};
	const copy = async (value: string) => {
		await navigator.clipboard.writeText(value);
		showSuccessNotification(tr("DNS value copied"));
	};
	const copyAction = (value: string) => {
		copy(value).catch((cause: unknown) => {
			showErrorNotification(moduleErrorMessage(cause));
		});
	};

	return (
		<AcquisitionPage
			title={tr("Domain")}
			description={tr(
				"Serve branded dynamic links only after ownership has been verified through DNS.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : selected ? (
				<div className="flex w-full flex-col gap-6">
					<Button
						variant="ghost"
						size="sm"
						className="w-fit"
						onClick={() => {
							show(null);
						}}
					>
						<ChevronLeft className="rtl:-scale-x-100" />
						{tr("All domains")}
					</Button>
					<SettingsCard>
						<SettingsRow>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<h3 className="min-w-0 break-all font-semibold">{selected.hostname}</h3>
								<div className="flex flex-wrap items-center gap-2">
									{selected.is_default ? (
										<Badge variant="outline">{tr("Default link domain")}</Badge>
									) : null}
									<DomainStatus status={selected.status} />
								</div>
							</div>
							<p className="text-sm text-kumo-subtle">
								{selected.status === "verified"
									? tr(
											"DNS ownership has been verified. This domain can be used for published dynamic links.",
										)
									: tr(
											"Ownership of this domain is not verified yet. Publish the DNS record below, then verify it.",
										)}
							</p>
							{lastCheck?.domainId === selected.id && selected.status !== "verified" ? (
								<p role="status" className="text-sm text-kumo-warning">
									{tr(checkMessages[lastCheck.result])
										.replace("{name}", record?.name ?? "")
										.replace("{values}", lastCheck.found.join(", "))}
								</p>
							) : null}
							<SettingsActions>
								<Button asChild variant="outline">
									<a href={`https://${selected.hostname}`} target="_blank" rel="noreferrer">
										<ExternalLink className="size-4" />
										{tr("Open domain")}
									</a>
								</Button>
								<Button
									variant="destructive"
									disabled={saving}
									onClick={() => {
										setRemoving(selected);
									}}
								>
									<Trash2 className="size-4" />
									{tr("Remove")}
								</Button>
								{selected.status !== "verified" ? (
									<Button disabled={saving || checking} onClick={() => void verify(selected)}>
										<ShieldCheck className="size-4" />
										{tr(checking ? "Checking DNS…" : "Verify DNS")}
									</Button>
								) : null}
							</SettingsActions>
						</SettingsRow>
					</SettingsCard>
					{selected.status !== "verified" ? (
						<SettingsGroup
							title={tr("DNS ownership record")}
							description={tr(
								"Add this TXT record at your DNS provider, then run verification. Propagation can take several minutes.",
							)}
						>
							<SettingsRow>
								<p className="text-sm font-medium">{tr("Type")}</p>
								<code className="text-sm">{record?.type}</code>
							</SettingsRow>
							<DnsValue
								label={tr("Name")}
								value={record?.name ?? ""}
								copyLabel={tr("Copy")}
								onCopy={copyAction}
							/>
							<DnsValue
								label={tr("Value")}
								value={record?.value ?? ""}
								copyLabel={tr("Copy")}
								onCopy={copyAction}
							/>
						</SettingsGroup>
					) : null}
				</div>
			) : (
				<SettingsCard>
					{domains.length ? (
						<ul className="divide-y divide-kumo-line">
							{domains.map((domain) => (
								<li key={domain.id}>
									<button
										type="button"
										onClick={() => {
											show(domain.id);
										}}
										className="flex w-full items-center gap-3 p-4 text-start hover:bg-kumo-tint"
									>
										<Globe2 className="size-4" />
										<span className="min-w-0 flex-1 truncate">{domain.hostname}</span>
										{domain.is_default ? (
											<Badge variant="outline">{tr("Default link domain")}</Badge>
										) : null}
										<DomainStatus status={domain.status} />
										<ChevronRight className="size-4 text-kumo-subtle rtl:-scale-x-100" />
									</button>
								</li>
							))}
						</ul>
					) : (
						<SettingsRow>
							<p className="text-sm text-kumo-subtle">{tr("No custom domains configured.")}</p>
						</SettingsRow>
					)}
					<SettingsRow>
						<SettingsTextField
							label={tr("Branded domain")}
							placeholder={hostnamePlaceholder}
							value={hostname}
							onChange={(event) => {
								setHostname(event.currentTarget.value.toLowerCase().replace(/^https?:\/\//, ""));
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") add().catch(() => undefined);
							}}
						/>
						<SettingsActions>
							<Button
								variant="ghost"
								size="icon"
								aria-label={tr("Refresh domains")}
								disabled={loading}
								onClick={() => void load()}
							>
								<RefreshCw className={loading ? "animate-spin" : ""} />
							</Button>
							<Button disabled={saving || !hostname.trim()} onClick={() => void add()}>
								<Plus className="size-4" />
								{tr("Add domain")}
							</Button>
						</SettingsActions>
					</SettingsRow>
				</SettingsCard>
			)}
			<ConfirmDialog
				open={removing !== null}
				title={tr("Remove this domain?")}
				description={tr(
					"This domain stops serving dynamic links. Adding it again requires a new DNS verification.",
				)}
				confirm={tr("Remove")}
				cancel={tr("Cancel")}
				onConfirm={() => {
					if (removing) remove(removing).catch(() => undefined);
				}}
				onClose={() => {
					setRemoving(null);
				}}
			/>
		</AcquisitionPage>
	);
}

function DnsValue({
	label,
	value,
	copyLabel,
	onCopy,
}: {
	label: string;
	value: string;
	copyLabel: string;
	onCopy(value: string): void;
}) {
	return (
		<SettingsRow>
			<p className="text-sm font-medium">{label}</p>
			<div className="flex items-center gap-2 rounded-md border border-kumo-line p-2 ps-3">
				<code className="min-w-0 flex-1 break-all text-sm">{value}</code>
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						onCopy(value);
					}}
				>
					<Copy className="size-4" />
					{copyLabel}
				</Button>
			</div>
		</SettingsRow>
	);
}

function DomainStatus({ status }: { status: string }) {
	const { tr } = useFlowI18n();
	const labels: Record<string, string> = { verified: "Verified", pending: "Pending verification" };
	return (
		<Badge variant={status === "verified" ? "success" : "warning"}>
			{labels[status] ? tr(labels[status]) : status}
		</Badge>
	);
}
