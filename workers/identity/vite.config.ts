import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths({ root: import.meta.dirname }), tailwindcss()],
  esbuild: { jsxImportSource: "hono/jsx/dom" },
  build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, "dist"),
    lib: {
      entry: resolve(import.meta.dirname, "src/melody/pages/client.tsx"),
      name: "SuperBoardIdentity",
      formats: ["es"],
      fileName: () => "client.js",
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.names?.some((name) => name.endsWith(".css"))
            ? "client.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
