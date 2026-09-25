import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";

const REGIONS = {
  seongsu: {
    bounds: { west: 127.044, south: 37.535, east: 127.0685, north: 37.5555 },
    aliases: ["성수", "서울숲", "뚝섬"],
  },
  hongdae: {
    bounds: { west: 126.91, south: 37.548, east: 126.936, north: 37.5665 },
    aliases: ["홍대", "연남동", "합정", "상수"],
  },
};

const RESTAURANT_TERMS = [
  "맛집", "한식 맛집", "고기 맛집", "일식 맛집", "중식 맛집", "양식 맛집",
  "파스타 맛집", "피자 맛집", "국밥 맛집", "분식 맛집", "베트남 맛집", "태국 맛집",
];
const CAFE_TERMS = ["카페", "로스터리 카페", "디저트 카페", "베이커리 카페", "커피 맛집"];
const CAFE_RE = /(카페|커피|베이커리|디저트|도넛|아이스크림|제과|브런치)/i;
const NON_FOOD_RE = /(와인바|와인샵|주점|호프|펍|클럽|노래|바\(BAR\)|이자카야|칵테일바|라운지바|포차)/i;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function loadEnv() {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local not found");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function hasAdminDbKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (key.startsWith("sb_secret_")) return true;
  try {
    const parts = key.split(".");
    return parts.length === 3 && JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

function createDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  if (!hasAdminDbKey()) console.warn("WARNING: public DB key can only check visible rows. Before publishing, check ALL rows (including drafts) using an authorized admin connection.");
  return createClient(url, key, { auth: { persistSession: false } });
}

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value)
  .toLocaleLowerCase("ko-KR")
  .replace(/(홍대점|연남점|합정점|상수점|성수점|서울숲점|본점|직영점)/g, "")
  .replace(/[^0-9a-z가-힣]/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const http = (value) => /^https?:\/\//i.test(String(value || ""));
const inBounds = (lat, lng, bounds) => Number.isFinite(lat) && Number.isFinite(lng)
  && lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;

function kindFromCategory(category) {
  return CAFE_RE.test(clean(category)) ? "cafe" : "restaurant";
}

function scoreCandidate(store) {
  const menuCoverage = store.menuCount > 0 ? store.verifiedImageCount / store.menuCount : 0;
  return Math.min(store.menuCount, 25) * 3 + Math.min(store.verifiedImageCount, 20) * 4
    + Math.round(menuCoverage * 25) + Math.min(store.gallery.length, 8) * 3;
}

async function searchPlaceIds(region) {
  const queries = [];
  for (const alias of region.aliases) {
    for (const term of RESTAURANT_TERMS) queries.push(`${alias} ${term}`);
    for (const term of CAFE_TERMS) queries.push(`${alias} ${term}`);
  }
  const all = new Set();
  const report = [];
  for (const query of queries) {
    const url = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(query)}`;
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
          "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const ids = [
        ...html.matchAll(/\/entry\/place\/(\d{5,})/g),
        ...html.matchAll(/\/(?:restaurant|cafe)\/(\d{5,})/g),
      ].map((match) => match[1]);
      const unique = [...new Set(ids)];
      unique.forEach((id) => all.add(id));
      report.push({ query, count: unique.length });
      console.log("SEARCH", query, unique.length, "unique-total", all.size);
    } catch (error) {
      report.push({ query, count: 0, error: error.message });
      console.warn("SEARCH_FAIL", query, error.message);
    }
    await sleep(40);
  }
  return { ids: [...all], report };
}

async function readCandidate(page, placeId) {
  for (const pageKind of ["restaurant", "cafe"]) {
    const url = `https://pcmap.place.naver.com/${pageKind}/${placeId}/menu/list?from=map&locale=ko`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
    await page.waitForSelector('[data-nlog-area="plc_bmv.menu"]', { timeout: 2200 }).catch(() => undefined);
    await sleep(120);
    const data = await page.evaluate((id) => {
      const apollo = globalThis.__APOLLO_STATE__ || {};
      const base = apollo[`PlaceDetailBase:${id}`]
        || Object.values(apollo).find((value) => value?.__typename === "PlaceDetailBase" && String(value.id) === String(id))
        || {};
      const apolloMenus = Object.entries(apollo)
        .filter(([key, value]) => key.startsWith(`Menu:${id}_`) && value?.__typename === "Menu")
        .map(([key, value], index) => ({
          rawId: String(value.id || key.split(":")[1] || index + 1),
          nameKo: String(value.name || "").trim(),
          price: Number(value.price || 0),
          descriptionKo: String(value.description || "").trim(),
          isSpecialty: Boolean(value.recommend),
          images: Array.isArray(value.images) ? value.images.filter(Boolean) : [],
          index: Number(value.index ?? index),
        }))
        .filter((menu) => menu.nameKo && menu.price >= 0)
        .sort((a, b) => a.index - b.index);
      const domMenus = [...document.querySelectorAll('[data-nlog-area="plc_bmv.menu"]')]
        .map((anchor, index) => {
          const lines = (anchor.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
          const priceLine = lines.find((line) => /\d[\d,]*\s*원/.test(line)) || "";
          const nameKo = lines.find((line) => line !== priceLine && !/^대표$/.test(line)) || "";
          const price = Number((priceLine.match(/\d[\d,]*/)?.[0] || "").replaceAll(",", "")) || 0;
          const imageUrl = anchor.querySelector("img")?.currentSrc || anchor.querySelector("img")?.src || "";
          return {
            rawId: `dom_${index}`,
            nameKo,
            price,
            descriptionKo: lines.filter((line) => line !== nameKo && line !== priceLine && !/^대표$/.test(line)).join(" "),
            isSpecialty: /대표/.test(anchor.innerText || ""),
            images: imageUrl ? [imageUrl] : [],
            index,
          };
        })
        .filter((menu) => menu.nameKo && menu.price > 0);
      const photos = Object.values(apollo)
        .filter((value) => value?.__typename === "PlaceDetailTopPhotoItem" && value.mediaFormat === "image" && value.originalUrl)
        .map((value) => ({ url: value.originalUrl, mediaSource: value.mediaSource }));
      const links = [...document.querySelectorAll("a[href]")].map((anchor) => anchor.href).filter(Boolean).slice(0, 800);
      return {
        base: {
          id: base.id || "",
          name: base.name || "",
          category: base.category || "",
          roadAddress: base.roadAddress || "",
          address: base.address || "",
          latitude: Number(base.coordinate?.y || 0) || null,
          longitude: Number(base.coordinate?.x || 0) || null,
          phone: base.virtualPhone || base.phone || "",
          introduction: String(base.description || base.microReview || "").trim(),
        },
        menus: apolloMenus.length ? apolloMenus : domMenus,
        photos,
        bodyText: (document.body?.innerText || "").slice(0, 16000),
        links,
      };
    }, placeId).catch(() => null);
    if (!data?.base?.id) continue;

    const businessPhotos = data.photos.filter((photo) => photo.mediaSource === "business");
    const otherPhotos = data.photos.filter((photo) => photo.mediaSource !== "business");
    const orderedPhotos = [...businessPhotos, ...otherPhotos];
    const menus = data.menus.map((menu, index) => {
      const rawKey = clean(menu.rawId).replace(/[^0-9a-zA-Z_-]/g, "_") || `dom_${index}`;
      const imageUrl = menu.images?.[0] || "";
      return {
        menuId: `naver:${placeId}:menu:${rawKey}`,
        nameKo: clean(menu.nameKo),
        price: Number(menu.price || 0),
        descriptionKo: clean(menu.descriptionKo),
        isSpecialty: Boolean(menu.isSpecialty),
        imageUrl,
        imageStatus: imageUrl ? "verified" : "not_available",
        imageSource: imageUrl ? "naver_place_menu" : null,
        imageSourceUrl: `https://map.naver.com/p/entry/place/${placeId}?placePath=/menu`,
        imageAttribution: `Naver Place | ${clean(data.base.name) || placeId}`,
      };
    });
    const menuKeys = new Set();
    const uniqueMenus = menus.filter((menu) => {
      const key = [clean(menu.nameKo).toLocaleLowerCase("ko-KR").replace(/\s+/g, ""), menu.price, menu.imageUrl, menu.descriptionKo].join("|");
      if (menuKeys.has(key)) return false;
      menuKeys.add(key);
      return true;
    });
    return {
      placeId: String(placeId),
      name: clean(data.base.name),
      category: clean(data.base.category),
      roadAddress: clean(data.base.roadAddress),
      address: clean(data.base.address),
      latitude: data.base.latitude,
      longitude: data.base.longitude,
      phone: clean(data.base.phone),
      introduction: clean(data.base.introduction),
      currentlyListed: !/폐업/.test(data.bodyText),
      representativeImage: orderedPhotos[0]?.url || "",
      gallery: [...new Set(orderedPhotos.map((photo) => photo.url).filter(Boolean))].slice(0, 8),
      menuCount: uniqueMenus.length,
      verifiedImageCount: uniqueMenus.filter((menu) => menu.imageStatus === "verified").length,
      menus: uniqueMenus,
      naverUrl: `https://map.naver.com/p/entry/place/${placeId}`,
      instagramUrl: data.links.find((link) => /instagram\.com/i.test(link)) || "",
      homepageUrl: data.links.find((link) => !/(naver\.com|pstatic\.net|instagram\.com)/i.test(link) && /^https?:/i.test(link)) || "",
    };
  }
  return null;
}

async function inspectCandidates(ids, bounds, existingPlaceIds) {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    headless: true,
    defaultViewport: { width: 1280, height: 1000 },
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36");
  await page.setExtraHTTPHeaders({ "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" });
  const stores = [];
  try {
    const pending = ids.filter((id) => !existingPlaceIds.has(String(id)));
    for (let index = 0; index < pending.length; index += 1) {
      const placeId = pending[index];
      const store = await readCandidate(page, placeId);
      if (!store) continue;
      store.inBounds = inBounds(store.latitude, store.longitude, bounds);
      store.kind = kindFromCategory(store.category);
      store.valid = Boolean(
        store.currentlyListed
        && store.inBounds
        && store.menuCount > 0
        && http(store.representativeImage)
        && !NON_FOOD_RE.test(store.category),
      );
      stores.push(store);
      console.log(
        "INSPECT",
        `${index + 1}/${pending.length}`,
        store.valid ? "VALID" : "skip",
        store.kind,
        store.name,
        store.category,
        "menus",
        store.menuCount,
      );
    }
  } finally {
    await browser.close();
  }
  return stores;
}

async function translateChunk(lines, target) {
  const source = lines.join("\n");
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=${target}&dt=t&q=${encodeURIComponent(source)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; MapForYouExpansion/1.0)" },
  });
  if (!response.ok) throw new Error(`translation HTTP ${response.status}`);
  const payload = await response.json();
  const translated = (payload?.[0] || []).map((part) => part?.[0] || "").join("");
  const result = translated.split("\n").map(clean);
  if (result.length === lines.length) return result;
  const fallback = [];
  for (const line of lines) {
    const single = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=${target}&dt=t&q=${encodeURIComponent(line)}`;
    const singleResponse = await fetch(single, { signal: AbortSignal.timeout(15000) });
    if (!singleResponse.ok) throw new Error(`translation fallback HTTP ${singleResponse.status}`);
    const singlePayload = await singleResponse.json();
    fallback.push(clean((singlePayload?.[0] || []).map((part) => part?.[0] || "").join("")) || line);
    await sleep(50);
  }
  return fallback;
}

async function translateAll(values, target) {
  const unique = [...new Set(values.map(clean).filter(Boolean))];
  const map = new Map();
  for (let index = 0; index < unique.length; index += 20) {
    const chunk = unique.slice(index, index + 20);
    let translated;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        translated = await translateChunk(chunk, target);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await sleep(attempt * 500);
      }
    }
    chunk.forEach((value, offset) => map.set(value, clean(translated[offset]) || value));
    console.log("TRANSLATE", target, Math.min(index + chunk.length, unique.length), "/", unique.length);
    await sleep(100);
  }
  return map;
}

function selectCandidates(candidates, existingRows, restaurantTarget, cafeTarget) {
  const existingNameAddr = new Set(existingRows.map((row) => `${norm(row.name)}|${norm(row.road_address)}`));
  const seen = new Set();
  const fresh = [];
  for (const store of candidates.filter((item) => item.valid).sort((a, b) => scoreCandidate(b) - scoreCandidate(a))) {
    const key = `${norm(store.name)}|${norm(store.roadAddress)}`;
    if (!norm(store.name) || !norm(store.roadAddress) || existingNameAddr.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push(store);
  }
  const restaurants = fresh.filter((store) => store.kind === "restaurant").slice(0, restaurantTarget);
  const cafes = fresh.filter((store) => store.kind === "cafe").slice(0, cafeTarget);
  if (restaurants.length !== restaurantTarget || cafes.length !== cafeTarget) {
    throw new Error(`Not enough valid fresh candidates: restaurants=${restaurants.length}/${restaurantTarget}, cafes=${cafes.length}/${cafeTarget}`);
  }
  return [...restaurants, ...cafes];
}

async function preparePayload(selection, regionKey) {
  const now = new Date().toISOString();
  const koTexts = [];
  for (const store of selection) {
    const intro = clean(store.introduction) || `${clean(store.name)}의 메뉴와 매장 정보를 확인해 보세요.`;
    koTexts.push(store.name, store.roadAddress, intro);
    for (const menu of store.menus) {
      const description = clean(menu.descriptionKo) || `${clean(menu.nameKo)} 메뉴입니다.`;
      koTexts.push(menu.nameKo, description);
    }
  }
  const [enMap, jaMap] = await Promise.all([translateAll(koTexts, "en"), translateAll(koTexts, "ja")]);
  const t = (map, value) => map.get(clean(value)) || clean(value);
  const restaurants = [];
  const menus = [];
  for (const store of selection) {
    const sourceId = `naver:${store.placeId}`;
    const intro = clean(store.introduction) || `${clean(store.name)}의 메뉴와 매장 정보를 확인해 보세요.`;
    restaurants.push({
      source_id: sourceId,
      source_name: "naver_place",
      name: store.name,
      name_en: t(enMap, store.name),
      name_ja: t(jaMap, store.name),
      road_address: store.roadAddress,
      road_address_en: t(enMap, store.roadAddress),
      road_address_ja: t(jaMap, store.roadAddress),
      address: store.address || store.roadAddress,
      latitude: store.latitude,
      longitude: store.longitude,
      phone: store.phone || null,
      category: store.category || (store.kind === "cafe" ? "카페,디저트" : "음식점"),
      introduction: intro,
      introduction_en: t(enMap, intro),
      introduction_ja: t(jaMap, intro),
      image_url: store.representativeImage,
      image_gallery_urls: store.gallery,
      image_source: "naver_place",
      image_attribution: `Naver Place | ${store.name}`,
      image_source_url: store.naverUrl,
      image_checked_at: now,
      region_key: regionKey,
      search_keyword: `${regionKey}_expansion_${store.kind}`,
      publish_status: "published",
      source_checked_at: now,
      naver_place_id: store.placeId,
      naver_place_url: store.naverUrl,
      official_website_url: store.homepageUrl || null,
      naver_place_checked_at: now,
      operating_status: "listed",
      verification_source: "naver_place",
      verification_checked_at: now,
      instagram_url: store.instagramUrl || null,
      updated_at: now,
      kind: store.kind,
    });
    store.menus.forEach((menu, index) => {
      const desc = clean(menu.descriptionKo) || `${clean(menu.nameKo)} 메뉴입니다.`;
      menus.push({
        menu_id: menu.menuId,
        restaurant_id: sourceId,
        sort_order: index,
        name_ko: menu.nameKo,
        name_en: t(enMap, menu.nameKo),
        name_ja: t(jaMap, menu.nameKo),
        description_ko: desc,
        description_en: t(enMap, desc),
        description_ja: t(jaMap, desc),
        price: Math.max(0, Math.trunc(Number(menu.price || 0))),
        is_specialty: Boolean(menu.isSpecialty),
        image_url: menu.imageUrl || null,
        image_source: menu.imageSource,
        image_source_url: menu.imageSourceUrl,
        image_attribution: menu.imageAttribution,
        image_checked_at: now,
        image_status: menu.imageStatus,
        updated_at: now,
      });
    });
  }
  return { preparedAt: now, restaurants, menus };
}

function preflightPayload(payload, region, restaurantTarget, cafeTarget) {
  const restaurants = payload.restaurants;
  const menus = payload.menus;
  const issues = [];
  const counts = {
    restaurants: restaurants.filter((row) => row.kind === "restaurant").length,
    cafes: restaurants.filter((row) => row.kind === "cafe").length,
  };
  if (counts.restaurants !== restaurantTarget || counts.cafes !== cafeTarget) {
    issues.push(`count mismatch ${JSON.stringify(counts)}`);
  }
  const menuIds = new Set();
  const duplicateMenuIds = [];
  for (const menu of menus) {
    if (menuIds.has(menu.menu_id)) duplicateMenuIds.push(menu.menu_id);
    menuIds.add(menu.menu_id);
  }
  if (duplicateMenuIds.length) issues.push(`duplicate menu ids: ${duplicateMenuIds.slice(0, 10).join(",")}`);
  const badStores = restaurants.filter((row) =>
    !row.name || !row.name_en || !row.name_ja || !row.road_address || !row.road_address_en || !row.road_address_ja
    || !inBounds(Number(row.latitude), Number(row.longitude), region.bounds)
    || !http(row.image_url) || !Array.isArray(row.image_gallery_urls) || !row.image_gallery_urls.length
  );
  if (badStores.length) issues.push(`bad stores: ${badStores.map((row) => row.name).join(",")}`);
  const menuCountByRestaurant = new Map();
  for (const menu of menus) menuCountByRestaurant.set(menu.restaurant_id, (menuCountByRestaurant.get(menu.restaurant_id) || 0) + 1);
  const storesWithoutMenus = restaurants.filter((row) => !menuCountByRestaurant.get(row.source_id));
  if (storesWithoutMenus.length) issues.push(`stores without menus: ${storesWithoutMenus.map((row) => row.name).join(",")}`);
  const missingTranslations = menus.filter((menu) =>
    !menu.name_ko || !menu.name_en || !menu.name_ja || !menu.description_ko || !menu.description_en || !menu.description_ja
  );
  if (missingTranslations.length) issues.push(`missing menu translations: ${missingTranslations.length}`);
  const badVerifiedImages = menus.filter((menu) => menu.image_status === "verified" && !http(menu.image_url));
  if (badVerifiedImages.length) issues.push(`bad verified images: ${badVerifiedImages.length}`);
  const badStatuses = menus.filter((menu) => !["verified", "not_available", "needs_review", "unchecked"].includes(menu.image_status));
  if (badStatuses.length) issues.push(`bad image statuses: ${badStatuses.length}`);
  const sourceMismatch = menus.filter((menu) => {
    if (menu.image_status !== "verified") return false;
    const placeId = String(menu.restaurant_id).replace("naver:", "");
    return !String(menu.image_source_url || "").includes(placeId);
  });
  if (sourceMismatch.length) issues.push(`image source mismatch: ${sourceMismatch.length}`);
  const hangulInEn = menus.filter((menu) => /[가-힣]/.test(`${menu.name_en} ${menu.description_en}`)).length
    + restaurants.filter((row) => /[가-힣]/.test(`${row.name_en} ${row.introduction_en}`)).length;
  const hangulInJa = menus.filter((menu) => /[가-힣]/.test(`${menu.name_ja} ${menu.description_ja}`)).length
    + restaurants.filter((row) => /[가-힣]/.test(`${row.name_ja} ${row.introduction_ja}`)).length;
  if (hangulInEn) issues.push(`untranslated Hangul in EN: ${hangulInEn}`);
  if (hangulInJa) issues.push(`untranslated Hangul in JA: ${hangulInJa}`);
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      stores: restaurants.length,
      restaurants: counts.restaurants,
      cafes: counts.cafes,
      menus: menus.length,
      verified: menus.filter((menu) => menu.image_status === "verified").length,
      notAvailable: menus.filter((menu) => menu.image_status === "not_available").length,
      needsReview: menus.filter((menu) => menu.image_status === "needs_review").length,
      missingTranslations: missingTranslations.length,
      hangulInEn,
      hangulInJa,
    },
  };
}

async function publishRun(runDir, db) {
  if (!hasAdminDbKey()) throw new Error("Publishing requires a server-only Supabase secret/service-role key. A publishable key cannot verify drafts or write rows.");
  const preparedPath = path.join(runDir, "prepared.json");
  const preflightPath = path.join(runDir, "preflight.json");
  if (!fs.existsSync(preparedPath) || !fs.existsSync(preflightPath)) throw new Error("Run directory is missing prepared/preflight artifacts");
  const payload = JSON.parse(fs.readFileSync(preparedPath, "utf8"));
  const preflight = JSON.parse(fs.readFileSync(preflightPath, "utf8"));
  if (!preflight.ok) throw new Error(`Refusing publish: preflight failed: ${preflight.issues.join("; ")}`);
  const sourceIds = payload.restaurants.map((row) => row.source_id);
  const placeIds = payload.restaurants.map((row) => String(row.naver_place_id));
  const { data: collisions, error: collisionError } = await db
    .from("public_data_restaurants")
    .select("source_id,naver_place_id,name")
    .or(`source_id.in.(${sourceIds.join(",")}),naver_place_id.in.(${placeIds.join(",")})`);
  if (collisionError) throw collisionError;
  if (collisions?.length) throw new Error(`Refusing publish: DB collisions found: ${collisions.map((row) => row.name).join(", ")}`);

  const restaurantRows = payload.restaurants.map(({ kind, ...row }) => row);
  const insertedIds = restaurantRows.map((row) => row.source_id);
  try {
    const { error: restaurantError } = await db.from("public_data_restaurants").insert(restaurantRows);
    if (restaurantError) throw restaurantError;
    for (let index = 0; index < payload.menus.length; index += 200) {
      const chunk = payload.menus.slice(index, index + 200);
      const { error: menuError } = await db.from("public_data_menus").insert(chunk);
      if (menuError) throw menuError;
    }
  } catch (error) {
    await db.from("public_data_restaurants").delete().in("source_id", insertedIds);
    throw error;
  }
  const result = {
    publishedAt: new Date().toISOString(),
    stores: restaurantRows.length,
    menus: payload.menus.length,
    sourceIds: insertedIds,
  };
  fs.writeFileSync(path.join(runDir, "publish.json"), JSON.stringify(result, null, 2), "utf8");
  console.log("PUBLISHED", JSON.stringify(result, null, 2));
}

async function revalidateCachedCandidates(run, region, existingRows, existingPlaceIds, restaurantTarget, cafeTarget) {
  const cache = path.join(path.resolve(run), "candidates.json");
  if (!fs.existsSync(cache)) throw new Error("Candidate cache not found: " + cache);
  const prior = JSON.parse(fs.readFileSync(cache, "utf8"));
  if (!Array.isArray(prior)) throw new Error("Candidate cache must be an array");
  const existingNames = new Set(existingRows.map((row) => norm(row.name) + "|" + norm(row.road_address)));
  const fresh = prior.filter((store) => store.valid && !NON_FOOD_RE.test(store.category)
    && (store.kind === "restaurant" ? restaurantTarget > 0 : cafeTarget > 0)
    && !existingPlaceIds.has(String(store.placeId))
    && !existingNames.has(norm(store.name) + "|" + norm(store.roadAddress)));
  fresh.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const inspected = [];
  for (let index = 0; index < fresh.length; index += 20) {
    const batch = await inspectCandidates(fresh.slice(index, index + 20).map((row) => row.placeId), region.bounds, existingPlaceIds);
    inspected.push(...batch);
    const ready = inspected.filter((row) => row.valid && !NON_FOOD_RE.test(row.category));
    const restaurants = ready.filter((row) => row.kind === "restaurant").length;
    const cafes = ready.filter((row) => row.kind === "cafe").length;
    console.log("REVALIDATED", inspected.length, "restaurants", restaurants, "cafes", cafes);
    if (restaurants >= restaurantTarget + (restaurantTarget ? 5 : 0)
      && cafes >= cafeTarget + (cafeTarget ? 3 : 0)) break;
  }
  return { candidates: inspected, search: { ids: fresh.map((row) => row.placeId), report: [{ source: "cached-run", path: cache, revalidated: inspected.length }] } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.publish) throw new Error("--publish is not supported: inspect the saved preflight and use --publish-run <run-dir> with admin credentials.");
  loadEnv();
  const db = createDb();

  if (args["publish-run"]) {
    const runDir = path.resolve(String(args["publish-run"]));
    await publishRun(runDir, db);
    return;
  }

  const regionKey = clean(args.region);
  const region = REGIONS[regionKey];
  if (!region) throw new Error(`Unsupported --region. Use: ${Object.keys(REGIONS).join(", ")}`);
  const restaurantTarget = Number(args.restaurants);
  const cafeTarget = Number(args.cafes);
  if (!Number.isInteger(restaurantTarget) || restaurantTarget < 0 || !Number.isInteger(cafeTarget) || cafeTarget < 0 || restaurantTarget + cafeTarget < 1) {
    throw new Error("Valid --restaurants and --cafes counts are required");
  }

  const runId = `${regionKey}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.resolve(".expansion-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const { data: existingRows, error: existingError } = await db
    .from("public_data_restaurants")
    .select("source_id,naver_place_id,name,road_address,latitude,longitude");
  if (existingError) throw existingError;
  const existingPlaceIds = new Set((existingRows || []).flatMap((row) => [
    String(row.naver_place_id || ""),
    /^naver:[0-9]+$/.test(row.source_id || "") ? String(row.source_id).slice(6) : "",
  ]).filter(Boolean));

  let search;
  let candidates;
  if (args["candidate-run"]) {
    ({ search, candidates } = await revalidateCachedCandidates(
      String(args["candidate-run"]), region, existingRows || [], existingPlaceIds, restaurantTarget, cafeTarget,
    ));
  } else {
    search = await searchPlaceIds(region);
    candidates = await inspectCandidates(search.ids, region.bounds, existingPlaceIds);
  }
  fs.writeFileSync(path.join(runDir, "search.json"), JSON.stringify(search, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "candidates.json"), JSON.stringify(candidates, null, 2), "utf8");
  console.log("SEARCH_UNIQUE", search.ids.length, "INSPECTED", candidates.length);

  const selection = selectCandidates(candidates, existingRows || [], restaurantTarget, cafeTarget);
  fs.writeFileSync(path.join(runDir, "selection.json"), JSON.stringify(selection, null, 2), "utf8");
  console.log("SELECTED", selection.filter((row) => row.kind === "restaurant").length, "restaurants,", selection.filter((row) => row.kind === "cafe").length, "cafes");

  const payload = await preparePayload(selection, regionKey);
  fs.writeFileSync(path.join(runDir, "prepared.json"), JSON.stringify(payload, null, 2), "utf8");

  const preflight = preflightPayload(payload, region, restaurantTarget, cafeTarget);
  fs.writeFileSync(path.join(runDir, "preflight.json"), JSON.stringify(preflight, null, 2), "utf8");
  console.log("PREFLIGHT", JSON.stringify(preflight, null, 2));
  console.log("RUN_DIR", runDir);
  if (!preflight.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
