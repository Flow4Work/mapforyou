// Legacy three-tab checks retired: the mobile home is now a map with a bottom sheet.
process.argv[2] ||= "https://mapforyou.vercel.app";
await import("./qa-mobile-map-sheet.mjs");
