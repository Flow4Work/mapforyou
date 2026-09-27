import fs from "node:fs";
import path from "node:path";
const source = path.resolve(process.argv[2] || ".expansion-runs/itaewon-2026-09-27T09-24-58-679Z");
const out = path.resolve(process.argv[3] || ".expansion-runs/itaewon-2026-09-27-curated");
fs.mkdirSync(out,{recursive:true});
const read=n=>JSON.parse(fs.readFileSync(path.join(source,n+".json"),"utf8"));
const prior=read("prepared"), selected=read("selection"), candidates=read("candidates");
const excluded=new Map([
  ["2003072259","Wine-only category, not food-first"],["1866252940","Wine-only category"],
  ["1558342042","Wine-only bar"],["1680587920","Wine-only category with 1 verified image of 33"],
  ["2099319594","Sookdae Entrance branch, outside Itaewon neighborhood"],
]);
const additions=["2087200005","2074018578","1159837999","2046361140","2019503089"];
const retained=selected.filter(s=>!excluded.has(s.placeId));
const extra=additions.map(id=>{const s=candidates.find(x=>x.placeId===id);if(!s?.valid||s.kind!=="restaurant"||/와인|바\(BAR\)|주점/.test(s.name+" "+s.category))throw Error("Invalid replacement "+id);return s;});
const final=[...retained,...extra];
if(final.length!==40||new Set(final.map(s=>s.placeId)).size!==40)throw Error("Final selection not 40 unique restaurants");
const keptIds=new Set(retained.map(s=>"naver:"+s.placeId));
const payload={preparedAt:new Date().toISOString(),restaurants:prior.restaurants.filter(s=>keptIds.has(s.source_id)),menus:prior.menus.filter(m=>keptIds.has(m.restaurant_id))};
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
async function translate(text,lang){
 const url="https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl="+lang+"&dt=t&q="+encodeURIComponent(text);
 for(let i=0;i<4;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error("Translation HTTP "+r.status);const data=await r.json();const value=clean((data[0]||[]).map(x=>x?.[0]||"").join(""));if(value)return value;}catch(e){if(i===3)throw e;await new Promise(ok=>setTimeout(ok,200*(i+1)));}}
 return text;
}
const englishNames=new Map([["키마이","Kimai"],["성수오뎅 이태원점","Seongsu Odeng Itaewon Branch"],["미드나잇포레스트","Midnight Forest"],["타말레","Tamale"],["석석 양꼬치","Seokseok Lamb Skewers"]]);
const japaneseNames=new Map([["키마이","キマイ"],["성수오뎅 이태원점","ソンスオデン 梨泰院店"],["미드나잇포레스트","ミッドナイトフォレスト"],["타말레","タマレ"],["석석 양꼬치","ソクソク羊肉串"]]);
const cached=new Map();
async function t(value,lang){
 const key=lang+"|"+clean(value);if(cached.has(key))return cached.get(key);
 const result=await translate(clean(value),lang);cached.set(key,result);return result;
}
const now=new Date().toISOString();
for(const s of extra){
 const id="naver:"+s.placeId, intro=clean(s.introduction)||s.name+"의 메뉴와 매장 정보를 확인해 보세요.";
 const [nameEn,nameJa,roadEn,roadJa,introEn,introJa]=await Promise.all([
  englishNames.get(s.name)||t(s.name,"en"),japaneseNames.get(s.name)||t(s.name,"ja"),t(s.roadAddress,"en"),t(s.roadAddress,"ja"),t(intro,"en"),t(intro,"ja")
 ]);
 payload.restaurants.push({source_id:id,source_name:"naver_place",name:s.name,name_en:nameEn,name_ja:nameJa,
  road_address:s.roadAddress,road_address_en:roadEn,road_address_ja:roadJa,address:s.address||s.roadAddress,
  latitude:s.latitude,longitude:s.longitude,phone:s.phone||null,category:s.category,introduction:intro,introduction_en:introEn,introduction_ja:introJa,
  image_url:s.representativeImage,image_gallery_urls:s.gallery,image_source:"naver_place",image_attribution:"Naver Place | "+s.name,image_source_url:s.naverUrl,
  image_checked_at:now,region_key:"itaewon",search_keyword:"itaewon_expansion_restaurant",publish_status:"published",source_checked_at:now,
  naver_place_id:s.placeId,naver_place_url:s.naverUrl,official_website_url:s.homepageUrl||null,naver_place_checked_at:now,
  operating_status:"listed",verification_source:"naver_place",verification_checked_at:now,instagram_url:s.instagramUrl||null,updated_at:now,kind:"restaurant"});
 for(const [index,m] of s.menus.entries()){
  const desc=clean(m.descriptionKo)||m.nameKo+" 메뉴입니다.";
  const [nameEn,nameJa,descriptionEn,descriptionJa]=await Promise.all([t(m.nameKo,"en"),t(m.nameKo,"ja"),t(desc,"en"),t(desc,"ja")]);
  payload.menus.push({menu_id:m.menuId,restaurant_id:id,sort_order:index,name_ko:m.nameKo,name_en:nameEn,name_ja:nameJa,description_ko:desc,description_en:descriptionEn,description_ja:descriptionJa,
    price:Math.max(0,Math.trunc(Number(m.price||0))),is_specialty:!!m.isSpecialty,image_url:m.imageUrl||null,image_source:m.imageSource,
    image_source_url:m.imageSourceUrl,image_attribution:m.imageAttribution,image_checked_at:now,image_status:m.imageStatus,updated_at:now});
 }
 console.log("REPLACED",s.name,"menus",s.menuCount);
}
const repairs=[];
for(const r of payload.restaurants){
 for(const [column,koColumn,lang] of [["name_en","name","en"],["name_ja","name","ja"],["road_address_en","road_address","en"],["road_address_ja","road_address","ja"],["introduction_en","introduction","en"],["introduction_ja","introduction","ja"]]){
  if(/[가-힣]/.test(r[column]||"")){const original=r[column];r[column]=await t(r[koColumn],lang);repairs.push({id:r.source_id,column,original,corrected:r[column]});}
 }
}
for(const m of payload.menus){
 for(const [column,koColumn,lang] of [["name_en","name_ko","en"],["name_ja","name_ko","ja"],["description_en","description_ko","en"],["description_ja","description_ko","ja"]]){
  if(/[가-힣]/.test(m[column]||"")){const original=m[column];m[column]=await t(m[koColumn],lang);repairs.push({id:m.menu_id,column,original,corrected:m[column]});}
 }
}
const overrides=new Map([
 ["naver:2038888511:menu:dom_9|name_en","Assorted Boiled Meat (Small)"],
 ["naver:2038888511:menu:dom_10|name_en","Assorted Boiled Meat (Large)"],
 ["naver:36728206:menu:dom_11|name_ja","セリョートカ・ポド・シュボイ（サラダ）"],
 ["naver:1497299219:menu:dom_2|name_ja","ポルポ・マンボ"],
 ["naver:1588492544:menu:dom_33|description_ja","メロンリキュール「ミドリ」を使った濃いめのハイボール"],
 ["naver:1666730023:menu:dom_2|description_ja","トマトソース、水牛モッツァレラ、ボッコンチーニ、ブッラータの柔らかな調和が特徴のイタリアの人気メニュー"],
 ["naver:2019503089:menu:dom_3|name_ja","クォバロウ"],
 ["naver:2019503089:menu:dom_3|description_ja","クォバロウのメニューです。"],
]);
for(const m of payload.menus)for(const column of ["name_en","name_ja","description_en","description_ja"]){const manual=overrides.get(m.menu_id+"|"+column);if(manual)m[column]=manual;}
const issues=[];const bounds={w:126.975,e:127.011,s:37.525,n:37.546};
if(payload.restaurants.length!==40)issues.push("store count");
if(new Set(payload.restaurants.map(r=>r.source_id)).size!==40)issues.push("duplicate place IDs");
if(new Set(payload.menus.map(m=>m.menu_id)).size!==payload.menus.length)issues.push("duplicate menu IDs");
for(const r of payload.restaurants){
 if(r.latitude<bounds.s||r.latitude>bounds.n||r.longitude<bounds.w||r.longitude>bounds.e)issues.push("out of bounds "+r.name);
 if(/와인|주점|바\(BAR\)/.test(r.category)||r.name.includes("숙대입구"))issues.push("wrong restaurant "+r.name);
 for(const c of ["name_en","name_ja","road_address_en","road_address_ja","introduction_en","introduction_ja"])if(!r[c]||/[가-힣]/.test(r[c]))issues.push("translation "+r.name+" "+c);
 if(!/^https?:/.test(r.image_url)||!r.image_gallery_urls?.length)issues.push("representative image "+r.name);
 if(!payload.menus.some(m=>m.restaurant_id===r.source_id))issues.push("missing menus "+r.name);
}
for(const m of payload.menus){
 for(const c of ["name_en","name_ja","description_en","description_ja"])if(!m[c]||/[가-힣]/.test(m[c]))issues.push("menu translation "+m.menu_id+" "+c);
 if(m.image_status==="verified"&&!/^https?:/.test(m.image_url||""))issues.push("verified without URL "+m.menu_id);
}
const result={ok:issues.length===0,issues,summary:{restaurants:payload.restaurants.length,menus:payload.menus.length,verifiedImages:payload.menus.filter(m=>m.image_status==="verified").length,unavailableImages:payload.menus.filter(m=>m.image_status==="not_available").length,repairedTranslations:repairs.length}};
for(const name of ["selection","prepared","preflight","translation-repairs"])fs.writeFileSync(path.join(out,name+".json"),JSON.stringify(name==="selection"?final:name==="prepared"?payload:name==="preflight"?result:repairs,null,2));
console.log("CURATION",JSON.stringify(result));if(!result.ok)process.exitCode=2;
