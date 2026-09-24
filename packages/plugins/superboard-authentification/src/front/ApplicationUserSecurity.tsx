import { useFrontContext } from "@superboard/front-ui/context";
import { Button, LinkButton } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useState } from "react";

import { GET, POST } from "./transport.js";

const messages = {
	en: {
		title: "Security and sessions",
		loading: "Loading security…",
		retry: "Retry",
		active: "Account active",
		suspended: "Account suspended",
		resume: "Reactivate account",
		manage: "Manage identity",
		features: "Profile, roles, organizations, MFA, passkeys, invitations, consent and blocked IPs.",
		unlinked: "This account has no linked directory identity.",
		sessions: "Application sessions",
		empty: "No sessions.",
		created: "Created",
		expires: "Expires",
		revoke: "Revoke session",
		more: "Load more",
		failed: "Unable to load or update account security.",
		states: { active: "Active", revoked: "Revoked", expired: "Expired" },
	},
	fr: {
		title: "Sécurité et sessions",
		loading: "Chargement de la sécurité…",
		retry: "Réessayer",
		active: "Compte actif",
		suspended: "Compte suspendu",
		resume: "Réactiver le compte",
		manage: "Gérer l’identité",
		features:
			"Profil, rôles, organisations, MFA, passkeys, invitations, consentements et IP bloquées.",
		unlinked: "Ce compte n’a pas d’identité liée dans l’annuaire.",
		sessions: "Sessions de l’application",
		empty: "Aucune session.",
		created: "Créée le",
		expires: "Expire le",
		revoke: "Révoquer la session",
		more: "Charger la suite",
		failed: "Impossible de charger ou de modifier la sécurité du compte.",
		states: { active: "Active", revoked: "Révoquée", expired: "Expirée" },
	},
};
type Session = {
	id: string;
	created_at: string;
	expires_at: string;
	status: "active" | "revoked" | "expired";
};
type Security = {
	suspended: boolean;
	suspension: { reason: string } | null;
	directory_subject: string | null;
	items: Session[];
	nextCursor: string | null;
};

function readSecurity(value: unknown): Security {
	const data = record(record(value).data);
	if (typeof data.suspended !== "boolean" || !Array.isArray(data.items) || data.items.length > 50)
		throw new Error("security_response_invalid");
	return {
		suspended: data.suspended,
		suspension: data.suspension === null ? null : { reason: text(record(data.suspension).reason) },
		directory_subject: data.directory_subject === null ? null : text(data.directory_subject),
		nextCursor: data.nextCursor === null ? null : text(data.nextCursor),
		items: data.items.map((value: unknown) => {
			const item = record(value);
			const status = item.status;
			if (status !== "active" && status !== "revoked" && status !== "expired")
				throw new Error("security_response_invalid");
			const created_at = text(item.created_at);
			const expires_at = text(item.expires_at);
			if (!Number.isFinite(Date.parse(created_at)) || !Number.isFinite(Date.parse(expires_at)))
				throw new Error("security_response_invalid");
			return { id: text(item.id), created_at, expires_at, status };
		}),
	};
}
function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) throw new Error("security_response_invalid");
	return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
	if (typeof value !== "string") throw new Error("security_response_invalid");
	return value;
}

export default function ApplicationUserSecurity({
	projectRef,
	userId,
	onChange,
}: {
	projectRef: string;
	userId: string;
	onChange: () => Promise<void>;
}) {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const [data, setData] = useState<Security | null>(null);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);
	const base = `/api/v1/application-users/projects/${encodeURIComponent(projectRef)}/profiles/${encodeURIComponent(userId)}`;
	const read = useCallback(
		async (cursor?: string, signal?: AbortSignal) => {
			const response = await GET(
				`${base}/security${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
				{ signal },
			);
			return readSecurity(response.data);
		},
		[base],
	);
	useEffect(() => {
		const controller = new AbortController();
		void read(undefined, controller.signal)
			.then((next) => {
				if (!controller.signal.aborted) {
					setData(next);
					setFailed(false);
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => {
			controller.abort();
		};
	}, [read]);
	async function load(cursor?: string) {
		const next = await read(cursor);
		setData((previous) => ({
			...next,
			items: cursor && previous ? [...previous.items, ...next.items] : next.items,
		}));
		setFailed(false);
	}
	function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setFailed(false);
		Promise.resolve()
			.then(action)
			.then(
				() => {
					setBusy(false);
				},
				() => {
					setFailed(true);
					setBusy(false);
				},
			);
	}
	async function mutate(path: string) {
		await POST(`${base}/${path}`, { user_id: userId });
		await load();
		await onChange();
	}
	const date = (value: string) =>
		new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
			new Date(value),
		);
	return (
		<section className="grid gap-4 rounded-lg border bg-card p-5" aria-label={t.title}>
			<h3 className="text-lg font-semibold">{t.title}</h3>
			{failed && (
				<div role="alert">
					<p>{t.failed}</p>
					<Button
						disabled={busy}
						onClick={() => {
							run(() => load());
						}}
					>
						{t.retry}
					</Button>
				</div>
			)}
			{!data && !failed && <p role="status">{t.loading}</p>}
			{data && (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p>{data.suspended ? t.suspended : t.active}</p>
						{data.suspended && (
							<Button
								disabled={busy}
								onClick={() => {
									run(() => mutate("resume"));
								}}
							>
								{t.resume}
							</Button>
						)}
					</div>
					{data.suspension && (
						<p className="text-sm text-muted-foreground">{data.suspension.reason}</p>
					)}
					{data.directory_subject ? (
						<div className="grid gap-2">
							<LinkButton
								href={`/auth/directory/users/${encodeURIComponent(data.directory_subject)}?lang=${locale}`}
							>
								{t.manage}
							</LinkButton>
							<p className="text-sm text-muted-foreground">{t.features}</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{t.unlinked}</p>
					)}
					<h4 className="font-semibold">{t.sessions}</h4>
					{data.items.length === 0 && <p>{t.empty}</p>}
					{data.items.map((session) => (
						<article key={session.id} className="grid gap-2 rounded border p-3">
							<p className="break-all font-mono text-xs">{session.id}</p>
							<p>{t.states[session.status]}</p>
							<dl className="text-sm">
								<dt>{t.created}</dt>
								<dd>{date(session.created_at)}</dd>
								<dt>{t.expires}</dt>
								<dd>{date(session.expires_at)}</dd>
							</dl>
							{session.status === "active" && (
								<Button
									disabled={busy}
									onClick={() => {
										run(() => mutate(`sessions/${encodeURIComponent(session.id)}/revoke`));
									}}
								>
									{t.revoke}
								</Button>
							)}
						</article>
					))}
					{data.nextCursor && (
						<Button
							disabled={busy}
							onClick={() => {
								run(() => load(data.nextCursor ?? undefined));
							}}
						>
							{t.more}
						</Button>
					)}
				</>
			)}
		</section>
	);
}
