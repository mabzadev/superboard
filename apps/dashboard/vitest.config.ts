import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**",
        "src/constants/**",
        "src/schemas/**",
        "src/hooks/**",
      ],
      exclude: [
        "src/lib/api.ts",
        "src/lib/RefreshTokenHelper.ts",
        "src/lib/Notifications.ts",
        "src/lib/ProtectedRoute.tsx",
        "src/lib/adminOnlyDisplay.tsx",
        "src/lib/copyTextHelper.tsx",
        "src/lib/config.ts",
        "src/hooks/use-mobile.ts",
        "src/hooks/useCreateLinkForm.ts",
        "src/hooks/useResolvedRedirects.ts",
        "src/hooks/useSetupProgress.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
