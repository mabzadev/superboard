import { useFrontContext } from "@superboard/front-ui/context";
import { useSearchParams } from "@superboard/front-ui/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { operatorMessages } from "./operator-messages.js";
import {
	operatorGet,
	operatorPost,
	registerOperatorPasskey,
	signInWithOperatorPasskey,
} from "./operator-passkey.js";

type Mode = "login" | "signup" | "recovery" | "credential" | "invite";
export function OperatorAccess({ mode }: { mode: Mode }) {
	const { locale } = useFrontContext();
	const text = operatorMessages[locale];
	const search = useSearchParams();
	const token = search.get("token");
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);
	const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
	const [invitation, setInvitation] = useState<{ email: string; roleName: string } | null>(null);
	const registration = mode === "invite" || (mode === "signup" && Boolean(token));
	useEffect(() => {
		if (mode !== "login" && mode !== "signup") return;
		let current = true;
		void operatorGet<{ providers?: { id: string; label: string }[] }>("/_emdash/api/auth/mode")
			.then((value) => {
				if (current) setProviders(Array.isArray(value.providers) ? value.providers : []);
			})
			.catch(() => {
				if (current) setProviders([]);
			});
		return () => {
			current = false;
		};
	}, [mode]);
	useEffect(() => {
		if (!registration) return;
		if (!token) {
			setError(text.invalidInvite);
			return;
		}
		let current = true;
		void operatorGet<{ email: string; roleName: string }>(
			`/_emdash/api/auth/${mode === "invite" ? "invite/accept" : "signup/verify"}?token=${encodeURIComponent(token)}`,
		)
			.then((value) => {
				if (current) setInvitation(value);
			})
			.catch((cause) => {
				if (current) setError(cause instanceof Error ? cause.message : text.failed);
			});
		return () => {
			current = false;
		};
	}, [registration, token, mode, text]);
	const destination = () => {
		const requested = search.get("redirect") ?? search.get("backTo") ?? "/superboard-system/home";
		const safe =
			requested.startsWith("/") &&
			!requested.startsWith("//") &&
			!/[\\\u0000-\u0020]/u.test(requested);
		return safe ? requested : "/superboard-system/home";
	};
	const returnPath = () => window.location.assign(destination());
	const providerHref = (id: string) => {
		const path =
			id === "google" || id === "github" ? `/_emdash/api/auth/oauth/${id}` : "/_emdash/admin/login";
		const params = new URLSearchParams({ redirect: destination() });
		if (token) params.set("invite", token);
		return `${path}?${params}`;
	};
	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : text.failed);
		} finally {
			setBusy(false);
		}
	}
	async function submit(event: FormEvent) {
		event.preventDefault();
		await run(async () => {
			if (registration && token && invitation) {
				await registerOperatorPasskey(
					`/_emdash/api/auth/${mode === "invite" ? "invite" : "signup"}/register-options`,
					`/_emdash/api/auth/${mode === "invite" ? "invite" : "signup"}/complete`,
					{ token, name },
				);
				returnPath();
			} else {
				await operatorPost(
					`/_emdash/api/auth/${mode === "signup" ? "signup/request" : "magic-link/send"}`,
					{ email: email.trim().toLowerCase() },
				);
				setSent(true);
			}
		});
	}
	return (
		<section className="mx-auto my-8 grid w-full max-w-md gap-5 rounded-lg border bg-card p-6">
			<h1 className="text-xl font-semibold">{text[mode]}</h1>
			{(mode === "recovery" || mode === "credential") && <p>{text.passwordless}</p>}
			{error && <p role="alert">{error}</p>}
			{sent ? (
				<p role="status">{text.sent}</p>
			) : registration && !invitation ? (
				<p role="status">{token ? text.loading : text.invalidInvite}</p>
			) : (
				<form className="grid gap-4" onSubmit={submit}>
					{registration ? (
						<>
							<p>
								{invitation?.email} · {invitation?.roleName}
							</p>
							<label>
								{text.name}
								<Input
									name="name"
									value={name}
									onChange={(event) => setName(event.target.value)}
									autoComplete="name"
									required
								/>
							</label>
						</>
					) : (
						<label>
							{text.email}
							<Input
								name="email"
								type="email"
								autoComplete="email"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								required
							/>
						</label>
					)}
					<Button type="submit" disabled={busy}>
						{busy ? text.busy : registration ? text.complete : text.send}
					</Button>
				</form>
			)}
			{mode === "login" && (
				<Button
					disabled={busy}
					onClick={() =>
						void run(async () => {
							await signInWithOperatorPasskey();
							returnPath();
						})
					}
				>
					{text.passkey}
				</Button>
			)}
			{!registration &&
				providers.map((provider) => (
					<Button key={provider.id} asChild variant="outline">
						<a href={providerHref(provider.id)}>{provider.label}</a>
					</Button>
				))}
			<a href="/_emdash/admin/login">{text.login}</a>
		</section>
	);
}
