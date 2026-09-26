import type { DiscoveryRestaurant } from "./discovery";
import type { BroadCategory } from "./discovery-ui";

export type MapMarkerCategory = "pork" | "beef" | "mixed" | "grill" | "cafe" | "korean" | "global";
type MeatKind = Extract<MapMarkerCategory, "pork" | "beef" | "mixed">;
type MarkerStore = Pick<DiscoveryRestaurant, "id" | "name" | "category" | "licenseType" | "menus">;

// Audited against the currently published Seongsu (110) / Hongdae (40) records,
// using the actual category, specialty dishes and first-page menus. These overrides
// resolve venues whose main cuisine is obscured by generic categories or side dishes.
export const VERIFIED_PRIMARY_MEAT: Readonly<Record<string, MeatKind>> = {
  "naver:1014273417": "pork", // 사운드클라스카: pork BBQ specialties
  "naver:1739440199": "pork", // 꿉당: pork cuts
  "naver:2017470541": "pork", // 참나무집: pork specialties; beef is secondary
  "naver:19862383": "pork", // 성수족발
  "naver:2044007173": "pork", // 대산 참숯구이: pork BBQ
  "naver:2032812019": "pork", // 장담: pork grill main dishes
  "naver:1876884922": "beef", // 서울로인: hanwoo courses
  "naver:2057338165": "beef", // 소무관: beef soup and beef dishes
  "naver:292131610": "beef", // 비츠비츠: wagyu gyukatsu and beef steak
  "naver:1929517117": "pork", // 봉림대패: pork specialty, secondary beef cuts
  "naver:1348526323": "mixed", // 금성회관: pork and hanwoo signature dishes
  "naver:2028793825": "pork", // 연남달빛: pork cuts
  "naver:2066786830": "pork", // 조개우물보쌈: bossam main dishes
  "naver:2053367153": "mixed", // 형제특수부위: pork and beef signature platters
  "naver:1258564823": "mixed", // 팔계집: pork and hanwoo platters
  "naver:2056833208": "pork", // 매드족발
  "naver:1680391092": "mixed", // 정육도: hanwoo and handon sets
  "naver:1246697901": "pork", // 쟁반집8292: mainly pork cuts
  "naver:1547261740": "mixed", // 고기꾼김춘배: hanwoo/handon mixed sets
  "naver:2072437309": "beef", // 소팔소곱창: explicitly bovine offal
  "naver:2096733482": "pork", // 참뽀뽀쪽갈비: pork ribs and galmaegisal
};

const PORK_NAME = /돼지|한돈|흑돈|삼겹|오겹|족발|보쌈|갈매기|목살|돈갈비|쪽갈비/;
const BEEF_NAME = /한우|소고기|소곱창|소갈비|정육|와규/;
const PORK_MENU = /돼지|한돈|흑돈|삼겹|오겹|목살|가브리|항정|갈매기살|족발|보쌈|제육|쪽갈비|냉삼|이베리코/;
const BEEF_MENU = /한우|소고기|소갈비|소곱창|우삼겹|차돌|살치살|채끝|안창살|치마살|꽃등심|규카츠|와규|육회/;

export function markerCategory(store: MarkerStore, broad: BroadCategory): MapMarkerCategory {
  const verified = VERIFIED_PRIMARY_MEAT[store.id];
  if (verified) return verified;
  if (broad === "cafe" || broad === "dessert") return "cafe";
  const category = store.category || "";
  const categoryPork = /돼지고기구이|족발|보쌈/.test(category);
  const categoryBeef = /소고기구이|한우전문/.test(category);
  const meatVenue = categoryPork || categoryBeef ||
    /육류|고기요리|곱창|막창|정육|구이전문/.test(category) ||
    PORK_NAME.test(store.name) || BEEF_NAME.test(store.name);
  if (!meatVenue) {
    if (broad === "meat") return "grill"; // meat evidence but species unclear
    return broad === "korean" ? "korean" : "global";
  }
  const namePork = PORK_NAME.test(store.name);
  const nameBeef = BEEF_NAME.test(store.name);
  if (namePork && nameBeef) return "mixed";
  if (categoryPork) return "pork";
  if (categoryBeef) return "beef";
  const specialties = store.menus.filter(menu => menu.isSpecialty);
  const primaryMenus = (specialties.length >= 2 ? specialties : store.menus).slice(0, 12);
  const porkHits = primaryMenus.filter(menu => PORK_MENU.test(menu.nameKo)).length;
  const beefHits = primaryMenus.filter(menu => BEEF_MENU.test(menu.nameKo)).length;
  if (porkHits && beefHits) {
    if (porkHits >= beefHits * 3 && !nameBeef) return "pork";
    if (beefHits >= porkHits * 3 && !namePork) return "beef";
    return "mixed";
  }
  if (porkHits || namePork) return "pork";
  if (beefHits || nameBeef) return "beef";
  return "grill"; // Never guess pork or beef from "갈비/곱창" alone.
}

export const MAP_MARKER_LABELS: Record<MapMarkerCategory, { en: string; ja: string }> = {
  pork: { en: "Pork", ja: "豚肉" },
  beef: { en: "Beef", ja: "牛肉" },
  mixed: { en: "Pork & beef", ja: "豚肉・牛肉" },
  grill: { en: "BBQ", ja: "焼肉" },
  cafe: { en: "Cafe", ja: "カフェ" },
  korean: { en: "Korean food", ja: "韓国料理" },
  global: { en: "Restaurant", ja: "レストラン" },
};
