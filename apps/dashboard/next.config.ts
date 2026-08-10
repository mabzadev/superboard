// next.config.ts — OpenGrow dashboard on Cloudflare Workers via OpenNext.
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { resolve } from "node:path";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  reactStrictMode: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
