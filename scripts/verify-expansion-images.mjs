import fs from "node:fs";
import path from "node:path";
const runDir=path.resolve(process.argv[2]||"");
const menusPerStore=Number(process.argv[3]||3);
if(!process.argv[2]||!Number.isInteger(menusPerStore)||menusPerStore<0)throw Error("Usage: node scripts/verify-expansion-images.mjs <run-directory> [menus-per-store]");
const data=JSON.parse(fs.readFileSync(path.join(runDir,"prepared.json"),"utf8"));
const byRestaurant=new Map();
for(const menu of data.menus){
 const list=byRestaurant.get(menu.restaurant_id)||[];list.push(menu);byRestaurant.set(menu.restaurant_id,list);
}
const urls=new Map();
const add=(url,owner,type)=>{if(/^https?:\/\//.test(url||"")){const refs=urls.get(url)||[];refs.push({owner,type});urls.set(url,refs)}};
for(const store of data.restaurants){
 add(store.image_url,store.name,"cover");
 for(const menu of (byRestaurant.get(store.source_id)||[]).filter(m=>m.image_status==="verified").slice(0,menusPerStore))add(menu.image_url,store.name,"menu");
}
const tasks=[...urls].map(([url,refs])=>({url,refs})),results=[];let cursor=0;
const headers={"user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36","accept":"image/avif,image/webp,image/*,*/*;q=0.8"};
async function inspect(task){
 let response,firstError="";
 try{response=await fetch(task.url,{method:"HEAD",headers,redirect:"follow",signal:AbortSignal.timeout(8000)});if(response.ok&&(response.headers.get("content-type")||"").startsWith("image/"))return {...task,ok:true,method:"HEAD",status:response.status}}catch(e){firstError=String(e)}
 try{response=await fetch(task.url,{method:"GET",headers:{...headers,Range:"bytes=0-1023"},redirect:"follow",signal:AbortSignal.timeout(8000)});const type=response.headers.get("content-type")||"";const okay=(response.ok||response.status===206)&&type.startsWith("image/");await response.body?.cancel();return {...task,ok:okay,method:"GET",status:response.status,type}}catch(e){return {...task,ok:false,error:String(e),headError:firstError}}
}
async function worker(){while(cursor<tasks.length){const i=cursor++;results[i]=await inspect(tasks[i]);if(i%40===0)console.log("image probe",i+1,"/",tasks.length)}}
await Promise.all(Array.from({length:12},worker));
const failures=results.filter(x=>!x.ok);
const report={checkedAt:new Date().toISOString(),restaurants:data.restaurants.length,sampledUrls:tasks.length,passed:results.length-failures.length,failed:failures.length,failures};
fs.writeFileSync(path.join(runDir,"image-http-check.json"),JSON.stringify(report,null,2),"utf8");
console.log(JSON.stringify({sampledUrls:report.sampledUrls,passed:report.passed,failed:report.failed,failures:failures.slice(0,12)},null,2));
if(failures.length)process.exitCode=2;
