"use client";

import {
	Check,
	Copy,
	ExternalLink,
	Globe2,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "../../../../../../../../../../supbrd-front-ui/src/shared/components/modules/ModulePage.js";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "../../../../../../../../../../supbrd-front-ui/src/shared/components/ui/alert.js";
import { Badge } from "../../../../../../../../../../supbrd-front-ui/src/shared/components/ui/badge.js";
import { Button } from "../../../../../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../../../../../../../../supbrd-front-ui/src/shared/components/ui/card.js";
import { Input } from "../../../../../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { useProjectSelection } from "../../../../../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "../../../../../../../../../../supbrd-front-ui/src/shared/lib/Notifications.js";
import {
	createDomain,
	deleteDomain,
	getDomains,
	verifyDomain,
	type LinkDomain,
} from "../../../api/dynamic-links/dynamicLinksService.js";

export default function DomainPageContent() {
	const { selectedProject } = useProjectSelection();
	const [domains, setDomains] = useState<LinkDomain[]>([]);
	const [selectedId, setSelectedId] = useState<string>();
	const [hostname, setHostname] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			const data = await getDomains(selectedProject.id);
			setDomains(data);
			setSelectedId((current) =>
				current && data.some((domain) => domain.id === current) ? current : data[0]?.id,
			);
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

	const selected = domains.find((domain) => domain.id === selectedId);
	const add = async () => {
		if (!selectedProject || !hostname.trim()) return;
		setSaving(true);
		try {
			const created = await createDomain(selectedProject.id, {
				hostname: hostname.trim().toLowerCase(),
				is_default: domains.length === 0,
			});
			setHostname("");
			showSuccessNotification("Domain added. Publish the DNS record before verification.");
			await load();
			setSelectedId(created.id);
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
			showSuccessNotification("Domain verified");
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
			showSuccessNotification("Domain removed");
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};
	const copy = async (value: string) => {
		await navigator.clipboard.writeText(value);
		showSuccessNotification("DNS value copied");
	};

	return (
		<ModulePage
			title="Domain"
			description="Serve branded dynamic links only after ownership has been verified through DNS."
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="grid gap-6 xl:grid-cols-[360px_1fr]">
					<div className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Add a branded domain</CardTitle>
								<CardDescription>
									Use a dedicated subdomain such as links.example.com.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								<Input
									placeholder="links.example.com"
									value={hostname}
									onChange={(event) =>
										setHostname(event.currentTarget.value.toLowerCase().replace(/^https?:\/\//, ""))
									}
									onKeyDown={(event) => {
										if (event.key === "Enter") void add();
									}}
								/>
								<Button
									className="w-full"
									disabled={saving || !hostname.trim()}
									onClick={() => void add()}
								>
									<Plus className="size-4" />
									Add domain
								</Button>
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex-row items-center justify-between">
								<div>
									<CardTitle>Configured domains</CardTitle>
									<CardDescription>{domains.length} domains</CardDescription>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label="Refresh domains"
									disabled={loading}
									onClick={() => void load()}
								>
									<RefreshCw className={loading ? "animate-spin" : ""} />
								</Button>
							</CardHeader>
							<CardContent className="space-y-2">
								{domains.length ? (
									domains.map((domain) => (
										<button
											key={domain.id}
											type="button"
											onClick={() => setSelectedId(domain.id)}
											className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${domain.id === selectedId ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
										>
											<Globe2 className="size-4" />
											<span className="min-w-0 flex-1 truncate">{domain.hostname}</span>
											<Badge
												variant={domain.status === "verified" ? "default" : "secondary"}
												className="capitalize"
											>
												{domain.status}
											</Badge>
										</button>
									))
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										No custom domains configured.
									</p>
								)}
							</CardContent>
						</Card>
					</div>
					<Card className="h-fit">
						<CardHeader>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<CardTitle>{selected?.hostname || "Domain verification"}</CardTitle>
									<CardDescription>
										{selected
											? "Complete the DNS record below, then run verification."
											: "Select or add a domain to configure it."}
									</CardDescription>
								</div>
								{selected?.status === "verified" ? (
									<Badge className="gap-1">
										<Check className="size-3" />
										Verified
									</Badge>
								) : null}
							</div>
						</CardHeader>
						<CardContent className="space-y-5">
							{selected ? (
								<>
									{selected.status !== "verified" ? (
										<>
											<Alert>
												<ShieldCheck className="size-4" />
												<AlertTitle>DNS ownership record</AlertTitle>
												<AlertDescription>
													Add this TXT record at your DNS provider. Propagation can take several
													minutes.
												</AlertDescription>
											</Alert>
											<div className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-[120px_1fr_auto]">
												<div>
													<p className="text-xs text-muted-foreground">Type</p>
													<code>TXT</code>
												</div>
												<div className="min-w-0">
													<p className="text-xs text-muted-foreground">Name</p>
													<code className="break-all">_superboard.{selected.hostname}</code>
												</div>
												<Button
													variant="outline"
													size="sm"
													onClick={() => void copy(`_superboard.${selected.hostname}`)}
												>
													<Copy className="size-4" />
													Copy
												</Button>
												<div>
													<p className="text-xs text-muted-foreground">Value</p>
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
													Copy
												</Button>
											</div>
										</>
									) : (
										<Alert>
											<Check className="size-4" />
											<AlertTitle>Ready to serve links</AlertTitle>
											<AlertDescription>
												DNS ownership has been verified. This domain can be used for published
												dynamic links.
											</AlertDescription>
										</Alert>
									)}
									<div className="flex flex-wrap gap-2">
										<Button
											disabled={saving || selected.status === "verified"}
											onClick={() => void verify(selected)}
										>
											<ShieldCheck className="size-4" />
											Verify DNS
										</Button>
										<Button asChild variant="outline">
											<a href={`https://${selected.hostname}`} target="_blank" rel="noreferrer">
												<ExternalLink className="size-4" />
												Open domain
											</a>
										</Button>
										<Button
											variant="destructive"
											disabled={saving}
											onClick={() => void remove(selected)}
										>
											<Trash2 className="size-4" />
											Remove
										</Button>
									</div>
									{selected.is_default ? (
										<Badge variant="outline">Default link domain</Badge>
									) : null}
								</>
							) : (
								<div className="py-24 text-center text-sm text-muted-foreground">
									No domain selected.
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}
