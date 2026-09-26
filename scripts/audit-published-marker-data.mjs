import fs from "node:fs"; import {createClient} from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const stores=[];
for(const region of ["seongsu","hongdae"]){
 let q=db.from("public_data_restaurants").select("source_id,name,category,license_type,search_keyword,region_key,introduction").eq("publish_status","published").eq("region_key",region).limit(500);
 if(region==="hongdae")q=q.gte("latitude",37.548).lte("latitude",37.5665).gte("longitude",126.91).lte("longitude",126.936).not("name_en","is",null).neq("name_en","").not("image_url","is",null).neq("image_url","");
 const {data,error}=await q; if(error)throw error;stores.push(...data);
}
for(let i=0;i<stores.length;i+=15){
 const ids=stores.slice(i,i+15).map(x=>x.source_id);
 const {data,error}=await db.from("public_data_menus").select("restaurant_id,name_ko,is_specialty,sort_order").in("restaurant_id",ids).order("sort_order").limit(1500);
 if(error)throw error;
 for(const store of stores.slice(i,i+15))store.menus=data.filter(x=>x.restaurant_id===store.source_id);
}
fs.mkdirSync(".expansion-runs/marker-audit",{recursive:true});fs.writeFileSync(".expansion-runs/marker-audit/stores.json",JSON.stringify(stores,null,2));
for(const s of stores.filter(x=>/고기|한돈|한우|돼지|소고기|갈비|곱창|막창|구이|족발|보쌈|스테이크|정육/.test(x.name+" "+x.category))){
 console.log(JSON.stringify({id:s.source_id,name:s.name,category:s.category,region:s.region_key,menus:s.menus.slice(0,8).map(m=>(m.is_specialty?"*":"")+m.name_ko)}));
}
console.log("TOTAL",stores.length,"BY_REGION",JSON.stringify(Object.groupBy(stores,s=>s.region_key).seongsu?.length),JSON.stringify(Object.groupBy(stores,s=>s.region_key).hongdae?.length));