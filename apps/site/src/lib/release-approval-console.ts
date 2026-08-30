export interface ReleaseApprovalConsoleModel {
	candidate_id: string;
	release_id: string;
	content_checksum: string;
	validation_set_checksum: string;
	validation_receipt_count: number;
	warnings_acknowledged: string[];
	status: string;
	reauthentication_ready: boolean;
}

export function renderReleaseApprovalConsole(model: ReleaseApprovalConsoleModel): string {
	const canApprove = model.status === "validated" && model.reauthentication_ready;
	const requestJson = JSON.stringify({
		candidate_id: model.candidate_id,
		warnings_acknowledged: model.warnings_acknowledged,
	}).replaceAll("<", "\\u003c");
	return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Approbation de Release — SuperBoard</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #eef2ff; }
    main { max-width: 58rem; margin: 0 auto; padding: 3rem 1.25rem; }
    a { color: #93c5fd; }
    .card { background: #111936; border: 1px solid #334155; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 1.5rem 4rem #02061780; }
    .eyebrow { color: #93c5fd; font-size: .8rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: .5rem 0 1.5rem; font-size: clamp(1.8rem, 5vw, 3rem); }
    dl { display: grid; grid-template-columns: minmax(10rem, 14rem) 1fr; gap: .75rem 1rem; }
    dt { color: #a5b4fc; font-weight: 700; }
    dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
    .ready { margin: 1.5rem 0; padding: 1rem; border-radius: .75rem; background: ${canApprove ? "#052e2b" : "#3b1d16"}; border: 1px solid ${canApprove ? "#0f766e" : "#b45309"}; }
    button { width: 100%; border: 0; border-radius: .75rem; padding: .9rem 1rem; background: #2563eb; color: white; font-size: 1rem; font-weight: 800; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    #result { min-height: 1.5rem; margin-top: 1rem; white-space: pre-wrap; }
    .back { display: inline-block; margin-top: 1.25rem; }
  </style>
</head>
<body>
  <main>
    <section class="card" aria-labelledby="title">
      <div class="eyebrow">Opérateur SuperBoard · développement</div>
      <h1 id="title">Approbation de Release</h1>
      <dl>
        <dt>Candidat</dt><dd>${escapeHtml(model.candidate_id)}</dd>
        <dt>Release</dt><dd>${escapeHtml(model.release_id)}</dd>
        <dt>Content checksum</dt><dd>${escapeHtml(model.content_checksum)}</dd>
        <dt>Validation set</dt><dd>${escapeHtml(model.validation_set_checksum)}</dd>
        <dt>Validation</dt><dd>${model.validation_receipt_count} reçus de validation</dd>
        <dt>Statut</dt><dd>${escapeHtml(model.status)}</dd>
      </dl>
      <div class="ready" role="status">
        ${
				canApprove
					? "Strong reauthentication récente détectée. L’approbation est disponible."
					: "Strong reauthentication requise ou candidat déjà traité. Reconnectez-vous par lien e-mail puis rechargez cette page."
			}
      </div>
      <button id="approve" type="button"${canApprove ? "" : " disabled"}>Approuver cette Release</button>
      <div id="result" role="status" aria-live="polite"></div>
      <a class="back" href="/_emdash/admin">Retour à EmDash Admin</a>
    </section>
  </main>
  <script>
    const button = document.getElementById("approve");
    const result = document.getElementById("result");
    button.addEventListener("click", async () => {
      button.disabled = true;
      result.textContent = "Approbation en cours…";
      try {
        const response = await fetch("/_emdash/api/superboard/releases/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
          body: JSON.stringify(${requestJson})
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.code || "APPROVAL_FAILED");
        result.textContent = "Release approuvée. Aucune activation n’a été effectuée.";
      } catch (error) {
        result.textContent = "Échec de l’approbation : " + (error instanceof Error ? error.message : "UNKNOWN_ERROR");
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
