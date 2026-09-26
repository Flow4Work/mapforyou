import assert from "node:assert/strict";
import fs from "node:fs";
import { broadCategory } from "../lib/discovery-ui.ts";
import { markerCategory, VERIFIED_PRIMARY_MEAT, MAP_MARKER_LABELS } from "../lib/marker-category.ts";

const fixture = (name, category, names, id = "fixture") => ({
  id, name, category, licenseType: "", menus: names.map((nameKo, i) => ({ nameKo, isSpecialty: i < 4 })),
});
const classify = (store) => markerCategory(store, broadCategory(store));
const cases = [
  [fixture("참돼지집", "돼지고기구이", ["삼겹살", "목살"]), "pork"],
  [fixture("한우명가", "육류,고기요리", ["한우 채끝", "한우 등심"]), "beef"],
  [fixture("한돈한우 모둠", "육류,고기요리", ["한돈 삼겹살", "한우 채끝"]), "mixed"],
  [fixture("맛있는 갈비집", "육류,고기요리", ["양념갈비", "갈비세트"]), "grill"],
  [fixture("커피돼지 카페", "카페", ["돼지튀김 샌드위치"]), "cafe"],
  [fixture("스시 돈카츠", "일식", ["생등심 돈까스"]), "global"],
  [fixture("바닷가 장어", "장어요리", ["장어구이", "소갈비살"]), "global"],
  [fixture("해장국집", "한식", ["돼지국밥", "한우국밥"]), "korean"],
  [fixture("돼지곱창집", "곱창,막창", ["돼지곱창", "삼겹살"]), "pork"],
  [fixture("소곱창집", "곱창,막창", ["한우곱창", "한우대창"]), "beef"],
];
for (const [store, expected] of cases) assert.equal(classify(store), expected, store.name);
const path = ".expansion-runs/marker-audit/stores.json";
if (!fs.existsSync(path)) throw new Error("Run scripts/audit-published-marker-data.mjs first to create the real-data audit.");
const audited = JSON.parse(fs.readFileSync(path, "utf8"));
const counts = {};
for (const row of audited) {
  const s = {
    id: row.source_id, name: row.name, category: row.category || "",
    licenseType: row.license_type || "",
    menus: row.menus.map(m => ({ nameKo: m.name_ko, isSpecialty: m.is_specialty })),
  };
  const kind = classify(s);
  counts[kind] = (counts[kind] || 0) + 1;
  if (VERIFIED_PRIMARY_MEAT[s.id]) {
    assert.equal(kind, VERIFIED_PRIMARY_MEAT[s.id], s.name);
    console.log(kind.padEnd(5), s.name, s.id);
  }
}
assert.equal(audited.length, 150, "Expected 110 Seongsu + 40 Hongdae published stores");
const matched = audited.filter(s => VERIFIED_PRIMARY_MEAT[s.source_id]).length;
assert.equal(matched, Object.keys(VERIFIED_PRIMARY_MEAT).length, "Every species override must match a published store");
const toRgb = h => h.match(/[a-f\d]{2}/gi).map(x => parseInt(x,16)/255);
const lum = rgb => rgb.map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
for(const [kind, color] of Object.entries({pork:"#C34730",beef:"#82283D",mixed:"#A15F20"})){
  const [r,g,b] = toRgb(color.slice(1));
  assert(r>g && r>b, kind+" may not use a cool-colored meat marker");
  const contrast=1.05/(lum([r,g,b])+.05);
  assert(contrast>=4.5,kind+" white-icon contrast too low: "+contrast.toFixed(2));
  assert(MAP_MARKER_LABELS[kind].en && MAP_MARKER_LABELS[kind].ja);
  console.log("COLOR",kind,color,"WHITE_CONTRAST",contrast.toFixed(2));
}
console.log("QA_PASS",{fixtureCases:cases.length,audited:audited.length,verifiedMeat:matched,counts});
