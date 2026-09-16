import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const targets = [
  ['1870682567','클래식 해례커피 성수본점'],
  ['2004674248','ETF베이커리 성수'],
  ['1178938443','파케파케 성수'],
  ['1451521480','카페씨떼 성수'],
  ['1085945481','브루크 성수'],
  ['2019126383','성수르치아바타'],
  ['1553249208','에어드랍 커피 성수'],
  ['2058698022','유키모찌 성수점'],
  ['2033165481','피제리아앤 성수'],
];
const browser = await puppeteer.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,defaultViewport:{width:1280,height:1000}});
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({'accept-language':'ko-KR,ko;q=0.9,en;q=0.7'});
const stores=[];
for (const [placeId,expectedName] of targets) {
  const url=`https://pcmap.place.naver.com/restaurant/${placeId}/menu/list?from=map&locale=ko`;
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,1800));
  const data=await page.evaluate(()=>({
    title:document.title,
    text:(document.body?.innerText||'').slice(0,12000),
    apollo:globalThis.__APOLLO_STATE__||{},
    links:[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(Boolean).slice(0,800),
  }));
  const a=data.apollo||{};
  const base=a[`PlaceDetailBase:${placeId}`]||Object.values(a).find(v=>v?.__typename==='PlaceDetailBase'&&String(v.id)===placeId)||{};
  const menus=Object.entries(a).filter(([k,v])=>k.startsWith(`Menu:${placeId}_`)&&v?.__typename==='Menu').map(([k,v])=>({
    naverKey:k,naverMenuId:String(v.id||k.split(':')[1]),index:Number(v.index??9999),nameKo:String(v.name||'').trim(),price:Number(v.price||0),descriptionKo:String(v.description||'').trim(),isSpecialty:Boolean(v.recommend),images:Array.isArray(v.images)?v.images.filter(Boolean):[]
  })).sort((x,y)=>x.index-y.index).map(m=>({...m,menuId:`naver:${m.naverMenuId}`,imageUrl:m.images[0]||'',imageStatus:m.images.length?'verified':'not_available',imageSource:'naver_place_menu',imageSourceUrl:`https://map.naver.com/p/entry/place/${placeId}?placePath=/menu`,imageAttribution:`Naver Place · ${base.name||expectedName}`}));
  const photos=Object.values(a).filter(v=>v?.__typename==='PlaceDetailTopPhotoItem'&&v.mediaFormat==='image'&&v.originalUrl).map(v=>({url:v.originalUrl,mediaSource:v.mediaSource,filterId:v.filterId,subFilterId:v.subFilterId,title:v.title||''}));
  const businessPhotos=photos.filter(x=>x.mediaSource==='business');
  const allPhotos=[...businessPhotos,...photos.filter(x=>x.mediaSource!=='business')];
  const instagram=data.links.find(x=>/instagram\.com/i.test(x))||'';
  const homepage=data.links.find(x=>!/(naver\.com|pstatic\.net|instagram\.com)/i.test(x)&&/^https?:/i.test(x))||'';
  const statusText=(data.text.split('\n').find(x=>/(영업|휴무|폐업|운영)/.test(x))||'').trim();
  stores.push({placeId,expectedName,name:base.name||expectedName,category:base.category||'',roadAddress:base.roadAddress||'',address:base.address||'',latitude:Number(base.coordinate?.y||0)||null,longitude:Number(base.coordinate?.x||0)||null,phone:base.virtualPhone||base.phone||'',statusText,currentlyListed:Boolean(base.id)&&!/폐업/.test(data.text),naverUrl:`https://map.naver.com/p/entry/place/${placeId}`,instagramUrl:instagram,homepageUrl:homepage,representativeImage:allPhotos[0]?.url||'',gallery:allPhotos.slice(0,8).map(x=>x.url),photoMeta:allPhotos.slice(0,8),menuCount:menus.length,verifiedImageCount:menus.filter(x=>x.imageStatus==='verified').length,notAvailableCount:menus.filter(x=>x.imageStatus==='not_available').length,needsReviewCount:0,menus});
  console.log(placeId,base.name||expectedName,'menus',menus.length,'verified',menus.filter(x=>x.imageStatus==='verified').length);
}
await browser.close();
fs.writeFileSync('seongsu-trackb.json',JSON.stringify({collectedAt:new Date().toISOString(),stores},null,2),'utf8');
console.log('DONE',stores.length,stores.reduce((n,s)=>n+s.menuCount,0));
