import type { APIRoute } from "astro";

import { encodeBase64 } from "#utils/base64.js";

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const siteUrl = url.searchParams.get("site_url");
	const userLogin = url.searchParams.get("user_login");
	const password = url.searchParams.get("password");

	if (!siteUrl || !userLogin || !password) {
		return redirect("/_emdash/admin/import/wordpress?error=auth_rejected");
	}

	const token = encodeBase64(`${userLogin}:${password}`);

	const authData = JSON.stringify({
		siteUrl,
		userLogin,
		token,
		timestamp: Date.now(),
	});

	const encodedAuth = encodeBase64(authData);

	cookies.set("emdash_wp_auth", encodedAuth, {
		path: "/_emdash/",
		maxAge: 300,
		httpOnly: false,
		secure: url.protocol === "https:",
		sameSite: "lax",
	});

	return redirect("/_emdash/admin/import/wordpress?auth=success");
};
