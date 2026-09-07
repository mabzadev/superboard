import { useFrontContext } from "@superboard/front-ui/context";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { operatorMessages } from "./operator-messages.js";
import { operatorGet, operatorPost, registerOperatorPasskey } from "./operator-passkey.js";
import { DELETE, PUT } from "./transport.js";

interface Passkey {
	id: string;
	name: string | null;
	lastUsedAt: string;
}

export function OperatorProfile({ security = false }: { security?: boolean }) {
	const { operator, locale } = useFrontContext();
	const text = operatorMessages[locale];
	const [name, setName] = useState(operator?.name ?? "");
	const [email, setEmail] = useState(operator?.email ?? "");
	const [passkeyName, setPasskeyName] = useState("");
	const [keys, setKeys] = useState<Passkey[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const loadKeys = useCallback(async () => {
		const value = await operatorGet<{ items: Passkey[] }>("/_emdash/api/auth/passkey");
		setKeys(value.items);
	}, []);
	useEffect(() => {
		if (security)
			void loadKeys().catch((cause) =>
				setError(cause instanceof Error ? cause.message : text.failed),
			);
	}, [security, loadKeys, text]);
	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		setSaved(false);
		try {
			await action();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : text.failed);
		} finally {
			setBusy(false);
		}
	}
	async function save(event: FormEvent) {
		event.preventDefault();
		if (!operator) return;
		await run(async () => {
			const response = await PUT(`/_emdash/api/admin/users/${encodeURIComponent(operator.id)}`, {
				name,
				email,
			});
			setName(response.data.data.item.name ?? "");
			setEmail(response.data.data.item.email);
			setSaved(true);
		});
	}
	return (
		<section className="mx-auto my-8 grid w-full max-w-xl gap-5 rounded-lg border bg-card p-6">
			<h1 className="text-xl font-semibold">{security ? text.account : text.profile}</h1>
			{error && <p role="alert">{error}</p>}
			{saved && <p role="status">{text.saved}</p>}
			{security ? (
				<>
					<p>{operator?.email}</p>
					{keys ? (
						keys.length ? (
							<ul className="grid gap-3">
								{keys.map((key) => (
									<li className="flex items-center justify-between gap-3" key={key.id}>
										<span>{key.name ?? key.id}</span>
										<Button
											variant="outline"
											disabled={busy}
											onClick={() =>
												void run(async () => {
													await DELETE(`/_emdash/api/auth/passkey/${encodeURIComponent(key.id)}`);
													await loadKeys();
												})
											}
										>
											{text.remove}
										</Button>
									</li>
								))}
							</ul>
						) : (
							<p>{text.noKeys}</p>
						)
					) : (
						<p role="status">{text.loading}</p>
					)}
					<form
						className="grid gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							void run(async () => {
								await registerOperatorPasskey(
									"/_emdash/api/auth/passkey/register/options",
									"/_emdash/api/auth/passkey/register/verify",
									{ name: passkeyName },
								);
								setPasskeyName("");
								await loadKeys();
							});
						}}
					>
						<label>
							{text.passkeyName}
							<Input
								value={passkeyName}
								onChange={(event) => setPasskeyName(event.target.value)}
								required
							/>
						</label>
						<Button disabled={busy}>{busy ? text.busy : text.register}</Button>
					</form>
					<a href="/app/profile">{text.editProfile}</a>
				</>
			) : (
				<form className="grid gap-3" onSubmit={save}>
					<label>
						{text.name}
						<Input
							name="name"
							autoComplete="name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							required
						/>
					</label>
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
					<Button disabled={busy || !operator || operator.role < 40}>
						{busy ? text.busy : text.save}
					</Button>
					<a href="/account">{text.security}</a>
				</form>
			)}
			<Button
				variant="outline"
				disabled={busy}
				onClick={() =>
					void run(async () => {
						await operatorPost("/_emdash/api/auth/logout", {});
						window.location.assign("/_emdash/admin/login");
					})
				}
			>
				{text.signOut}
			</Button>
		</section>
	);
}
