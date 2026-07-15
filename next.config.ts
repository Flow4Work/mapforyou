import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/public-data/instagram": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/admin/naver-browser-test": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
