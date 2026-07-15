import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/public-data/naver-place-scan": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
