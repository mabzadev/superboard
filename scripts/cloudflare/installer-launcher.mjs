import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function installerLauncher(origin) {
	const url = new URL(origin);
	if (url.protocol !== "https:" || url.origin !== origin)
		throw new Error("INSTALLATION_ORIGIN_INVALID");
	const destination = JSON.stringify(`${url.origin}/oauth/start`).replaceAll("<", "\\u003c");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>SuperBoard · Cloudflare</title><style>body{font:18px/1.6 system-ui,sans-serif;max-width:650px;margin:15vh auto;padding:24px;color:#18212b}a{color:#175ec4}</style></head><body><h1>SuperBoard</h1><p lang="fr">Ouverture de Cloudflare pour autoriser l’installation dans votre compte.</p><p lang="en">Opening Cloudflare to authorize installation in your account.</p><p><a id="continue">Continuer / Continue</a></p><script>const lang=new URLSearchParams(location.search).get('lang')==='fr'?'fr':'en';const url=${destination}+'?lang='+lang;document.getElementById('continue').href=url;location.replace(url);</script></body></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const directory = resolve("infra/generated/installer-launcher");
	await mkdir(directory, { recursive: true });
	await writeFile(
		`${directory}/index.html`,
		installerLauncher(process.env.SUPERBOARD_INSTALLER_ORIGIN),
	);
	await writeFile(`${directory}/.nojekyll`, "");
}
