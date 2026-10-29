const messages = {
	fr: {
		title: "Installer SuperBoard",
		intro: "Votre instance complète, dans votre compte Cloudflare.",
		connect: "Se connecter à Cloudflare",
		consent:
			"Cloudflare vous demande de choisir les comptes autorisés et de confirmer les permissions. Aucun jeton API à créer ou à coller.",
		account: "Compte Cloudflare",
		domain: "Domaine",
		name: "Nom de l’instance",
		email: "E-mail de l’administrateur",
		automatic: "Installer automatiquement les mises à jour de main",
		install: "Installer SuperBoard",
		another: "Autoriser un autre compte",
		pending: "Chargement…",
		unavailable:
			"L’installation n’est pas encore disponible. Réessayez après la configuration du service.",
		error: "L’opération n’a pas abouti.",
		emptyDomains: "Aucun domaine actif dans ce compte.",
		domains:
			"Des sous-domaines dédiés seront créés pour cette instance, sans remplacer vos sites existants. Les services et les données restent dans ce compte.",
		instances: "Vos installations",
		empty: "Aucune installation enregistrée.",
		queued: "En attente du démarrage du déploiement",
		deploying: "Installation ou mise à jour en cours",
		ready: "Installée",
		failed: "Le déploiement a échoué",
		open: "Ouvrir SuperBoard",
		logs: "Voir l’exécution GitHub",
		retry: "Réessayer",
		update: "Mettre à jour maintenant",
		refresh: "Actualiser",
		updates: "Mises à jour automatiques",
		progress:
			"L’installation est enregistrée. Le runner démarre au prochain passage, puis prépare les ressources, applique les migrations et déploie tous les services.",
		external:
			"Après l’installation, configurez les fournisseurs externes nécessaires à votre usage, comme l’envoi d’e-mails et les boutiques mobiles.",
		signIn: "Reconnectez-vous à Cloudflare pour continuer.",
		noToken: "Connexion sécurisée par Cloudflare",
		version: "Version",
		logout: "Se déconnecter",
		development: "Raccorder le développement existant aux mises à jour de dev",
		developmentHint: "Les ressources, données et secrets existants sont conservés.",
	},
	en: {
		title: "Install SuperBoard",
		intro: "Your complete instance, in your Cloudflare account.",
		connect: "Connect to Cloudflare",
		consent:
			"Cloudflare asks you to select the authorized accounts and approve the permissions. You do not need to create or paste an API token.",
		account: "Cloudflare account",
		domain: "Domain",
		name: "Instance name",
		email: "Administrator email",
		automatic: "Automatically install updates from main",
		install: "Install SuperBoard",
		another: "Authorize another account",
		pending: "Loading…",
		unavailable:
			"Installation is not available yet. Try again after the service has been configured.",
		error: "The operation did not complete.",
		emptyDomains: "No active domain in this account.",
		domains:
			"Dedicated subdomains will be created for this instance without replacing your existing sites. Services and data stay in this account.",
		instances: "Your installations",
		empty: "No installations registered.",
		queued: "Waiting for deployment to start",
		deploying: "Installation or update in progress",
		ready: "Installed",
		failed: "Deployment failed",
		open: "Open SuperBoard",
		logs: "View GitHub run",
		retry: "Retry",
		update: "Update now",
		refresh: "Refresh",
		updates: "Automatic updates",
		progress:
			"Your installation is registered. The runner starts on its next pass, then provisions resources, applies migrations, and deploys all services.",
		external:
			"After installation, configure the external providers you need, such as email delivery and mobile stores.",
		signIn: "Connect to Cloudflare again to continue.",
		noToken: "Secure connection through Cloudflare",
		version: "Version",
		logout: "Sign out",
		development: "Connect existing development to updates from dev",
		developmentHint: "Existing resources, data and secrets are preserved.",
	},
};
export function installerPage(language) {
	const lang = language === "fr" ? "fr" : "en";
	const t = (key) => messages[lang][key];
	const translations = JSON.stringify(messages[lang]).replaceAll("<", "\\u003c");
	return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t("title")}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#18212b;font:16px/1.55 system-ui,sans-serif}main{max-width:850px;margin:3rem auto;padding:0 1.25rem}nav{display:flex;align-items:center;justify-content:space-between}nav strong{letter-spacing:.09em;font-size:.85rem}h1{font-size:2.4rem;line-height:1.15;margin-bottom:.75rem}h2{font-size:1.25rem;margin:0 0 .75rem}h3{margin:0}a{color:#175ec4}section,form,li{background:white;border:1px solid #dce0e5;border-radius:14px;padding:1.4rem;margin-top:1.2rem}label{display:block;font-weight:600;margin-top:1rem}input,select,button{font:inherit}input:not([type=checkbox]),select{display:block;width:100%;padding:.7rem;margin-top:.35rem;border:1px solid #aab3bd;border-radius:7px}button,.button{display:inline-block;background:#18212b;color:white;border:0;border-radius:7px;padding:.7rem 1rem;cursor:pointer;text-decoration:none;margin-top:1rem}button:disabled,.button[aria-disabled=true]{opacity:.5;pointer-events:none}button.secondary{color:#18212b;background:#e9edf2}a:focus-visible,button:focus-visible,input:focus,select:focus{outline:3px solid #3876ee;outline-offset:3px}.hint{font-size:.9rem;color:#526171}.row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.check{display:flex;gap:.6rem;align-items:center;font-weight:400}.actions{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap}.actions a{margin-top:1rem}#status{white-space:pre-line;margin-top:1rem}ul{padding:0;list-style:none}li p{margin:.5rem 0}[hidden]{display:none!important}@media(max-width:580px){main{margin:1.5rem auto}.row{grid-template-columns:1fr}h1{font-size:2rem}}
</style></head><body><main><nav><strong>SUPERBOARD</strong><span><a href="?lang=fr" lang="fr">Français</a> · <a href="?lang=en" lang="en">English</a></span></nav><h1>${t("title")}</h1><p>${t("intro")}</p>
<section id="connection"><h2>${t("noToken")}</h2><p>${t("consent")}</p><a id="connect" class="button" aria-disabled="true" href="/oauth/start?lang=${lang}">${t("connect")}</a></section>
<form id="installation" hidden><label for="account">${t("account")}</label><select id="account" required></select><div class="row"><div><label for="name">${t("name")}</label><input id="name" required pattern="[a-z][a-z0-9-]{1,14}" maxlength="15" autocomplete="off"></div><div><label for="email">${t("email")}</label><input id="email" type="email" required autocomplete="email"></div></div><label for="domain">${t("domain")}</label><select id="domain" required></select><p class="hint">${t("domains")}</p><label class="check"><input id="automatic" type="checkbox" checked>${t("automatic")}</label><p class="hint">${t("external")}</p><button id="install" type="submit">${t("install")}</button><div class="actions"><a href="/oauth/start?lang=${lang}">${t("another")}</a><button id="logout" class="secondary" type="button">${t("logout")}</button></div></form>
<p id="status" role="status" aria-live="polite"></p><section id="instances" hidden><h2>${t("instances")}</h2><button id="refresh" class="secondary" type="button">${t("refresh")}</button><ul id="list"></ul></section>
<section id="development" hidden><p>${t("developmentHint")}</p><button id="adopt" type="button">${t("development")}</button></section>
</main><script>
const messages=${translations};
const el=(id)=>document.getElementById(id);
let busy=false;
let signedIn=false;
let installationId=crypto.randomUUID();
async function api(path,body={}){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-SuperBoard-Request':'1'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(response.status===401?'INSTALLATION_SESSION_REQUIRED':data.error);return data.result;}
function options(id,values){el(id).replaceChildren();for(const value of values){const option=document.createElement('option');option.value=value.id;option.textContent=value.name;el(id).append(option);}}
async function action(fn){if(busy)return;busy=true;el('status').textContent=messages.pending;el('install').disabled=true;try{await fn();}catch(error){el('status').textContent=error.message==='INSTALLATION_SESSION_REQUIRED'?messages.signIn:messages.error+'\\n'+error.message;}finally{busy=false;el('install').disabled=false;}}
async function loadOptions(){options('domain',[]);const result=await api('/api/options',{accountId:el('account').value});el('development').hidden=!result.development;options('domain',result.zones.map(name=>({id:name,name})));if(!result.zones.length)throw new Error(messages.emptyDomains);}
function element(tag,text){const node=document.createElement(tag);if(text)node.textContent=text;return node;}
async function instances(){const rows=await api('/api/instances');const list=el('list');list.replaceChildren();if(!rows.length)list.append(element('p',messages.empty));for(const row of rows){const item=element('li');item.append(element('h3',row.target_name),element('p',messages[row.status]||row.status));if(row.error_code)item.append(element('p',row.error_code));if(row.deployed_revision)item.append(element('p',messages.version+' '+row.deployed_revision.slice(0,8)));const actions=element('div');actions.className='actions';if(row.status==='ready'&&/^[a-z0-9.-]+$/.test(row.site||'')){const link=element('a',messages.open);link.href='https://'+row.site;link.target='_blank';link.rel='noreferrer';actions.append(link);}if(/^[0-9]+$/.test(row.github_run_id||'')){const link=element('a',messages.logs);link.href='https://github.com/mabzadev/superboard/actions/runs/'+row.github_run_id;link.target='_blank';link.rel='noreferrer';actions.append(link);}const label=element('label',messages.updates);label.className='check';const automatic=element('input');automatic.type='checkbox';automatic.checked=Boolean(row.automatic_updates);automatic.addEventListener('change',()=>action(async()=>{await api('/api/instances/configure',{id:row.id,automaticUpdates:automatic.checked});await instances();el('status').textContent='';}));label.prepend(automatic);item.append(label);if(row.status==='failed'||row.status==='ready'){const retry=element('button',row.status==='failed'?messages.retry:messages.update);retry.type='button';retry.className='secondary';retry.addEventListener('click',()=>action(async()=>{await api('/api/instances/configure',{id:row.id,automaticUpdates:automatic.checked,retry:row.status==='failed',update:row.status==='ready'});await instances();el('status').textContent=messages.progress;}));actions.append(retry);}item.append(actions);list.append(item);}el('instances').hidden=false;}
el('account').addEventListener('change',()=>action(async()=>{installationId=crypto.randomUUID();await loadOptions();el('status').textContent='';}));
el('installation').addEventListener('submit',(event)=>{event.preventDefault();action(async()=>{await api('/api/install',{accountId:el('account').value,name:el('name').value,domain:el('domain').value,email:el('email').value,automaticUpdates:el('automatic').checked,installationId});await instances();el('status').textContent=messages.progress;installationId=crypto.randomUUID();});});
el('refresh').addEventListener('click',()=>action(async()=>{await instances();el('status').textContent='';}));
el('logout').addEventListener('click',()=>action(async()=>{await api('/api/logout');location.reload();}));
async function start(){try{const state=await(await fetch('/api/readiness')).json();el('connect').setAttribute('aria-disabled',String(!state.available));if(!state.available){el('status').textContent=messages.unavailable;return;}const response=await fetch('/api/session');if(response.status===401)return;if(!response.ok)throw new Error('INSTALLATION_SESSION_REQUIRED');const session=(await response.json()).result;signedIn=true;el('connection').hidden=true;el('installation').hidden=false;el('email').value=session.email||'';options('account',session.accounts);await loadOptions();await instances();}catch(error){el('status').textContent=messages.error+'\\n'+error.message;}}
el('adopt').addEventListener('click',()=>action(async()=>{await api('/api/instances/development',{accountId:el('account').value});await instances();el('status').textContent=messages.progress;}));
void start();setInterval(()=>{if(signedIn&&!busy)void instances().catch(()=>{el('status').textContent=messages.signIn;});},15000);
</script></body></html>`;
}
