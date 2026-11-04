"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import {
	Check,
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
import {
	createDomain,
	deleteDomain,
	getDomains,
	verifyDomain,
	type LinkDomain,
} from "../../../api/dynamic-links/dynamicLinksService.js";

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
		setSaving(true);
		try {
			await verifyDomain(selectedProject.id, domain.id);
			showSuccessNotification(tr("Domain verified"));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
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
				<div className="max-w-3xl space-y-5">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							show(null);
						}}
					>
						<ChevronLeft className="rtl:-scale-x-100" />
						{tr("All domains")}
					</Button>
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="me-1 break-all font-semibold">{selected.hostname}</h3>
						<DomainStatus status={selected.status} />
						{selected.is_default ? (
							<Badge variant="outline">{tr("Default link domain")}</Badge>
						) : null}
					</div>
					{selected.status !== "verified" ? (
						<>
							<Alert>
								<ShieldCheck className="size-4" />
								<AlertTitle>{tr("DNS ownership record")}</AlertTitle>
								<AlertDescription>
									{tr(
										"Add this TXT record at your DNS provider, then run verification. Propagation can take several minutes.",
									)}
								</AlertDescription>
							</Alert>
							<div className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-[120px_1fr_auto]">
								<div>
									<p className="text-xs text-muted-foreground">{tr("Type")}</p>
									<code>TXT</code>
								</div>
								<div className="min-w-0">
									<p className="text-xs text-muted-foreground">{tr("Name")}</p>
									<code className="break-all">_superboard.{selected.hostname}</code>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => void copy(`_superboard.${selected.hostname}`)}
								>
									<Copy className="size-4" />
									{tr("Copy")}
								</Button>
								<div>
									<p className="text-xs text-muted-foreground">{tr("Value")}</p>
									<code>superboard-verification</code>
								</div>
								<div className="min-w-0">
									<code className="break-all">{selected.verification_token}</code>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => void copy(selected.verification_token)}
								>
									<Copy className="size-4" />
									{tr("Copy")}
								</Button>
							</div>
						</>
					) : (
						<Alert>
							<Check className="size-4" />
							<AlertTitle>{tr("Ready to serve links")}</AlertTitle>
							<AlertDescription>
								{tr(
									"DNS ownership has been verified. This domain can be used for published dynamic links.",
								)}
							</AlertDescription>
						</Alert>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={saving || selected.status === "verified"}
							onClick={() => void verify(selected)}
						>
							<ShieldCheck className="size-4" />
							{tr("Verify DNS")}
						</Button>
						<Button asChild variant="outline">
							<a href={`https://${selected.hostname}`} target="_blank" rel="noreferrer">
								<ExternalLink className="size-4" />
								{tr("Open domain")}
							</a>
						</Button>
						<Button variant="destructive" disabled={saving} onClick={() => void remove(selected)}>
							<Trash2 className="size-4" />
							{tr("Remove")}
						</Button>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Input
							className="w-full max-w-xs"
							aria-label={tr("Branded domain")}
							placeholder="links.example.com"
							value={hostname}
							onChange={(event) =>
								setHostname(event.currentTarget.value.toLowerCase().replace(/^https?:\/\//, ""))
							}
							onKeyDown={(event) => {
								if (event.key === "Enter") void add();
							}}
						/>
						<Button disabled={saving || !hostname.trim()} onClick={() => void add()}>
							<Plus className="size-4" />
							{tr("Add domain")}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label={tr("Refresh domains")}
							disabled={loading}
							onClick={() => void load()}
						>
							<RefreshCw className={loading ? "animate-spin" : ""} />
						</Button>
					</div>
					{domains.length ? (
						<ul className="divide-y rounded-lg border">
							{domains.map((domain) => (
								<li key={domain.id}>
									<button
										type="button"
										onClick={() => {
											show(domain.id);
										}}
										className="flex w-full items-center gap-3 p-3 text-start hover:bg-muted/50"
									>
										<Globe2 className="size-4" />
										<span className="min-w-0 flex-1 truncate">{domain.hostname}</span>
										{domain.is_default ? (
											<Badge variant="outline">{tr("Default link domain")}</Badge>
										) : null}
										<DomainStatus status={domain.status} />
										<ChevronRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
									</button>
								</li>
							))}
						</ul>
					) : (
						<p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
							{tr("No custom domains configured.")}
						</p>
					)}
				</div>
			)}
		</AcquisitionPage>
	);
}

function DomainStatus({ status }: { status: string }) {
	const { tr } = useFlowI18n();
	const labels: Record<string, string> = { verified: "Verified", pending: "Pending verification" };
	return (
		<Badge variant={status === "verified" ? "default" : "secondary"}>
			{labels[status] ? tr(labels[status]) : status}
		</Badge>
	);
}
