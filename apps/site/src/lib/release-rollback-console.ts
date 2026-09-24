export interface ReleaseRollbackConsoleModel {
	rollback_activation_id: string;
	current_release_id: string;
	target_candidate_id: string;
	target_release_id: string;
	target_content_checksum: string;
	target_validation_set_checksum: string;
	next_pointer_revision: number;
	reauthentication_ready: boolean;
}

export function renderReleaseRollbackConsole(model: ReleaseRollbackConsoleModel): string {
	const requestJson = JSON.stringify({ activation_id: model.rollback_activation_id }).replaceAll(
		"<",
		"\\u003c",
	);
	return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rollback de Release — SuperBoard</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #171717; color: #ededed; }
    main { max-width: 58rem; margin: 0 auto; padding: 3rem 1.25rem; }
    a { color: #3ecf8e; }
    .card { background: #1c1c1c; border: 1px solid #282828; border-radius: 0.5rem; padding: 1.5rem; box-shadow: 0 1rem 3rem rgba(0,0,0,0.5); }
    .eyebrow { color: #f43f5e; font-size: .8rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: .5rem 0 1.5rem; font-size: clamp(1.8rem, 5vw, 3rem); font-family: Manrope, system-ui, sans-serif; }
    dl { display: grid; grid-template-columns: minmax(12rem, 17rem) 1fr; gap: .75rem 1rem; }
    dt { color: #9e9e9e; font-weight: 700; }
    dd { margin: 0; overflow-wrap: anywhere; font-family: "Source Code Pro", "Geist Mono", monospace; }
    .ready { margin: 1.5rem 0; padding: 1rem; border-radius: .5rem; background: ${model.reauthentication_ready ? "#064e3b" : "#451a03"}; border: 1px solid ${model.reauthentication_ready ? "#3ecf8e" : "#f59e0b"}; }
    .impact { margin: 1.5rem 0; padding: 1rem; border-radius: .5rem; background: #2c1518; border: 1px solid #f43f5e; }
    button { width: 100%; border: 1px solid #f43f5e; border-radius: .5rem; padding: .9rem 1rem; background: #f43f5e; color: white; font-size: 1rem; font-weight: 700; cursor: pointer; }
    button:hover { background: #e11d48; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    #result { min-height: 1.5rem; margin-top: 1rem; white-space: pre-wrap; }
    .back { display: inline-block; margin-top: 1.25rem; }
  </style>
</head>
<body>
  <main>
    <section class="card" aria-labelledby="title">
      <div class="eyebrow">Opérateur SuperBoard · développement · rollback pointer-only</div>
      <h1 id="title">Rollback de Release</h1>
      <dl>
        <dt>Opération de rollback</dt><dd>${escapeHtml(model.rollback_activation_id)}</dd>
        <dt>Release active actuelle</dt><dd>${escapeHtml(model.current_release_id)}</dd>
        <dt>Candidat cible</dt><dd>${escapeHtml(model.target_candidate_id)}</dd>
        <dt>Release cible</dt><dd>${escapeHtml(model.target_release_id)}</dd>
        <dt>Content checksum cible</dt><dd>${escapeHtml(model.target_content_checksum)}</dd>
        <dt>Validation set cible</dt><dd>${escapeHtml(model.target_validation_set_checksum)}</dd>
        <dt>Révision après rollback</dt><dd>${model.next_pointer_revision}</dd>
      </dl>
      <div class="impact">Cette action remplace atomiquement le pointeur actif par la précédente Last Verified Release. Aucun Store, objet ou session n’est supprimé.</div>
      <div class="ready" role="status">${
				model.reauthentication_ready
					? "Strong reauthentication de rollback récente détectée."
					: "Strong reauthentication de rollback requise. Reconnectez-vous par lien e-mail puis rechargez cette page."
			}</div>
      <button id="rollback" type="button"${model.reauthentication_ready ? "" : " disabled"}>Retourner vers cette Release</button>
      <div id="result" role="status" aria-live="polite"></div>
      <a class="back" href="/_emdash/admin">Retour à EmDash Admin</a>
    </section>
  </main>
  <script>
    const button = document.getElementById("rollback");
    const result = document.getElementById("result");
    button.addEventListener("click", async () => {
      button.disabled = true;
      result.textContent = "Rollback en cours…";
      try {
        const response = await fetch("/_emdash/api/superboard/releases/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
          body: JSON.stringify(${requestJson})
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.code || "ROLLBACK_FAILED");
        result.textContent = "Rollback terminé. Pointeur actif : " + payload.active_release_id + " · révision " + payload.pointer_revision + ".";
      } catch (error) {
        result.textContent = "Échec du rollback : " + (error instanceof Error ? error.message : "UNKNOWN_ERROR");
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
