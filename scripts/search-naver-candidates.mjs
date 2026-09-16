import puppeteer from 'puppeteer-core';

const queries = process.argv.slice(2);
if (!queries.length) throw new Error('queries required');
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  headless: true,
  defaultViewport: { width: 1400, height: 1000 },
});
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({ 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7' });
const results = [];
for (const query of queries) {
  const url = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
  await page.goto(url, {waitUntil:'networkidle2', timeout:30000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,1800));
  const hits=[];
  for (const frame of page.frames()) {
    try {
      const data=await frame.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({href:a.href,text:(a.textContent||'').trim()})).filter(x=>/\/place\/\d+|\/restaurant\/\d+/.test(x.href)).slice(0,40));
      hits.push(...data);
    } catch {}
  }
  results.push({query,url:page.url(),title:await page.title(),hits:[...new Map(hits.map(x=>[x.href,x])).values()]});
}
console.log(JSON.stringify(results,null,2));
await browser.close();
