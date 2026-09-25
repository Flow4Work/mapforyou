import fs from "node:fs";
import {createClient} from "@supabase/supabase-js";
// Use the tracked, reviewed release file rather than a gitignored one-off run directory.
for(const line of (fs.existsSync(".env.local")?fs.readFileSync(".env.local","utf8"):"").split(/\r?\n/)){
  const entry=line.trim();if(!entry||entry.startsWith("#"))continue;
  const i=entry.indexOf("=");if(i<1)continue;
  const key=entry.slice(0,i),value=entry.slice(i+1).replace(/^["']|["']$/g,"");
  if(!(key in process.env))process.env[key]=value;
}
const key=process.env.SUPABASE_SERVICE_ROLE_KEY,url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const apply=process.argv.includes("--apply");
const admin=Boolean(key&&(key.startsWith("sb_secret_")||(()=>{
  try{return JSON.parse(Buffer.from(key.split(".")[1],"base64url")).role==="service_role"}catch{return false}
})()));
if(apply&&(!admin||!url))throw Error("Publishing requires real Supabase service-role credentials");
const db=admin&&url?createClient(url,key,{auth:{persistSession:false}}):null;
const allowed=new Set(JSON.parse(fs.readFileSync("data/hongdae-2026-09-25.json")).restaurants.map(r=>r.source_id));
const review=JSON.parse(fs.readFileSync("data/hongdae-2026-09-25-ai-description-review.json","utf8"));
const rows=review.rows.filter(r=>r.description_en!==r.old_en||r.description_ja!==r.old_ja);
if(allowed.size!==40||review.summary.changed!==955||review.rows.length!==1035||rows.length!==955||new Set(rows.map(r=>r.menu_id)).size!==955)
  throw Error("Unexpected reviewed release counts or duplicate menu rows");
const publicMenus=new Map();
if(!db){
  const base=(process.env.MAPFORYOU_PUBLIC_URL||"https://mapforyou.vercel.app").replace(/\/$/,"");
  for(let offset=0,step=0;step<20;step++){
    const res=await fetch(`${base}/api/discovery?perRegion=150&offset=${offset}`,{signal:AbortSignal.timeout(60000)});
    if(!res.ok)throw Error("Public preflight HTTP "+res.status);
    const page=await res.json();
    for(const store of page.stores.filter(s=>allowed.has(s.id))){
      for(const menu of store.menus){
        if(publicMenus.has(menu.id))throw Error("Duplicate public menu: "+menu.id);
        publicMenus.set(menu.id,{menu_id:menu.id,restaurant_id:store.id,description_ko:menu.descriptionKo,description_en:menu.descriptionEn,description_ja:menu.descriptionJa});
      }
    }
    if(page.nextOffset==null)break;
    if(page.nextOffset<=offset)throw Error("Public preflight pagination stalled");
    offset=page.nextOffset;
  }
}
const groups=[];for(let i=0;i<rows.length;i+=45)groups.push(rows.slice(i,i+45));
let completed=0,already=0;const todo=[];
for(const group of groups){
  const {data,error}=db?await db.from("public_data_menus")
    .select("menu_id,restaurant_id,description_ko,description_en,description_ja")
    .in("menu_id",group.map(r=>r.menu_id)):{data:group.map(r=>publicMenus.get(r.menu_id)).filter(Boolean),error:null};
  if(error)throw error;
  const actual=new Map(data.map(r=>[r.menu_id,r]));
  for(const row of group){
    const current=actual.get(row.menu_id),parent=row.menu_id.split(":menu:")[0];
    if(!allowed.has(parent)||!current||current.restaurant_id!==parent||current.description_ko!==row.description_ko)
      throw Error("Hongdae scope or Korean source conflict: "+row.menu_id);
    if(current.description_en===row.description_en&&current.description_ja===row.description_ja){already++;continue}
    if(current.description_en!==row.old_en||current.description_ja!==row.old_ja)
      throw Error("Concurrent translation conflict: "+row.menu_id);
    todo.push({...row,restaurant_id:parent});
  }
}
console.log(JSON.stringify({preflight:"PASS",source:db?"admin-db":"public-api",reviewed:rows.length,already,todo:todo.length,apply}));
if(!apply)process.exit(0);
for(let start=0;start<todo.length;start+=36){
  const batch=todo.slice(start,start+36),failures=[];
  for(let i=0;i<batch.length;i+=6){
    const results=await Promise.allSettled(batch.slice(i,i+6).map(async row=>{
      const {data,error}=await db.from("public_data_menus")
        .update({description_en:row.description_en,description_ja:row.description_ja})
        .eq("menu_id",row.menu_id).eq("restaurant_id",row.restaurant_id)
        .eq("description_ko",row.description_ko).eq("description_en",row.old_en)
        .eq("description_ja",row.old_ja).select("menu_id");
      if(error)throw Error(row.menu_id+" "+error.message);
      if(data.length!==1)throw Error("Optimistic write conflict "+row.menu_id);
      completed++;
    }));
    failures.push(...results.filter(r=>r.status==="rejected").map(r=>String(r.reason)));
  }
  console.log(JSON.stringify({updated:completed,total:todo.length,failed:failures.length}));
  if(failures.length)throw Error("Write failed; safely rerun: "+failures.slice(0,5).join("; "));
}
