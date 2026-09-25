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
const api = {endpoint:url,pages,total:ids.size,hongdae:hongdae.length,releaseStores:manifest.restaurants.length,releaseMenus:manifest.restaurants.reduce((n,r)=>n+r.menus,0),badTranslations:badTranslations.length};
if (badTranslations.length || hongdae.length < 200) throw new Error(JSON.stringify(api));
const storeCuration=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-name-curation.json","utf8")).names;
const menuCuration=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-menu-curation.json","utf8")).patches;
const menuById=new Map(manifest.restaurants.flatMap(r=>(ids.get(r.source_id)?.menus||[]).map(m=>[m.id,m])));
const wrongStores=storeCuration.filter(p=>ids.get(p.source_id)?.nameEn!==p.name_en||ids.get(p.source_id)?.nameJa!==p.name_ja);
const wrongMenus=menuCuration.filter(p=>menuById.get(p.menu_id)?.nameEn!==p.name_en||menuById.get(p.menu_id)?.nameJa!==p.name_ja);
api.curatedStoreNames=storeCuration.length;
api.curatedMenuNames=menuCuration.length;
api.curationMismatches=wrongStores.length+wrongMenus.length;
if(storeCuration.length!==40||menuCuration.length!==118||api.curationMismatches)throw Error("Bilingual curation QA failed: "+JSON.stringify({wrongStores,wrongMenus}));
const sample = ids.get(manifest.restaurants[0].source_id);
let browserQa = null;
if (withBrowser) {
  const browser=await puppeteer.launch({executablePath:process.env.BROWSER_PATH || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
  const checks=[];
  try {
    for (const [width,height] of [[390,844],[1440,900]]) {
      const page=await browser.newPage();await page.setViewport({width,height,deviceScaleFactor:1});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
      await page.waitForSelector(".discovery-card",{timeout:60000});
      const all=await page.evaluate(()=>({cards:document.querySelectorAll(".discovery-card").length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
      const clicked=await page.evaluate(()=>{
        const b=[...document.querySelectorAll(".filter-scroll button")].find(x=>x.textContent?.trim()==="Hongdae");
        if(b)b.click();return Boolean(b);
      });
      if(!clicked)throw new Error("Hongdae filter button missing");
      await page.waitForFunction(()=>document.querySelectorAll(".discovery-card").length===200,{timeout:20000});
      const filtered=await page.evaluate(()=>document.querySelectorAll(".discovery-card").length);
      await page.evaluate(()=>[...document.querySelectorAll(".public-language-toggle button")].find(x=>x.textContent?.includes("日本語"))?.click());
      await page.waitForFunction(()=>document.querySelectorAll(".discovery-card").length===200,{timeout:20000});
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
      checks.push({width,all,filtered,map,detail,errors});
      await page.close();
    }
  } finally {await browser.close()}
  browserQa=checks;
  if(checks.some(c=>c.all.cards<310||c.all.overflow>1||c.filtered!==200||c.detail.menus!==sample.menus.length||!c.detail.firstMenu||c.errors.length))throw new Error("Browser QA failed: "+JSON.stringify(checks));
  if(requireMap&&checks.some(c=>c.width===1440&&(c.map.status!=="ready"||c.map.markers<1)))throw new Error("NAVER Maps did not load: "+JSON.stringify(checks));
}
const report={checkedAt:new Date().toISOString(),api,browserQa};
const reportDir=path.resolve(".expansion-runs","qa-release");
fs.mkdirSync(reportDir,{recursive:true});
fs.writeFileSync(path.join(reportDir,"latest.json"),JSON.stringify(report,null,2),"utf8");
console.log(JSON.stringify(report,null,2));
