export const EDITOR_FLAG_KEY = "emdash-editor";

export const TOOLBAR_DISMISSED_KEY = "emdash-toolbar-dismissed";

export const EDIT_PARAM = "_edit";

export function renderToolbarBootstrap(): string {
	return `
<!-- EmDash Toolbar Bootstrap -->
<script>
(function() {
  var flag, dismissed;
  try {
    flag = localStorage.getItem("${EDITOR_FLAG_KEY}");
    dismissed = localStorage.getItem("${TOOLBAR_DISMISSED_KEY}");
  } catch (e) {
    return;
  }
  if (!flag || dismissed) return;
  // The server toolbar is present on _edit / edit-mode / preview renders.
  if (document.getElementById("emdash-toolbar")) return;

  var root = document.createElement("div");
  root.id = "emdash-toolbar-bootstrap";
  root.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1;-webkit-font-smoothing:antialiased;";

  var inner = document.createElement("div");
  inner.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 16px;background:#1a1a1a;color:#e0e0e0;border-radius:999px;box-shadow:0 4px 24px rgba(0,0,0,0.3),0 0 0 1px rgba(255,255,255,0.08);white-space:nowrap;user-select:none;";

  var logo = document.createElement("span");
  logo.textContent = "EmDash";
  logo.style.cssText = "font-weight:600;font-size:12px;letter-spacing:0.02em;color:#fff;opacity:0.7;";

  var divider = document.createElement("span");
  divider.style.cssText = "width:1px;height:16px;background:rgba(255,255,255,0.15);";

  var editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.style.cssText = "padding:4px 12px;background:#3b82f6;color:#fff;border:none;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;";

  var closeBtn = document.createElement("button");
  closeBtn.textContent = "\\u00d7";
  closeBtn.title = "Hide toolbar";
  closeBtn.setAttribute("aria-label", "Hide toolbar");
  closeBtn.style.cssText = "background:none;border:none;color:#666;cursor:pointer;font-size:16px;padding:0 2px;line-height:1;font-family:inherit;";

  editBtn.addEventListener("click", function() {
    editBtn.disabled = true;
    fetch("/_emdash/api/auth/me", {
      credentials: "same-origin",
      headers: { "X-EmDash-Request": "1" }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(body) {
      var user = body && body.data;
      if (user && user.role >= 30) {
        var u = new URL(location.href);
        u.searchParams.set("${EDIT_PARAM}", "1");
        location.href = u.toString();
      } else if (user) {
        // Logged in but not an editor — the flag is stale for this browser.
        try { localStorage.removeItem("${EDITOR_FLAG_KEY}"); } catch (e) {}
        root.remove();
      } else {
        // No session — go to the admin login page.
        location.href = "/_emdash/admin/login";
      }
    })
    .catch(function() {
      editBtn.disabled = false;
    });
  });

  closeBtn.addEventListener("click", function() {
    try { localStorage.setItem("${TOOLBAR_DISMISSED_KEY}", "1"); } catch (e) {}
    root.remove();
  });

  inner.appendChild(logo);
  inner.appendChild(divider);
  inner.appendChild(editBtn);
  inner.appendChild(closeBtn);
  root.appendChild(inner);
  document.body.appendChild(root);
})();
</script>
`;
}
