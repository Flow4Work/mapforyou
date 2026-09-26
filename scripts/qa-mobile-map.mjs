import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
import puppeteer from "puppeteer-core";
const url=(process.argv[2]||"https://mapforyou.vercel.app").replace(/\/$/,"");
const dir=".expansion-runs/marker-audit";
fs.mkdirSync(dir,{recursive:true});
const api=await (await fetch(url+"/api/discovery?perRegion=150&offset=0")).json();
const samples=[["pork","naver:2056833208","rgb(195, 71, 48)",1],["beef","naver:2072437309","rgb(130, 40, 61)",1],["mixed","naver:1547261740","rgb(161, 95, 32)",2]];
const browser=await puppeteer.launch({executablePath:process.env.BROWSER_PATH||"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
const qa=[], errors=[];
async function open(width,height) {
 const p=await browser.newPage(); await p.setViewport({width,height,deviceScaleFactor:1});
 p.on("pageerror",e=>errors.push(width+": "+e.message));
 await p.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
 await p.waitForSelector(".discovery-card",{timeout:40000});
 await p.waitForFunction(()=>Object.keys(document.querySelector(".mobile-panel-tabs button")||{}).some(k=>k.startsWith("__reactProps$")),{timeout:25000});
 return p;
}
const state=async p=>p.evaluate(()=>({tabs:[...document.querySelectorAll(".mobile-panel-tabs button")].map(e=>({label:e.textContent.trim(),active:e.classList.contains("active")})),mapPanel:getComputedStyle(document.querySelector(".discovery-map-panel")).display,mapWidth:Math.round(document.querySelector(".discovery-map-panel").getBoundingClientRect().width),mapHeight:Math.round(document.querySelector(".discovery-map-panel").getBoundingClientRect().height),mapStatus:document.querySelector(".naver-map-status")?.textContent?.trim()||"ready",markers:document.querySelectorAll(".naver-map-marker").length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
try {
 const p=await open(390,844);
 assert.deepEqual((await state(p)).tabs.map(t=>t.label),["Places","Map","Menu"]);
 assert.equal((await state(p)).mapPanel,"none");
 await p.click(".filter-scroll button:nth-child(2)");
 await p.waitForFunction(()=>document.querySelectorAll(".discovery-card").length===40,{timeout:25000});
 for(const [kind,id,color,svgCount] of samples) {
  const name=api.stores.find(s=>s.id===id)?.nameEn;assert(name,"Missing "+id);
  await p.click(".mobile-panel-tabs button:nth-child(1)");
  const cards=await p.$$(".discovery-card");let found=false;
  for(const card of cards) { if((await card.$eval(".restaurant-card-name",el=>el.textContent.trim()))===name) {await card.click();found=true;break;} }
  assert(found,"No card for "+name);
  await p.waitForFunction(()=>document.querySelector(".mobile-panel-tabs button:nth-child(3)").classList.contains("active"),{timeout:12000});
  await p.click(".mobile-panel-tabs button:nth-child(2)");
  await p.waitForFunction(k=>document.querySelector(".naver-map-status")==null&&!!document.querySelector(".naver-map-marker.category-"+k+".selected"),{timeout:30000},kind);
  const visual=await p.evaluate(()=>{const el=document.querySelector(".naver-map-marker.selected");return {kind:el.dataset.markerKind,color:getComputedStyle(el).backgroundColor,svg:el.querySelectorAll("svg").length,markerWidth:Math.round(el.getBoundingClientRect().width),legend:document.querySelector(".map-meat-legend")?.textContent?.replace(/\s+/g," ").trim(),screenOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}});
  assert.deepEqual([visual.kind,visual.color,visual.svg],[kind,color,svgCount]);
  assert(visual.markerWidth>=42&&visual.screenOverflow<=1);
  const img=dir+"/mobile-"+kind+".png";
  await p.screenshot({path:img});
  const {data:raw,info}=await sharp(img).extract({left:70,top:240,width:230,height:250}).raw().toBuffer({resolveWithObject:true});
  const shades=new Set();for(let j=0;j<raw.length;j+=info.channels*13)shades.add(((raw[j]>>4)<<8)|((raw[j+1]>>4)<<4)|(raw[j+2]>>4));
  const pin=await p.$(".naver-map-marker.category-"+kind+".selected");
  const bounds=await pin.boundingBox();console.log("SCREENSHOT_CHECK",kind,{mapColorBins:shades.size,bounds,state:await state(p)});
  const bands=[];
  for(const region of [{left:85,top:190,width:200,height:150},{left:85,top:420,width:200,height:180},{left:85,top:655,width:200,height:100}]){
   const {data,info}=await sharp(img).extract(region).raw().toBuffer({resolveWithObject:true});
   const colors=new Set();for(let j=0;j<data.length;j+=info.channels*13)colors.add(((data[j]>>4)<<8)|((data[j+1]>>4)<<4)|(data[j+2]>>4));bands.push(colors.size);
  }
  console.log("MAP_TILE_BANDS",kind,bands);
  assert(bands.every(n=>n>=13),"Some NAVER map tile rows are missing in mobile screenshot: "+kind+" "+bands);
  await pin.click();
  await p.waitForFunction(()=>document.querySelector(".mobile-panel-tabs button:nth-child(3)").classList.contains("active"),{timeout:12000});
  qa.push({width:390,userClicks:["Places card","Map tab","Map marker","Menu tab auto-selected"],kind,visual});
 }
 await p.click(".mobile-panel-tabs button:nth-child(2)");
 await p.click(".public-language-toggle button:nth-child(2)");
 await p.waitForFunction(()=>document.querySelector(".map-meat-legend")?.textContent?.includes("豚肉・牛肉"),{timeout:20000});
 await p.screenshot({path:dir+"/mobile-japanese.png"});
 qa.push({width:390,japaneseMapTab:await p.$eval(".mobile-panel-tabs button:nth-child(2)",e=>e.textContent.trim()),overflow:(await state(p)).overflow});
 await p.close();
 for(const width of [320,768]){
  const q=await open(width,844);
  assert.equal((await state(q)).tabs.length,3);
  await q.click(".mobile-panel-tabs button:nth-child(2)");
  await q.waitForFunction(()=>document.querySelector(".naver-map-status")==null&&document.querySelectorAll(".naver-map-marker").length>0,{timeout:30000});
  const v=await state(q);assert(v.mapWidth>=width-2&&v.mapHeight>=500&&v.overflow<=1,JSON.stringify(v));
  const header=await q.$eval(".discovery-brand > span:last-child",e=>({visible:e.clientWidth,needed:e.scrollWidth}));
  if(width===320)assert(header.needed<=header.visible+1,"Brand clipped in narrow header: "+JSON.stringify(header));
  await q.screenshot({path:dir+"/mobile-"+width+".png"});qa.push({width,...v});await q.close();
 }
 const detail=await browser.newPage();await detail.setViewport({width:390,height:844});
 detail.on("pageerror",e=>errors.push("detail: "+e.message));
 await detail.goto(url+"/place/naver%3A2056833208",{waitUntil:"domcontentloaded",timeout:60000});
 await detail.waitForSelector(".detail-mini-map",{timeout:30000});
 await detail.waitForFunction(()=>!!document.querySelector(".detail-mini-map .naver-map-marker"),{timeout:30000});
 const detailMap=await detail.$eval(".detail-mini-map",e=>({display:getComputedStyle(e).display,height:Math.round(e.getBoundingClientRect().height)}));
 assert(detailMap.display!=="none"&&detailMap.height>=200);
 await detail.$eval(".detail-mini-map",e=>e.scrollIntoView({block:"center"}));
 await detail.screenshot({path:dir+"/mobile-standalone-detail.png"});qa.push({standaloneDetail:detailMap});await detail.close();
 const desktop=await open(1440,900);
 await desktop.evaluate(()=>[...document.querySelectorAll(".filter-scroll button")].find(e=>e.textContent.trim()==="Hongdae").click());
 await desktop.waitForFunction(()=>document.querySelectorAll(".discovery-card").length===40&&document.querySelectorAll(".naver-map-marker").length===40,{timeout:30000});
 const desktopV=await state(desktop);assert(desktopV.mapWidth>200&&desktopV.markers===40);
 await desktop.screenshot({path:dir+"/desktop-after.png"});qa.push({width:1440,...desktopV});await desktop.close();
 assert.equal(errors.length,0,JSON.stringify(errors));
 fs.writeFileSync(dir+"/mobile-map-qa.json",JSON.stringify({url,qa,errors,checkedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({PASS:true,url,qa,errors},null,2));
}finally {await browser.close();}
