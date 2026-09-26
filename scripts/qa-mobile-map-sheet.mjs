import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";
const base = process.argv[2] || "http://localhost:3022";
const proxyBase = process.argv[3] || "";
const requireMap = Boolean(proxyBase) || base.startsWith("https://");
const output = ".expansion-runs/mobile-compact-qa";
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe", headless: true, args: ["--no-sandbox"] });
const records = [], errors = [];
const delay = (n = 350) => new Promise((resolve) => setTimeout(resolve,n));
async function checkPage(width,height) {
  const page=await browser.newPage();
  await page.setViewport({width,height,deviceScaleFactor:1,isMobile:width<900,hasTouch:width<900});
  page.on("pageerror",e=>{errors.push(width+": "+e.message);console.log("PAGE_ERROR",e.stack||e.message);});
  page.on("console",m=>{if(m.type()==="error")console.log("BROWSER_CONSOLE",m.text());});
  page.on("response",r=>{if(requireMap&&r.status()>=400&&/oapi\.map\.naver\.com/.test(r.url()))errors.push(width+": NAVER HTTP "+r.status());});
  if(proxyBase){
    await page.setRequestInterception(true);
    page.on("request",async req=>{
      if(!req.url().startsWith(base+"/")){await req.continue().catch(()=>{});return;}
      try{
        const headers={...req.headers()};for(const k of ["host","origin","referer","content-length","accept-encoding"])delete headers[k];
        const response=await fetch(proxyBase+req.url().slice(base.length),{method:req.method(),headers,body:["GET","HEAD"].includes(req.method())?undefined:req.postData(),redirect:"follow"});
        const out={};for(const [k,v] of response.headers)if(!["content-encoding","content-length","transfer-encoding","connection","strict-transport-security"].includes(k))out[k]=v;
        await req.respond({status:response.status,headers:out,body:Buffer.from(await response.arrayBuffer())});
      }catch(e){errors.push("proxy: "+String(e));await req.abort().catch(()=>{});}
    });
  }
  await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForSelector(".discovery-card",{timeout:45000});
  await page.waitForFunction(()=>Object.keys(document.querySelector(".discovery-card")||{}).some(k=>k.startsWith("__reactProps$")),{timeout:20000});
  if(width<900) await page.waitForSelector(".mobile-map-home",{timeout:10000});
  const measure=()=>page.evaluate(()=>{const rect=(s)=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,map:rect(".discovery-map-panel"),innerMap:rect(".discovery-map"),list:rect(".discovery-list-panel"),cardCount:document.querySelectorAll(".discovery-list .discovery-card").length,full:document.querySelector(".discovery-page").classList.contains("mobile-full-map"),region:[...document.querySelectorAll(".mobile-map-chip-row:not(.mobile-map-food-row) button")].find(x=>x.classList.contains("active"))?.textContent,naverStatus:document.querySelector(".naver-map-status")?.textContent?.trim()||null};});
  let initial=await measure();
  if(requireMap){
    await page.waitForFunction(()=>document.querySelectorAll(".naver-map-marker,.naver-map-cluster").length>0 && !document.querySelector(".naver-map-status") && [...document.querySelectorAll(".discovery-map img")].filter(i=>i.complete&&i.naturalWidth>=128).length>=4,{timeout:30000});
  }
  assert(initial.overflow<=1,"horizontal overflow "+JSON.stringify(initial));
  if(width===1440){assert(!(await page.$eval(".discovery-page",e=>e.classList.contains("mobile-map-home"))));assert(initial.cardCount>20);await page.screenshot({path:output+"/1440-desktop.png"});records.push({stage:"desktop",...initial});await page.close();return;}
  assert(initial.map.height/height>=0.28&&initial.map.height/height<=0.38,"map height "+JSON.stringify(initial));
  assert(initial.cardCount>0,"restaurant list hidden");
  assert(initial.region?.includes("Seongsu")||initial.region?.includes("聖水"),"initial region not seongsu "+initial.region);
  if(requireMap) await page.evaluate(()=>{window.__qaMapElement=document.querySelector(".discovery-map");});
  await page.screenshot({path:output+"/"+width+"-initial.png"});
  const firstCard=await page.$eval(".discovery-list .discovery-card",e=>e.textContent.trim());
  await page.click(".discovery-list .discovery-card");
  await page.waitForSelector(".mobile-details-open .restaurant-detail-scroll",{timeout:8000});
  assert((await page.$eval(".restaurant-detail-panel h1",e=>e.textContent.trim())).length>0);
  await page.screenshot({path:output+"/"+width+"-detail.png"});
  await page.click(".mobile-detail-back");
  await page.waitForFunction(()=>!document.querySelector(".discovery-page").classList.contains("mobile-details-open"));
  if(width===390){
    const more=await page.$(".mobile-load-more");if(more){await more.click();assert.equal((await page.$$(".discovery-list .discovery-card")).length,48);await page.$eval(".discovery-list",el=>{el.scrollTop=600});assert((await page.$eval(".discovery-list",el=>el.scrollTop))>0);await page.screenshot({path:output+"/390-scroll.png"});}
  }
  await page.click(".mobile-list-categories button:nth-child(2)");
  await page.waitForFunction(()=>document.querySelector(".mobile-list-categories button:nth-child(2)").classList.contains("active"));
  const filterCount=await page.$$eval(".discovery-list .discovery-card",e=>e.length);
  await page.click(".mobile-list-categories button:first-child");
  await page.click(".mobile-map-chip-row:not(.mobile-map-food-row) button:nth-child(3)");
  await page.waitForFunction(()=>document.querySelector(".mobile-map-chip-row:not(.mobile-map-food-row) button:nth-child(3)").classList.contains("active"));
  const hongdae=await measure();assert(hongdae.cardCount>0,"Hongdae empty");
  if(requireMap)assert(await page.evaluate(()=>window.__qaMapElement===document.querySelector(".discovery-map")),"region switch remounted map DOM");
  await page.click(".mobile-map-chip-row:not(.mobile-map-food-row) button:nth-child(2)");
  await page.click(".mobile-map-expand");
  await page.waitForFunction(()=>document.querySelector(".discovery-page").classList.contains("mobile-full-map"));
  let expanded=await measure();await page.waitForFunction(()=>document.querySelector(".discovery-map")?.getBoundingClientRect().height/innerHeight>.7,{timeout:7000});
  if(requireMap)assert(await page.evaluate(()=>window.__qaMapElement===document.querySelector(".discovery-map")),"full map remounted map DOM");expanded=await measure();assert(expanded.map.height/height>.7&&expanded.innerMap.height/height>.7,"full map tiles too small");
  await page.screenshot({path:output+"/"+width+"-full-map.png"});
  if(proxyBase&&width===390){
    const position=await page.evaluate(()=>{const map=document.querySelector(".discovery-map-panel")?.getBoundingClientRect();return [...document.querySelectorAll(".naver-map-marker")].map(e=>e.getBoundingClientRect()).filter(r=>r.width>10&&r.top>map.top+100&&r.bottom<map.bottom-70&&r.left>15&&r.right<innerWidth-15).map(r=>({x:r.left+r.width/2,y:r.top+r.height/2}))[0]||null;});
    if(position){console.log("MARKER_TAP",JSON.stringify({...position,element:await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML.slice(0,250),position)}));await page.touchscreen.tap(position.x,position.y);await delay(700);console.log("AFTER_MARKER_TAP",JSON.stringify(await page.evaluate(()=>({cls:document.querySelector(".discovery-page")?.className,preview:!!document.querySelector(".mobile-map-selection"),selected:document.querySelectorAll(".naver-map-marker.selected").length}))));await page.screenshot({path:output+"/390-marker-tap-diag.png"});await page.waitForSelector(".mobile-map-selection",{visible:true,timeout:4000});assert((await page.$$(".mobile-map-selection a[href]")).length>=1);await page.screenshot({path:output+"/390-marker-selected.png"});await page.click(".mobile-map-selection button");await page.waitForSelector(".mobile-details-open .restaurant-detail-scroll");await page.click(".mobile-detail-back");}
    else throw new Error("No tappable marker in full-map viewport");
  }
  if(await page.$eval(".discovery-page",e=>e.classList.contains("mobile-full-map"))){
    await page.click(".mobile-map-expand");
    await page.waitForFunction(()=>!document.querySelector(".discovery-page").classList.contains("mobile-full-map"));
  }
  await page.waitForFunction(()=>document.querySelector(".discovery-map")?.getBoundingClientRect().height/innerHeight<.4,{timeout:7000});
  await page.click(".public-language-toggle button:last-child");
  await page.waitForFunction(()=>document.querySelector(".public-language-toggle button:last-child").classList.contains("active"));
  await page.screenshot({path:output+"/"+width+"-japanese.png"});
  await page.type(".mobile-map-search input","sushi");
  await delay(250);
  const searched=await measure();
  await page.click(".mobile-map-search input",{clickCount:3});
  await page.keyboard.press("Backspace");
  await delay(250);
  let mapDiag=await page.evaluate(()=>({status:document.querySelector(".naver-map-status")?.textContent?.trim()||null,markers:document.querySelectorAll(".naver-map-marker").length,clusters:document.querySelectorAll(".naver-map-cluster").length,tiles:[...document.querySelectorAll(".discovery-map img")].filter(x=>x.complete&&x.naturalWidth>=128).length}));
  records.push({stage:"mobile",width,initial,filterCount,hongdaeCount:hongdae.cardCount,fullHeight:expanded.map.height,firstCard:firstCard.slice(0,60),searched:searched.cardCount,mapDiag});
  await page.close();
}
try{for(const [w,h] of [[360,780],[390,844],[768,900],[1440,900]].filter(([w])=>!process.env.QA_WIDTHS||process.env.QA_WIDTHS.split(",").includes(String(w)))) await checkPage(w,h);assert.equal(errors.length,0,JSON.stringify(errors));console.log(JSON.stringify({PASS:true,base,records,errors},null,2));}finally{await browser.close();}
