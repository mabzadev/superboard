import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();

// The Dashboard does not externalize packages with workerd-specific exports.
// Keeping the conditional-package recopy pass enabled makes OpenNext attempt to
// transform ordinary string exports (for example Shiki's HAST utilities) and
// emit false "Failed to copy" errors after a successful bundle.
config.cloudflare = {
  ...config.cloudflare,
  useWorkerdCondition: false,
};

export default config;
