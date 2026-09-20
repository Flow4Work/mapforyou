import { readFileSync } from "node:fs";

const requirements = [
  {
    path: "lib/discovery.ts",
    markers: ["seongsu", "hongdae", "geondae", "jongno"],
  },
  {
    path: "app/api/public-data/images/route.ts",
    markers: ['new Set(["seongsu", "hongdae", "geondae", "jongno"])'],
  },
  {
    path: "app/api/tourapi/images/route.ts",
    markers: [
      '["seongsu", "hongdae", "geondae", "jongno"]',
      "districtByRegion",
      'jongno: "종로구"',
      "|종로|",
    ],
  },
  {
    path: "components/TourApiImageBackfill.tsx",
    markers: ["성수·자양·홍대·종로"],
  },
];
const missing = [];
for (const requirement of requirements) {
  const source = readFileSync(requirement.path, "utf8");
  for (const marker of requirement.markers) {
    if (!source.includes(marker)) missing.push(`${requirement.path}: ${marker}`);
  }
}

if (missing.length) {
  console.error("Jongno region support validation failed:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log("Jongno region support validated without modifying source files.");
