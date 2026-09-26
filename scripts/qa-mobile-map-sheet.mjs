import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";
const base=process.argv[2]||"http://localhost:3022";const requireMap=/^https:\/\//.test(base);const output=".expansion-runs/mobile-sheet-qa";
fs.mkdirSync(output,{recursive:true});const b=await puppeteer.launch({executablePath:"C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",headless:true});
const errors=[],records=[];
const page=await b.newPage();await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});page.on("pageerror",e=>errors.push(e.message));
await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});await page.waitForSelector(".mobile-map-home .mobile-map-tools",{timeout:30000});
await page.waitForFunction(()=>Object.keys(document.querySelector(".mobile-sheet-grip")||{}).some(k=>k.startsWith("__reactProps$")),{timeout:20000});
if(requireMap){
  try {
    await page.waitForFunction(()=>document.querySelectorAll(".naver-map-marker, .naver-map-cluster").length>0&&!document.querySelector(".naver-map-status"),{timeout:19000});
  } catch {
    const mapDiag=await page.evaluate(()=>({
      status:document.querySelector(".naver-map-status")?.textContent?.trim()||"ready",
      markers:document.querySelectorAll(".naver-map-marker").length,
      clusters:document.querySelectorAll(".naver-map-cluster").length,
      sdk:!!window.naver?.maps,
      images:document.querySelectorAll(".discovery-map img").length,
      className:document.querySelector(".discovery-page")?.className,
    }));
    console.log("MAP_LOADING_DIAGNOSTIC",JSON.stringify(mapDiag));
    await page.screenshot({path:output+"/production-map-wait.png"});
    const retry=await page.$(".naver-map-error-actions button");
    if(retry) await retry.click();
    await page.waitForFunction(()=>document.querySelectorAll(".naver-map-marker, .naver-map-cluster").length>0&&!document.querySelector(".naver-map-status"),{timeout:30000});
  }
  await page.waitForFunction(()=>[...document.querySelectorAll(".discovery-map img")].filter(x=>x.complete&&x.naturalWidth>=128).length>=4,{timeout:25000});
  records.push({stage:"production-live-map",markers:await page.evaluate(()=>document.querySelectorAll(".naver-map-marker, .naver-map-cluster").length),loadedTiles:await page.evaluate(()=>[...document.querySelectorAll(".discovery-map img")].filter(x=>x.complete&&x.naturalWidth>=128).length)});
}
const stats=()=>page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,mode:document.querySelector(".discovery-page").className,mapDisplay:getComputedStyle(document.querySelector(".discovery-map-panel")).display,mapRect:document.querySelector(".discovery-map-panel").getBoundingClientRect().toJSON(),sheetRect:document.querySelector(".discovery-list-panel").getBoundingClientRect().toJSON(),searchDisplay:getComputedStyle(document.querySelector(".mobile-map-tools")).display,tabDisplay:getComputedStyle(document.querySelector(".mobile-panel-tabs")||document.querySelector(".mobile-map-tools")).display}));
let a=await stats();assert.equal(a.width,390);assert(a.mapRect.height>=700&&a.sheetRect.height>=200&&a.searchDisplay==="flex"&&a.overflow<=1);records.push({stage:"initial",...a});await page.screenshot({path:output+"/local-initial.png"});
await page.click(".mobile-sheet-toggle");await page.waitForFunction(()=>document.querySelector(".discovery-page").classList.contains("mobile-sheet-expanded"));assert((await page.$$(".discovery-list .discovery-card")).length>40);records.push({stage:"expand",...await stats()});await page.screenshot({path:output+"/local-expanded.png"});
await page.click(".mobile-sheet-toggle");await page.waitForFunction(()=>document.querySelector(".discovery-page").classList.contains("mobile-sheet-peek"));await page.click(".mobile-recommendation-tile");await page.waitForSelector(".mobile-selected-preview");assert((await page.$eval(".mobile-selected-preview .mobile-detail-cta",e=>e.textContent)).includes("Menus"));records.push({stage:"marker-preview",...await stats()});await page.screenshot({path:output+"/local-selected.png"});
if(requireMap){
  await page.waitForFunction(()=>{
    const el=document.querySelector(".naver-map-marker.selected");
    const r=el?.getBoundingClientRect();
    return !!r && r.width>=34 && r.top>=200 && r.top<570;
  },{timeout:30000});
  await new Promise(resolve=>setTimeout(resolve,450));
  await page.click(".mobile-selected-list-back");
  await page.waitForFunction(()=>document.querySelector(".discovery-page").classList.contains("mobile-sheet-expanded"));
  await page.click(".mobile-sheet-toggle");
  await page.waitForFunction(()=>document.querySelector(".discovery-page").classList.contains("mobile-sheet-peek"));
  await new Promise(resolve=>setTimeout(resolve,450));
  console.log("SELECTED_MARKER_LAYOUT",JSON.stringify(await page.evaluate(()=>{
    const el=document.querySelector(".naver-map-marker.selected");
    const r=el?.getBoundingClientRect();const sh=document.querySelector(".discovery-list-panel")?.getBoundingClientRect();
    return {marker:r?.toJSON(),sheet:sh?.toJSON(),status:document.querySelector(".naver-map-status")?.textContent};
  })));
  await page.screenshot({path:output+"/production-before-marker-tap.png"});
  await page.click(".naver-map-marker.selected");
  await page.waitForSelector(".mobile-selected-preview",{timeout:15000});
  records.push({stage:"live-marker-click",selected:await page.$eval(".mobile-selected-preview strong",e=>e.textContent.trim())});
}
await page.click(".mobile-detail-cta");await page.waitForSelector(".mobile-details-open .restaurant-detail-panel .restaurant-detail-scroll");await page.screenshot({path:output+"/local-detail.png"});await page.click(".mobile-detail-back");await page.waitForFunction(()=>!document.querySelector(".discovery-page").classList.contains("mobile-details-open"));
await page.click(".public-language-toggle button:last-child");await page.waitForFunction(()=>document.querySelector(".mobile-sheet-toggle")?.textContent?.includes("一覧"));records.push({stage:"japanese",...await stats()});await page.screenshot({path:output+"/local-japanese.png"});
const medium=await b.newPage();await medium.setViewport({width:768,height:900});medium.on("pageerror",e=>errors.push("medium "+e.message));await medium.goto(base,{waitUntil:"domcontentloaded"});await medium.waitForSelector(".mobile-map-home");const mediumOverflow=await medium.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(mediumOverflow<=1);await medium.screenshot({path:output+"/local-768.png"});await medium.close();
const desktop=await b.newPage();await desktop.setViewport({width:1440,height:900});desktop.on("pageerror",e=>errors.push("desktop "+e.message));await desktop.goto(base,{waitUntil:"domcontentloaded"});await desktop.waitForSelector(".discovery-card");const ds=await desktop.evaluate(()=>({mobileMode:document.querySelector(".discovery-page").classList.contains("mobile-map-home"),desktopMap:getComputedStyle(document.querySelector(".discovery-map-panel")).display,desktopList:getComputedStyle(document.querySelector(".discovery-list-panel")).display,columns:getComputedStyle(document.querySelector(".discovery-workspace")).gridTemplateColumns,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));assert(!ds.mobileMode&&ds.desktopList!=="none"&&ds.overflow<=1);records.push({stage:"desktop",...ds});await desktop.screenshot({path:output+"/local-desktop.png"});await desktop.close();
assert.equal(errors.length,0,JSON.stringify(errors));console.log(JSON.stringify({PASS:true,base,records,errors},null,2));await b.close();