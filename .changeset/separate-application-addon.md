---
"@superboard/supbrd-runtime-plugins": major
---

Remove the bundled Vocostar plugin and frontend from the SuperBoard platform. Vocostar sources now live in a separate application workspace. Deployments that use this addon must manage it from that workspace before upgrading; the platform no longer registers or routes Vocostar automatically.
