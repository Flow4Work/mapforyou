import { readFileSync, writeFileSync } from "node:fs";

const replacements = [
  {
    path: "components/PublicDataCollector.tsx",
    old: `              <option value="hongdae">홍대·마포구</option>
              <option value="geondae">건대·광진구</option>
              <option value="custom">직접 입력</option>`,
    next: `              <option value="hongdae">홍대·마포구</option>
              <option value="geondae">자양·건대·광진구</option>
              <option value="jongno">종로·종로구</option>
              <option value="custom">직접 입력</option>`,
  },
  {
    path: "app/api/redtable/collect/route.ts",
    old: `const REGION_ALIASES: Record<string, string[]> = {
  seongsu: ["성동구", "성수동"],
  hongdae: ["마포구", "서교동", "동교동", "연남동", "상수동", "합정동"],
};`,
    next: `const REGION_ALIASES: Record<string, string[]> = {
  seongsu: ["성동구", "성수동"],
  hongdae: ["마포구", "서교동", "동교동", "연남동", "상수동", "합정동"],
  geondae: ["광진구", "자양동", "화양동", "군자동"],
  jongno: ["종로구", "인사동", "익선동", "삼청동", "안국동", "가회동", "혜화동", "명륜동"],
};`,
  },
  {
    path: "lib/discovery.ts",
    old: `const ACTIVE_REGIONS = ["seongsu", "hongdae"];`,
    next: `const ACTIVE_REGIONS = ["seongsu", "hongdae", "geondae", "jongno"];`,
  },
  {
    path: "app/api/public-data/images/route.ts",
    old: `const ACTIVE_REGIONS = new Set(["seongsu", "hongdae"]);`,
    next: `const ACTIVE_REGIONS = new Set(["seongsu", "hongdae", "geondae", "jongno"]);`,
  },
  {
    path: "app/api/tourapi/images/route.ts",
    old: `const ACTIVE_REGIONS = ["seongsu", "hongdae"];`,
    next: `const ACTIVE_REGIONS = ["seongsu", "hongdae", "geondae", "jongno"];`,
  },
  {
    path: "app/api/tourapi/images/route.ts",
    old: `.replace(/\\b(성수|홍대|서울|왕십리|마포|성동)\\s*(점|본점|지점)?\\b/g, " ")`,
    next: `.replace(/\\b(성수|홍대|서울|왕십리|마포|성동|자양|건대|광진|종로|인사동|익선동|삼청동|안국)\\s*(점|본점|지점)?\\b/g, " ")`,
  },
  {
    path: "app/api/tourapi/images/route.ts",
    old: `  const district = store.region_key === "hongdae" ? "마포구" : "성동구";
  if (itemAddress.includes(district)) score += 15;`,
    next: `  const districtByRegion: Record<string, string> = {
    seongsu: "성동구",
    hongdae: "마포구",
    geondae: "광진구",
    jongno: "종로구",
  };
  const district = districtByRegion[store.region_key || ""] || "";
  if (district && itemAddress.includes(district)) score += 15;`,
  },
  {
    path: "lib/discovery-ui.ts",
    old: `    seongsu: { en: "Seongsu", ja: "聖水" },
    hongdae: { en: "Hongdae", ja: "弘大" },
    geondae: { en: "Konkuk Univ.", ja: "建大入口" },`,
    next: `    seongsu: { en: "Seongsu", ja: "聖水" },
    hongdae: { en: "Hongdae", ja: "弘大" },
    geondae: { en: "Konkuk Univ.", ja: "建大入口" },
    jongno: { en: "Jongno", ja: "鍾路" },`,
  },
  {
    path: "lib/discovery-ui.ts",
    old: `      .replace("ソンドング", "城東区")
      .replace("マポグ", "麻浦区");`,
    next: `      .replace("ソンドング", "城東区")
      .replace("マポグ", "麻浦区")
      .replace("クァンジング", "広津区")
      .replace("チョンノグ", "鍾路区");`,
  },
  {
    path: "lib/discovery-ui.ts",
    old: `    .replace("Seongdonggu", "Seongdong-gu")
    .replace("Mapogu", "Mapo-gu");`,
    next: `    .replace("Seongdonggu", "Seongdong-gu")
    .replace("Mapogu", "Mapo-gu")
    .replace("Gwangjingu", "Gwangjin-gu")
    .replace("Jongrogu", "Jongno-gu")
    .replace("Jonglogu", "Jongno-gu");`,
  },
  {
    path: "components/TourApiImageBackfill.tsx",
    old: `REDTABLE에 사진이 없는 성수·홍대 가게만 음식메뉴 이미지 → 대표 이미지 → 일반 이미지 순으로 확인합니다.`,
    next: `REDTABLE에 사진이 없는 성수·자양·홍대·종로 가게만 음식메뉴 이미지 → 대표 이미지 → 일반 이미지 순으로 확인합니다.`,
  },
];

let changed = 0;
for (const replacement of replacements) {
  const source = readFileSync(replacement.path, "utf8");
  if (source.includes(replacement.next)) continue;
  if (!source.includes(replacement.old)) {
    throw new Error(`Jongno patch target not found: ${replacement.path}`);
  }
  writeFileSync(replacement.path, source.replace(replacement.old, replacement.next), "utf8");
  changed += 1;
}

console.log(`Jongno region support ready (${changed} file patches applied).`);
