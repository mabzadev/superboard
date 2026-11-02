import { cache } from "react";

import { getServerSession, AuthSession, ServerAuthOptions } from "../middleware/serverAuth";

export const getCachedServerSession = cache(
	async (options: ServerAuthOptions): Promise<AuthSession | null> => {
		return getServerSession(options);
	},
);

export async function getNextAuth(options: ServerAuthOptions): Promise<{
	session: AuthSession | null;
	isAuthenticated: boolean;
	userId: string | null;
	email: string | null;
}> {
	const session = await getCachedServerSession(options);

	return {
		session,
		isAuthenticated: !!session,
		userId: session?.userId || null,
		email: session?.email || null,
	};
}
