export interface ReleaseActivationConsoleModel {
	activation_id: string;
	candidate_id: string;
	release_id: string;
	content_checksum: string;
	validation_set_checksum: string;
	expected_active_release_id: string | null;
	next_pointer_revision: number;
	status: string;
	reauthentication_ready: boolean;
}

export function renderReleaseActivationConsole(model: ReleaseActivationConsoleModel): string {
	const canActivate = model.status === "approved" && model.reauthentication_ready;
	const requestJson = JSON.stringify({
		activation_id: model.activation_id,
		candidate_id: model.candidate_id,
		expected_active_release_id: model.expected_active_release_id,
	}).replaceAll("<", "\\u003c");
	return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Activation de Release — SuperBoard</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #eef2ff; }
    main { max-width: 58rem; margin: 0 auto; padding: 3rem 1.25rem; }
    a { color: #93c5fd; }
    .card { background: #111936; border: 1px solid #334155; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 1.5rem 4rem #02061780; }
    .eyebrow { color: #fbbf24; font-size: .8rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: .5rem 0 1.5rem; font-size: clamp(1.8rem, 5vw, 3rem); }
    dl { display: grid; grid-template-columns: minmax(12rem, 17rem) 1fr; gap: .75rem 1rem; }
    dt { color: #a5b4fc; font-weight: 700; }
    dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
    .ready { margin: 1.5rem 0; padding: 1rem; border-radius: .75rem; background: ${canActivate ? "#052e2b" : "#3b1d16"}; border: 1px solid ${canActivate ? "#0f766e" : "#b45309"}; }
    .impact { margin: 1.5rem 0; padding: 1rem; border-radius: .75rem; background: #422006; border: 1px solid #d97706; }
    button { width: 100%; border: 0; border-radius: .75rem; padding: .9rem 1rem; background: #b45309; color: white; font-size: 1rem; font-weight: 800; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    #result { min-height: 1.5rem; margin-top: 1rem; white-space: pre-wrap; }
    .back { display: inline-block; margin-top: 1.25rem; }
  </style>
</head>
<body>
  <main>
    <section class="card" aria-labelledby="title">
      <div class="eyebrow">Opérateur SuperBoard · développement · effet actif</div>
      <h1 id="title">Activation de Release</h1>
      <dl>
        <dt>Activation</dt><dd>${escapeHtml(model.activation_id)}</dd>
        <dt>Candidat</dt><dd>${escapeHtml(model.candidate_id)}</dd>
        <dt>Release</dt><dd>${escapeHtml(model.release_id)}</dd>
        <dt>Content checksum</dt><dd>${escapeHtml(model.content_checksum)}</dd>
        <dt>Validation set</dt><dd>${escapeHtml(model.validation_set_checksum)}</dd>
        <dt>Pointeur actif attendu</dt><dd>${model.expected_active_release_id ? escapeHtml(model.expected_active_release_id) : "Aucune Release active"}</dd>
        <dt>Révision du pointeur après activation</dt><dd>${model.next_pointer_revision}</dd>
        <dt>Statut du candidat</dt><dd>${escapeHtml(model.status)}</dd>
      </dl>
      <div class="impact">
        Cette action remplacera atomiquement le pointeur actif de l’Instance de développement et fera de cette Release la Last Verified Release servie par le Site.
      </div>
      <div class="ready" role="status">
        ${
				canActivate
					? "Strong reauthentication d’activation récente détectée. L’activation est disponible."
					: "Strong reauthentication d’activation requise ou candidat non approuvé. Reconnectez-vous par lien e-mail puis rechargez cette page."
			}
      </div>
      <button id="activate" type="button"${canActivate ? "" : " disabled"}>Activer cette Release</button>
      <div id="result" role="status" aria-live="polite"></div>
      <a class="back" href="/_emdash/admin">Retour à EmDash Admin</a>
    </section>
  </main>
  <script>
    const button = document.getElementById("activate");
    const result = document.getElementById("result");
    button.addEventListener("click", async () => {
      button.disabled = true;
      result.textContent = "Activation en cours…";
      try {
        const response = await fetch("/_emdash/api/superboard/releases/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
          body: JSON.stringify(${requestJson})
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.code || "ACTIVATION_FAILED");
        result.textContent = "Release activée. Pointeur actif : " + payload.active_release_id + " · révision " + payload.pointer_revision + ".";
      } catch (error) {
        result.textContent = "Échec de l’activation : " + (error instanceof Error ? error.message : "UNKNOWN_ERROR");
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
