import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";
const base=(process.argv[2]||"http://localhost:3001").replace(/\/$/,"");
const proxy=(process.argv[3]||"").replace(/\/$/,"");
const dir=".expansion-runs/qa-20260927-map";fs.mkdirSync(dir,{recursive:true});
const manifest=(name)=>JSON.parse(fs.readFileSync(name,"utf8"));
// The release manifest is versioned so this QA works on a fresh checkout.
const release=manifest("data/expansion-2026-09-27.json");
const hongdae={restaurants:release.hongdae};
const itaewon={restaurants:release.itaewon};
const errors=[],records=[];
const browser=await puppeteer.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true,args:["--no-sandbox"]});
const sleep=n=>new Promise(ok=>setTimeout(ok,n));
async function apiCheck(){
 const page=await browser.newPage();const all=[],seen=new Set();
 for(let offset=0,n=0;n<10;n++){
  const url=base+"/api/discovery?perRegion=150&offset="+offset;
  const res=proxy?await fetch(proxy+"/api/discovery?perRegion=150&offset="+offset):await fetch(url);
  assert.equal(res.status,200,"API status "+res.status);
  const body=await res.json();for(const s of body.stores){assert(!seen.has(s.id),"duplicate "+s.id);seen.add(s.id);all.push(s);}
  if(body.nextOffset==null)break;assert(body.nextOffset>offset);offset=body.nextOffset;
 }
 const count=r=>all.filter(s=>s.regionKey===r).length;
 assert.equal(count("hongdae"),60);assert.equal(count("itaewon"),40);assert.equal(count("seongsu"),110);
 for(const [region,entry] of [["hongdae",hongdae],["itaewon",itaewon]]){
  for(const row of entry.restaurants){
   const store=all.find(s=>s.id===row.id);assert(store,"missing "+row.name);
   assert.equal(store.regionKey,region);assert(store.menus.length>0, "menus "+row.name);
   for(const c of ["nameEn","nameJa","roadAddressEn","roadAddressJa","introductionEn","introductionJa","imageUrl"])assert(store[c],"missing "+c+" "+row.name);
   for(const m of store.menus){assert(m.nameEn&&m.nameJa&&m.descriptionEn&&m.descriptionJa,"menu translations "+row.name);assert(!/[가-힣]/.test([m.nameEn,m.nameJa,m.descriptionEn,m.descriptionJa].join(" ")));}
  }
 }
 await page.close();return {total:all.length,seongsu:count("seongsu"),hongdae:count("hongdae"),itaewon:count("itaewon")};
}
async function newPage(width,height){
 const p=await browser.newPage();await p.setViewport({width,height,isMobile:width<900,hasTouch:width<900,deviceScaleFactor:1});
 p.on("pageerror",e=>errors.push(width+" "+e.message));
 if(proxy){
  await p.setRequestInterception(true);
  p.on("request",async req=>{
   if(!req.url().startsWith(base+"/"))return req.continue().catch(()=>{});
   try{const headers={...req.headers()};for(const key of ["host","origin","referer","content-length","accept-encoding"])delete headers[key];
    const response=await fetch(proxy+req.url().slice(base.length),{method:req.method(),headers,body:["GET","HEAD"].includes(req.method())?undefined:req.postData(),redirect:"follow"});
    const h={};for(const [k,v] of response.headers)if(!["content-length","content-encoding","connection","transfer-encoding","strict-transport-security"].includes(k))h[k]=v;
    await req.respond({status:response.status,headers:h,body:Buffer.from(await response.arrayBuffer())});
   }catch(e){errors.push(width+" proxy "+String(e));await req.abort().catch(()=>{});}
  });
 }
 await p.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
 await p.waitForSelector(".discovery-card",{timeout:45000});
 await p.waitForFunction(()=>document.querySelectorAll(".naver-map-marker,.naver-map-cluster").length>0&&!document.querySelector(".naver-map-status")&&[...document.querySelectorAll(".discovery-map img")].filter(i=>i.complete&&i.naturalWidth>=128).length>=4,{timeout:35000});
 assert.equal(await p.$(".map-meat-legend"),null,"unrequested map legend remains");
 return p;
}
async function uiCheck(width,height){
 const p=await newPage(width,height);const mobile=width<900;
 const selector=mobile?".mobile-map-chip-row:not(.mobile-map-food-row)":".filter-block:first-of-type .filter-scroll";
 assert(await p.$eval(".discovery-page",el=>!!el));
 const labels=await p.$$eval(selector+" button",list=>list.map(x=>x.textContent.trim()));
 assert(labels.some(v=>v==="Itaewon"),"Itaewon region button missing "+JSON.stringify(labels));
 await p.screenshot({path:dir+"/"+width+"-initial.png"});
 await p.$$eval(selector+" button",list=>list.find(x=>x.textContent.trim()==="Itaewon")?.click());
 await p.waitForFunction(()=>document.querySelector(".discovery-card")?.textContent?.includes("Itaewon")&&[...document.querySelectorAll(".naver-map-marker")].length>0,{timeout:15000});
 const region=await p.evaluate(()=>({storeCount:document.querySelectorAll(".discovery-list .discovery-card").length,mapPins:document.querySelectorAll(".naver-map-marker").length,clusters:document.querySelectorAll(".naver-map-cluster").length,horizontalOverflow:document.documentElement.scrollWidth-innerWidth}));
 assert(region.storeCount>=20);assert(region.mapPins>=4);assert(region.horizontalOverflow<=1);
 await p.screenshot({path:dir+"/"+width+"-itaewon.png"});
 if(mobile){
  await p.click(".mobile-map-expand");
  await p.waitForFunction(()=>document.querySelector(".discovery-map").getBoundingClientRect().height>innerHeight*.7,{timeout:10000});
  const pin=await p.evaluate(()=>{const bounds=document.querySelector(".discovery-map-panel").getBoundingClientRect();return [...document.querySelectorAll(".naver-map-marker")].map(el=>el.getBoundingClientRect()).filter(r=>r.width>10&&r.top>bounds.top+120&&r.bottom<bounds.bottom-65&&r.left>15&&r.right<innerWidth-15).map(r=>({x:r.left+r.width/2,y:r.top+r.height/2}))[0]||null});
  assert(pin,"no tappable Itaewon marker");await p.touchscreen.tap(pin.x,pin.y);
  await p.waitForSelector(".mobile-map-selection",{visible:true,timeout:8000});
  assert.equal((await p.$$(".mobile-map-selection a[href]")).length,1,"missing booking link");
  await p.screenshot({path:dir+"/"+width+"-marker.png"});
  await p.click(".mobile-map-selection button");await p.waitForSelector(".mobile-details-open .restaurant-detail-scroll",{timeout:10000});
  await p.screenshot({path:dir+"/"+width+"-detail.png"});
  await p.click(".mobile-detail-back");
 }
 await p.click(".public-language-toggle button:last-child");
 await p.waitForFunction(()=>document.querySelector(".public-language-toggle button:last-child").classList.contains("active"));
 assert((await p.$eval(selector,el=>el.textContent)).includes("梨泰院"),"Japanese Itaewon label missing");
 await p.screenshot({path:dir+"/"+width+"-ja.png"});await p.close();
 records.push({width,...region,japanese:true,legendGone:true});
}
try{const api=await apiCheck();for(const [w,h] of [[360,780],[390,844],[768,900],[1440,900]])await uiCheck(w,h);assert.equal(errors.length,0,JSON.stringify(errors));console.log(JSON.stringify({PASS:true,api,records,errors},null,2));}
finally{await browser.close();}
