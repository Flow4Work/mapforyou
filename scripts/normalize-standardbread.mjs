import fs from 'node:fs';
const src=JSON.parse(fs.readFileSync('standardbread-menu.json','utf8'));
const rows=Object.entries(src.pageData.apollo||{})
  .filter(([k,v])=>k.startsWith('Menu:') && v?.__typename==='Menu')
  .map(([k,v])=>({
    naverKey:k,
    naverMenuId:String(v.id||k.split(':')[1]),
    index:Number(v.index??9999),
    nameKo:String(v.name||'').trim(),
    price:Number(v.price||0),
    descriptionKo:String(v.description||'').trim(),
    isSpecialty:Boolean(v.recommend),
    images:Array.isArray(v.images)?v.images.filter(Boolean):[],
  }))
  .sort((a,b)=>a.index-b.index);
for(const r of rows){
  r.menuId=`naver:${r.naverMenuId}`;
  r.imageUrl=r.images[0]||'';
  r.imageStatus=r.images.length?'verified':'not_available';
  r.imageSource=r.images.length?'naver_place_menu':'naver_place_menu';
  r.imageSourceUrl='https://map.naver.com/p/entry/place/1720159258?placePath=/menu';
  r.imageAttribution='Naver Place · Standard Bread Seongsu';
}
const out={restaurantId:'naver:1720159258',placeId:'1720159258',name:'스탠다드브레드 성수',menuCount:rows.length,verifiedImageCount:rows.filter(x=>x.imageStatus==='verified').length,notAvailableCount:rows.filter(x=>x.imageStatus==='not_available').length,menus:rows};
fs.writeFileSync('standardbread-normalized.json',JSON.stringify(out,null,2),'utf8');
console.log(JSON.stringify({menuCount:out.menuCount,verified:out.verifiedImageCount,notAvailable:out.notAvailableCount,notAvailableMenus:rows.filter(x=>x.imageStatus==='not_available').map(x=>x.nameKo)}));
