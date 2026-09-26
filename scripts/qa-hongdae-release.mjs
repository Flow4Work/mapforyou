import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
const url = (process.argv[2] || "http://127.0.0.1:3020").replace(/\/$/, "");
const withBrowser = process.argv.includes("--browser");
const requireMap = process.argv.includes("--require-map");
if (requireMap && !withBrowser) throw new Error("--require-map requires --browser");
const manifest = JSON.parse(fs.readFileSync("data/hongdae-2026-09-25.json", "utf8"));
const fetchPage = async (offset) => {
  const res = await fetch(url + "/api/discovery?perRegion=150&offset=" + offset, {signal:AbortSignal.timeout(60000)});
  if (!res.ok) throw new Error("Discovery HTTP " + res.status + ": " + (await res.text()).slice(0,300));
  return res.json();
};
const pages = [], ids = new Map();
for (let offset = 0, steps = 0; steps < 20; steps++) {
  const page = await fetchPage(offset); pages.push({offset,returned:page.stores.length,nextOffset:page.nextOffset});
  for (const store of page.stores) {
    if (ids.has(store.id)) throw new Error("Duplicate page entry: " + store.id);
    ids.set(store.id,store);
  }
  if (page.nextOffset == null) break;
  if (page.nextOffset <= offset) throw new Error("Pagination did not advance");
  offset = page.nextOffset;
}
const hongdae = [...ids.values()].filter(s => s.regionKey === "hongdae");
const missing = manifest.restaurants.filter(r => !ids.has(r.source_id));
const changed = manifest.restaurants.filter(r => {
  const s=ids.get(r.source_id);
  return s && (s.regionKey !== "hongdae" || s.menus.length !== r.menus || s.menus.filter(m=>m.imageStatus==="verified").length !== r.verified);
});
if (missing.length || changed.length) throw new Error(JSON.stringify({missing,changed}));
const badTranslations = manifest.restaurants.flatMap(r => ids.get(r.source_id).menus).filter(m=> !m.nameEn || !m.nameJa || !m.descriptionEn || !m.descriptionJa || /[가-힣]/.test([m.nameEn,m.nameJa,m.descriptionEn,m.descriptionJa].join(" ")));
const outside = hongdae.filter(s => s.latitude == null || s.longitude == null || s.latitude < 37.548 || s.latitude > 37.5665 || s.longitude < 126.91 || s.longitude > 126.936);
const unverified = hongdae.filter(s => !s.nameEn || !s.nameJa || !s.roadAddressEn || !s.roadAddressJa || !s.introductionEn || !s.introductionJa || !s.imageUrl);
const uniqueLocations = new Set(hongdae.map(s => s.name.replace(/[^가-힣a-z0-9]/gi,"").toLowerCase()+"|"+s.roadAddress.replace(/[^가-힣a-z0-9]/gi,"").toLowerCase()));
const api = {endpoint:url,pages,total:ids.size,hongdae:hongdae.length,releaseStores:manifest.restaurants.length,releaseMenus:manifest.restaurants.reduce((n,r)=>n+r.menus,0),badTranslations:badTranslations.length,outside:outside.length,unverified:unverified.length,duplicateLocations:hongdae.length-uniqueLocations.size};
const releaseMenuRows=manifest.restaurants.flatMap(r=>ids.get(r.source_id).menus);
api.verifiedImages=releaseMenuRows.filter(m=>m.imageStatus==="verified").length;
api.missingImages=releaseMenuRows.filter(m=>m.imageStatus==="not_available").length;
api.invalidImageFlags=releaseMenuRows.filter(m=>
  (m.imageStatus==="verified"&&!m.imageUrl)||
  (m.imageStatus==="not_available"&&Boolean(m.imageUrl))||
  !["verified","not_available"].includes(m.imageStatus)
).length;
if (badTranslations.length || hongdae.length !== manifest.restaurants.length || api.outside || api.unverified || api.duplicateLocations || api.verifiedImages!==1412 || api.missingImages!==42 || api.invalidImageFlags) throw new Error(JSON.stringify(api));
const storeCuration=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-name-curation.json","utf8")).names;
const menuCuration=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-menu-curation.json","utf8")).patches;
const menuById=new Map(manifest.restaurants.flatMap(r=>(ids.get(r.source_id)?.menus||[]).map(m=>[m.id,m])));
const wrongStores=storeCuration.filter(p=>ids.get(p.source_id)?.nameEn!==p.name_en||ids.get(p.source_id)?.nameJa!==p.name_ja);
const wrongMenus=menuCuration.filter(p=>menuById.get(p.menu_id)?.nameEn!==p.name_en||menuById.get(p.menu_id)?.nameJa!==p.name_ja);
const aiNames=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-ai-name-review.json","utf8"));
const editorialNames=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-editorial-names.json","utf8")).edits;
const aiDescriptions=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-ai-description-review.json","utf8"));
const editorialDescriptions=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-editorial-descriptions.json","utf8")).edits;
const nameReviews=new Map(aiNames.rows.map(r=>[r.menu_id,r]));
const descriptionReviews=new Map(aiDescriptions.rows.map(r=>[r.menu_id,r]));
const wrongAiNames=aiNames.rows.filter(r=>{const m=menuById.get(r.menu_id);return !m||m.nameKo!==r.name_ko||m.nameEn!==r.name_en||m.nameJa!==r.name_ja});
const wrongAiDescriptions=aiDescriptions.rows.filter(r=>{const m=menuById.get(r.menu_id);return !m||m.descriptionKo!==r.description_ko||m.descriptionEn!==r.description_en||m.descriptionJa!==r.description_ja});
const wrongEditorialNames=editorialNames.filter(r=>{const m=menuById.get(r.menu_id),a=nameReviews.get(r.menu_id);return !m||!a||m.nameKo!==r.name_ko||m.nameEn!==r.name_en||m.nameJa!==r.name_ja});
const wrongEditorialDescriptions=editorialDescriptions.filter(r=>{const m=menuById.get(r.menu_id),a=descriptionReviews.get(r.menu_id);return !m||!a||m.descriptionKo!==r.description_ko||m.descriptionEn!==r.description_en||m.descriptionJa!==r.description_ja});
api.aiReviewedNames=aiNames.rows.length;api.additionalEditorialNames=editorialNames.length;
api.aiReviewedDescriptions=aiDescriptions.rows.length;api.targetedEditorialDescriptions=editorialDescriptions.length;
api.translationRecordMismatches=wrongAiNames.length+wrongAiDescriptions.length+wrongEditorialNames.length+wrongEditorialDescriptions.length;
api.flaggedNumericDescriptions=aiDescriptions.rows.filter(r=>r.numeric_loss?.length).length;
if(aiNames.rows.length!==1336||editorialNames.length!==38||aiDescriptions.rows.length!==1035||editorialDescriptions.length!==45||nameReviews.size!==1336||descriptionReviews.size!==1035||aiDescriptions.summary.changed!==955||aiDescriptions.summary.syntheticDescriptionsHidden!==419||aiDescriptions.summary.editorialSourceCorrections!==45||api.flaggedNumericDescriptions!==30||api.translationRecordMismatches)throw Error("Expanded bilingual record QA failed: "+JSON.stringify({counts:api,wrongAiNames:wrongAiNames.slice(0,5).map(r=>r.menu_id),wrongAiDescriptions:wrongAiDescriptions.slice(0,5).map(r=>r.menu_id),wrongEditorialNames:wrongEditorialNames.slice(0,5).map(r=>r.menu_id),wrongEditorialDescriptions:wrongEditorialDescriptions.slice(0,5).map(r=>r.menu_id)}));
api.curatedStoreNames=storeCuration.length;
api.curatedMenuNames=menuCuration.length;
api.curationMismatches=wrongStores.length+wrongMenus.length;
if(storeCuration.length!==40||menuCuration.length!==118||api.curationMismatches)throw Error("Bilingual curation QA failed: "+JSON.stringify({wrongStores,wrongMenus}));
const legacy = await fetch(url + "/place/425739", {signal:AbortSignal.timeout(60000)});
if (!legacy.ok || !(await legacy.text()).includes("Archived restaurant listing")) throw new Error("Existing Mapo detail link was lost or lacks its legacy-data warning");
const sample = ids.get(manifest.restaurants[0].source_id);
let browserQa = null;
let standaloneQa = null;
if (withBrowser) {
  const browser=await puppeteer.launch({executablePath:process.env.BROWSER_PATH || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
  const checks=[];
  try {
    for (const [width,height] of [[390,844],[1440,900]]) {
      const page=await browser.newPage();await page.setViewport({width,height,deviceScaleFactor:1});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      if (width < 900) {
        await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
        await page.waitForSelector(".mobile-map-home .mobile-map-tools",{timeout:30000});
        await page.waitForFunction(()=>Object.keys(document.querySelector(".mobile-sheet-toggle")||{}).some(k=>k.startsWith("__reactProps$")),{timeout:25000});
        const map=await page.evaluate(()=>({status:document.querySelector(".naver-map-status")?.textContent?.trim()||"ready",markers:document.querySelectorAll(".naver-map-marker").length}));
        await page.click(".mobile-sheet-toggle");
        await page.waitForFunction(()=>document.querySelectorAll(".discovery-list .discovery-card").length===150,{timeout:15000});
        const all=await page.evaluate(()=>({cards:document.querySelectorAll(".discovery-list .discovery-card").length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
        await page.evaluate(()=>[...document.querySelectorAll(".mobile-map-chip-row:first-of-type button, .mobile-map-chip-row button")].find(x=>x.textContent?.trim()==="Hongdae")?.click());
        await page.waitForFunction(()=>document.querySelectorAll(".discovery-list .discovery-card").length===40,{timeout:15000});
        const filtered=await page.evaluate(()=>document.querySelectorAll(".discovery-list .discovery-card").length);
        const languageQa=[];
        for(const [button,expected] of [[0,sample.nameEn],[1,sample.nameJa],[0,sample.nameEn],[1,sample.nameJa]]) {
          await page.evaluate(i=>document.querySelectorAll(".public-language-toggle button")[i].click(),button);
          await page.waitForFunction(name=>[...document.querySelectorAll(".discovery-card .restaurant-card-name")].some(x=>x.textContent?.trim()===name),{timeout:15000},expected);
          languageQa.push(button===0?"en":"ja");
        }
        const chosen=await page.evaluate(name=>{
          const card=[...document.querySelectorAll(".discovery-list .discovery-card")].find(x=>x.querySelector(".restaurant-card-name")?.textContent?.trim()===name);
          card?.click();return Boolean(card);
        },sample.nameJa);
        if(!chosen)throw Error("Mobile Hongdae sample card not found");
        await page.waitForSelector(".mobile-selected-preview",{timeout:15000});
        await page.click(".mobile-detail-cta");
        await page.waitForFunction(name=>document.querySelector(".restaurant-detail-panel h1")?.textContent?.includes(name),{timeout:20000},sample.nameJa);
        const detail=await page.evaluate(()=>({menus:document.querySelectorAll(".restaurant-detail-panel .inline-menu-card").length,firstMenu:document.querySelector(".inline-menu-card h2")?.textContent?.trim()||""}));
        await page.click(".mobile-detail-back");
        await page.waitForFunction(()=>!document.querySelector(".mobile-details-open"),{timeout:10000});
        checks.push({width,all,filtered,map,detail,languageQa,errors,mobileSheet:true});
        await page.close();
        continue;
      }
      await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
      await page.waitForSelector(".discovery-card",{timeout:60000});
      // SSR cards can appear before React attaches the filter/language click handlers.
      await page.waitForFunction(() => {
        const button = document.querySelector(".filter-scroll button");
        return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
      }, {timeout:20000});
      const all=await page.evaluate(()=>({cards:document.querySelectorAll(".discovery-card").length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
      const clicked=await page.evaluate(()=>{
        const b=[...document.querySelectorAll(".filter-scroll button")].find(x=>x.textContent?.trim()==="Hongdae");
        if(b)b.click();return Boolean(b);
      });
      if(!clicked)throw new Error("Hongdae filter button missing");
      await page.waitForFunction(()=>document.querySelectorAll(".discovery-card").length===40,{timeout:20000});
      const filtered=await page.evaluate(()=>document.querySelectorAll(".discovery-card").length);
      await page.evaluate(()=>[...document.querySelectorAll(".public-language-toggle button")].find(x=>x.textContent?.includes("日本語"))?.click());
      await page.waitForFunction(()=>document.querySelectorAll(".discovery-card").length===40,{timeout:20000});
      const languageQa=[];
      for(const [button,expected] of [[0,sample.nameEn],[1,sample.nameJa],[0,sample.nameEn],[1,sample.nameJa]]) {
        await page.evaluate(i=>document.querySelectorAll(".public-language-toggle button")[i].click(),button);
        await page.waitForFunction(name=>[...document.querySelectorAll(".discovery-card .restaurant-card-name")].some(x=>x.textContent?.trim()===name),{timeout:10000},expected);
        languageQa.push(button===0?"en":"ja");
      }
      if(width>=1200) {
        try {
          await page.waitForFunction(()=>!!document.querySelector(".naver-map-status.error") || (
            !!document.querySelector("#naver-map-sdk")
            && !document.querySelector(".naver-map-status")
            && document.querySelectorAll(".naver-map-marker").length>0
          ),{timeout:25000});
        } catch { /* report the actual map state below */ }
      }
      const map=await page.evaluate(()=>({status:document.querySelector(".naver-map-status")?.textContent?.trim()||"ready",markers:document.querySelectorAll(".naver-map-marker").length}));
      const chosen=await page.evaluate(name=>{
        const card=[...document.querySelectorAll(".discovery-card")].find(x=>x.querySelector(".restaurant-card-name")?.textContent?.trim()===name);
        card?.click(); return Boolean(card);
      },sample.nameJa);
      if(!chosen)throw new Error("The newly added restaurant cannot be selected: "+sample.nameJa);
      await page.waitForFunction(name=>document.querySelector(".restaurant-detail-panel h1")?.textContent?.includes(name),{timeout:20000},sample.nameJa);
      const detail=await page.evaluate(()=>({menus:document.querySelectorAll(".restaurant-detail-panel .inline-menu-card").length,firstMenu:document.querySelector(".inline-menu-card h2")?.textContent?.trim()||""}));
      checks.push({width,all,filtered,map,detail,languageQa,errors});
      await page.close();
    }
    const synthetic = ids.get("naver:1113429489")?.menus.find(m => m.descriptionKo.trim() === `${m.nameKo.trim()} 메뉴입니다.`);
    if (!synthetic) throw new Error("Missing standalone placeholder-description regression fixture");
    const standalone = await browser.newPage();
    try {
      await standalone.goto(url + "/place/naver%3A1113429489", {waitUntil:"domcontentloaded", timeout:60000});
      await standalone.waitForSelector(".detail-menu-card", {timeout:20000});
      // The server-rendered menu appears before React attaches click handlers.
      await standalone.waitForFunction(() => {
        const button = document.querySelector(".public-language-toggle button:nth-child(2)");
        return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
      }, {timeout:20000});
      const noPlaceholderFor = async (name) => standalone.evaluate(label => {
        const card = [...document.querySelectorAll(".detail-menu-card")].find(x => x.querySelector("h3")?.textContent?.trim() === label);
        return Boolean(card) && !card.querySelector(".detail-menu-description");
      }, name);
      const hiddenInEn = await noPlaceholderFor(synthetic.nameEn);
      await standalone.click(".public-language-toggle button:nth-child(2)");
      await standalone.waitForFunction(name => [...document.querySelectorAll(".detail-menu-card h3")].some(x => x.textContent?.trim() === name), {timeout:10000}, synthetic.nameJa);
      const hiddenInJa = await noPlaceholderFor(synthetic.nameJa);
      standaloneQa = {menu:synthetic.nameKo, hiddenInEn, hiddenInJa};
      if (!hiddenInEn || !hiddenInJa) throw new Error("Synthetic descriptions leaked on the standalone page: " + JSON.stringify(standaloneQa));
    } finally {await standalone.close()}
  } finally {await browser.close()}
  browserQa=checks;
  if(checks.some(c=>c.all.cards<150||c.all.overflow>1||c.filtered!==40||c.detail.menus!==sample.menus.length||!c.detail.firstMenu||c.errors.length))throw new Error("Browser QA failed: "+JSON.stringify(checks));
  if(requireMap&&checks.some(c=>c.width===1440&&(c.map.status!=="ready"||c.map.markers!==40)))throw new Error("NAVER Maps must show exactly 40 Hongdae markers: "+JSON.stringify(checks));
}
const report={checkedAt:new Date().toISOString(),api,browserQa,standaloneQa};
const reportDir=path.resolve(".expansion-runs","qa-release");
fs.mkdirSync(reportDir,{recursive:true});
fs.writeFileSync(path.join(reportDir,"latest.json"),JSON.stringify(report,null,2),"utf8");
console.log(JSON.stringify(report,null,2));
