import { after } from "../after.js";

export const SESSION_GET_TIMEOUT_MS = 3_000;

export async function resolveSessionUser<T>(
	session: { get(key: "user"): Promise<T> } | undefined,
	timeoutMs = SESSION_GET_TIMEOUT_MS,
): Promise<T | undefined> {
	if (!session) return undefined;
	const read: Promise<T | undefined> = Promise.resolve(session.get("user")).catch(() => undefined);
	after(() =>
		read.then(
			() => undefined,
			() => undefined,
		),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(resolve, timeoutMs, undefined);
	});
	try {
		return await Promise.race([read, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
