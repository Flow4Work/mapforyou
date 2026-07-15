import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/public-data/instagram": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/public-data/naver-place-scan": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/admin/naver-scan-smoke": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
