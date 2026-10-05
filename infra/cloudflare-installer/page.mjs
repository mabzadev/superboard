const messages = {
	fr: {
		title: "Installer SuperBoard",
		intro: "Une instance indépendante dans votre compte Cloudflare.",
		accountTitle: "Connecter un compte",
		token: "Jeton API Cloudflare",
		analyticsToken: "Jeton Analytics Cloudflare en lecture seule",
		connect: "Afficher mes comptes",
		account: "Compte Cloudflare",
		domain: "Domaine",
		name: "Nom de l’instance",
		email: "Adresse e-mail de l’administrateur",
		buildToken: "Jeton de déploiement Cloudflare Builds",
		automatic: "Mettre à jour automatiquement depuis main",
		install: "Installer dans ce compte",
		another: "Ajouter un autre compte",
		pending: "Opération en cours…",
		sourceMissing:
			"Les sources nécessaires à l’installation ne sont pas encore disponibles sur main. Aucune ressource ne sera créée. Réessayez après leur publication.",
		queued:
			"Installation lancée dans Cloudflare Builds. Consultez le déploiement pour connaître son résultat.",
		registered:
			"Cette installation est déjà enregistrée. Consultez Cloudflare Builds pour suivre ou relancer son déploiement.",
		open: "Ouvrir Cloudflare Builds",
		error:
			"L’opération n’a pas abouti. Vérifiez les autorisations du jeton et la connexion GitHub dans Cloudflare.",
		empty: "Aucun domaine actif ou jeton Builds disponible dans ce compte.",
		setup:
			"Avant la première installation, autorisez l’application GitHub de Cloudflare pour mabzadev/superboard et créez un jeton Builds couvrant les ressources de cette instance.",
		permissions:
			"Le jeton API doit pouvoir lire vos comptes et domaines, configurer Workers Builds, créer les Workers, D1, KV, R2, Queues et Vectorize, et gérer les routes de ce domaine.",
		privacy:
			"Le jeton de configuration est transmis à Cloudflare et conservé comme secret Builds pendant l’installation. Sa copie est supprimée à la fin d’une installation réussie. Aucun jeton n’est enregistré dans le navigateur.",
		guide: "Préparer la connexion Cloudflare",
		domains:
			"L’installation utilise board., sdk., api. et in. sur le domaine choisi. Ces adresses doivent être libres.",
		updates:
			"Les futures publications sur main mettront à jour cette instance. Vos données et votre configuration restent dans ce compte.",
	},
	en: {
		title: "Install SuperBoard",
		intro: "An independent instance in your Cloudflare account.",
		accountTitle: "Connect an account",
		token: "Cloudflare API token",
		analyticsToken: "Read-only Cloudflare Analytics token",
		connect: "Show my accounts",
		account: "Cloudflare account",
		domain: "Domain",
		name: "Instance name",
		email: "Administrator email address",
		buildToken: "Cloudflare Builds deployment token",
		automatic: "Update automatically from main",
		install: "Install in this account",
		another: "Add another account",
		pending: "Working…",
		sourceMissing:
			"The installation sources are not available on main yet. No resources will be created. Try again after they are published.",
		queued: "Installation started in Cloudflare Builds. Open the deployment to check its result.",
		registered:
			"This installation is already registered. Open Cloudflare Builds to follow or retry its deployment.",
		open: "Open Cloudflare Builds",
		error: "The operation failed. Check token permissions and the GitHub connection in Cloudflare.",
		empty: "No active domain or Builds token is available in this account.",
		setup:
			"Before the first installation, authorize the Cloudflare GitHub app for mabzadev/superboard and create a Builds token covering this instance’s resources.",
		permissions:
			"The API token must read your accounts and domains, configure Workers Builds, create Workers, D1, KV, R2, Queues and Vectorize, and manage routes for this domain.",
		privacy:
			"The setup token is sent to Cloudflare and kept as a Builds secret during installation. Its copy is deleted after a successful installation. No token is saved in the browser.",
		guide: "Prepare the Cloudflare connection",
		domains:
			"Installation uses board., sdk., api. and in. on the selected domain. These addresses must be unused.",
		updates:
			"Future pushes to main will update this instance. Your data and configuration stay in this account.",
	},
};

export function installerPage(language) {
	const lang = language === "fr" ? "fr" : "en";
	const t = (key) => messages[lang][key];
	const translations = JSON.stringify(messages[lang]).replaceAll("<", "\\u003c");
	return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t("title")}</title><style>
*{box-sizing:border-box}body{font:16px/1.55 system-ui,sans-serif;margin:0;background:#f4f5f7;color:#18212b}main{max-width:760px;margin:4rem auto;padding:0 1.25rem}nav{display:flex;justify-content:space-between;align-items:center}nav strong{letter-spacing:.08em;font-size:.85rem}a{color:#185adb}h1{font-size:2.3rem;line-height:1.1;margin-bottom:.6rem}h2{font-size:1.2rem}section,form{background:white;border:1px solid #dce0e5;border-radius:14px;padding:1.5rem;margin-top:1.2rem}label{display:block;font-weight:600;margin-top:1rem}input,select,button{font:inherit}input:not([type=checkbox]),select{display:block;width:100%;padding:.7rem;margin-top:.4rem;border:1px solid #aab3bd;border-radius:7px}button{cursor:pointer;background:#18212b;color:#fff;border:0;border-radius:7px;padding:.75rem 1.1rem;margin-top:1.2rem}button:disabled{opacity:.5;cursor:wait}input:focus,select:focus,button:focus-visible,a:focus-visible{outline:3px solid #3876ee;outline-offset:3px}p{margin:.6rem 0}.hint{font-size:.9rem;color:#4c5968}.row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.check{display:flex;gap:.6rem;align-items:center}#status{white-space:pre-line;margin-top:1rem}#result{border-inline-start:4px solid #185adb}summary{cursor:pointer}a[hidden],[hidden]{display:none!important}@media(max-width:550px){main{margin:2rem auto}.row{grid-template-columns:1fr}section,form{padding:1rem}}
</style></head><body><main><nav><strong>SUPERBOARD / CLOUDFLARE</strong><span><a href="?lang=fr" lang="fr">Français</a> · <a href="?lang=en" lang="en">English</a></span></nav><h1>${t("title")}</h1><p>${t("intro")}</p>
<section><h2>${t("accountTitle")}</h2><p class="hint">${t("setup")}</p><a href="https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/" target="_blank" rel="noreferrer">${t("guide")}</a><label for="token">${t("token")}</label><input id="token" type="password" autocomplete="off" spellcheck="false"><details><summary>${t("permissions")}</summary><p class="hint">${t("privacy")}</p></details><button id="connect" type="button" disabled>${t("connect")}</button></section>
<form id="installation" hidden><label for="account">${t("account")}</label><select id="account" required></select><div class="row"><div><label for="name">${t("name")}</label><input id="name" required pattern="[a-z][a-z0-9-]{1,14}" maxlength="15" placeholder="vocostar" autocomplete="off"></div><div><label for="email">${t("email")}</label><input id="email" type="email" required autocomplete="email"></div></div><label for="domain">${t("domain")}</label><select id="domain" required></select><p class="hint">${t("domains")}</p><label for="analytics-token">${t("analyticsToken")}</label><input id="analytics-token" type="password" required autocomplete="off" minlength="20"><label for="build-token">${t("buildToken")}</label><select id="build-token" required></select><label class="check"><input id="automatic" type="checkbox" checked>${t("automatic")}</label><p class="hint">${t("updates")}</p><button id="install" type="submit">${t("install")}</button></form>
<p id="status" role="status" aria-live="polite"></p><section id="result" hidden><p id="result-text"></p><a id="dashboard" target="_blank" rel="noreferrer">${t("open")}</a><br><button id="another" type="button">${t("another")}</button></section>
</main><script>
const messages=${translations};
const el=(id)=>document.getElementById(id);
let installationId=crypto.randomUUID();
let busy=false;
fetch('/api/readiness').then(response=>response.json()).then(state=>{el('connect').disabled=!state.available;if(!state.available)el('status').textContent=messages.sourceMissing;}).catch(()=>{el('status').textContent=messages.sourceMissing;});
async function api(path,body={}){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-SuperBoard-Request':'1','Authorization':'Bearer '+el('token').value.trim()},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data.result;}
function options(id,values){el(id).replaceChildren();for(const value of values){const option=document.createElement('option');option.value=value.id;option.textContent=value.name;el(id).append(option);}}
async function action(fn){if(busy)return;busy=true;el('status').textContent=messages.pending;for(const id of ['connect','install','account'])el(id).disabled=true;try{await fn();el('status').textContent='';}catch(error){el('status').textContent=error.message==='INSTALLATION_SOURCE_NOT_PUBLISHED'?messages.sourceMissing:messages.error+'\\n'+error.message;}finally{busy=false;for(const id of ['connect','install','account'])el(id).disabled=false;}}
async function loadOptions(){options('domain',[]);options('build-token',[]);const result=await api('/api/options',{accountId:el('account').value});options('domain',result.zones.map(name=>({id:name,name})));options('build-token',result.tokens);if(!result.zones.length||!result.tokens.length)throw new Error(messages.empty);}
el('connect').addEventListener('click',()=>action(async()=>{const accounts=await api('/api/accounts');options('account',accounts);if(!accounts.length)throw new Error(messages.empty);el('installation').hidden=false;await loadOptions();}));
el('account').addEventListener('change',()=>action(async()=>{installationId=crypto.randomUUID();await loadOptions();}));
el('installation').addEventListener('submit',(event)=>{event.preventDefault();action(async()=>{const result=await api('/api/install',{accountId:el('account').value,name:el('name').value,domain:el('domain').value,email:el('email').value,buildTokenUuid:el('build-token').value,analyticsToken:el('analytics-token').value.trim(),automaticUpdates:el('automatic').checked,installationId});const dashboard=new URL(result.dashboard);if(dashboard.origin!=='https://dash.cloudflare.com')throw new Error('INSTALLATION_RESULT_INVALID');el('result-text').textContent=result.status==='queued'?messages.queued:messages.registered;el('dashboard').href=dashboard.href;el('result').hidden=false;el('installation').hidden=true;});});
el('another').addEventListener('click',()=>{el('token').value='';el('installation').reset();el('installation').hidden=true;el('result').hidden=true;el('status').textContent='';installationId=crypto.randomUUID();el('token').focus();});
</script></body></html>`;
}
