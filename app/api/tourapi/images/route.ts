import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_URL = "https://apis.data.go.kr/B551011/KorService2";
const KEY_SETTING = "tourapi_korservice_key";
const CHECKED_SETTING = "tourapi_image_checked_ids";
const ACTIVE_REGIONS = ["seongsu", "hongdae"];
const DEFAULT_LIMIT = 6;

type StoreRow = {
  source_id: string;
  name: string;
  road_address: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  region_key: string | null;
  image_url: string | null;
};

type SearchItem = {
  contentid?: string | number;
  title?: string;
  addr1?: string;
  addr2?: string;
  mapx?: string | number;
  mapy?: string | number;
  firstimage?: string;
};

type ImageItem = {
  contentid?: string | number;
  originimgurl?: string;
  smallimageurl?: string;
  imgname?: string;
  cpyrhtDivCd?: string;
};

type TourPayload<T> = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      items?: { item?: T[] | T } | "";
      totalCount?: number;
    };
  };
};

type CandidateImage = {
  url: string;
  source: "tourapi_menu" | "tourapi_representative" | "tourapi_general";
  license: string;
  label: string;
};

function normalize(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/(본점|직영점|지점)$/g, "")
    .replace(/[^0-9a-zA-Z가-힣]/g, "")
    .toLowerCase();
}

function baseName(value: string) {
  return value
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(성수|홍대|서울|왕십리|마포|성동)\s*(점|본점|지점)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const earth = 6_371_000;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const lat1 = radians(aLat);
  const lat2 = radians(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

function arrayItems<T>(payload: TourPayload<T>) {
  const item = payload.response?.body?.items && typeof payload.response.body.items === "object"
    ? payload.response.body.items.item
    : undefined;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTemporaryTourError(message: string) {
  return /(LIMITED_NUMBER|TOO_MANY|429|503|504|timeout|timed out|fetch failed|ECONNRESET|응답 형식 오류|일시|트래픽|요청.*초과|서비스.*불가)/i.test(message);
}

async function resolveSettings() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase 연결이 없습니다.");

  const { data, error } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", [KEY_SETTING, CHECKED_SETTING]);
  if (error) throw error;

  const map = new Map((data ?? []).map((row) => [String(row.key), String(row.value)]));
  const key = map.get(KEY_SETTING)?.trim() ?? "";
  let checkedIds: string[] = [];
  try {
    checkedIds = JSON.parse(map.get(CHECKED_SETTING) || "[]") as string[];
  } catch {
    checkedIds = [];
  }
  return { supabase, key, checkedIds: new Set(checkedIds.map(String)) };
}

async function tourFetch<T>(path: string, key: string, params: Record<string, string | number>) {
  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("MobileOS", "ETC");
  url.searchParams.set("MobileApp", "MapForYou");
  url.searchParams.set("_type", "json");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
      const text = await response.text();
      let payload: TourPayload<T>;
      try {
        payload = JSON.parse(text) as TourPayload<T>;
      } catch {
        throw new Error(`TourAPI ${path} 응답 형식 오류 (${response.status})`);
      }

      const code = payload.response?.header?.resultCode;
      if (!response.ok || (code && code !== "0000")) {
        throw new Error(payload.response?.header?.resultMsg || `TourAPI ${path} 호출 실패 (${response.status})`);
      }
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("TourAPI 호출 실패");
      if (!isTemporaryTourError(lastError.message) || attempt === 2) break;
      await sleep(700 * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`TourAPI ${path} 호출 실패`);
}

function candidateScore(store: StoreRow, item: SearchItem) {
  const storeName = normalize(store.name);
  const itemName = normalize(String(item.title ?? ""));
  if (!itemName || !storeName) return 0;

  let score = 0;
  if (itemName === storeName) score += 60;
  else if (itemName.includes(storeName) || storeName.includes(itemName)) score += 42;
  else {
    const left = normalize(baseName(store.name));
    const right = normalize(baseName(String(item.title ?? "")));
    if (left && right && (left === right || left.includes(right) || right.includes(left))) score += 35;
  }

  const storeAddress = `${store.road_address ?? ""} ${store.address ?? ""}`;
  const itemAddress = `${item.addr1 ?? ""} ${item.addr2 ?? ""}`;
  const district = store.region_key === "hongdae" ? "마포구" : "성동구";
  if (itemAddress.includes(district)) score += 15;

  const roadTokens = storeAddress.match(/[가-힣A-Za-z0-9]+(?:로|길)\s*\d*/g) ?? [];
  if (roadTokens.some((token) => itemAddress.replace(/\s/g, "").includes(token.replace(/\s/g, "")))) score += 15;

  const mapx = Number(item.mapx);
  const mapy = Number(item.mapy);
  if (store.latitude != null && store.longitude != null && Number.isFinite(mapx) && Number.isFinite(mapy)) {
    const distance = distanceMeters(store.latitude, store.longitude, mapy, mapx);
    if (distance <= 250) score += 35;
    else if (distance <= 700) score += 22;
    else if (distance <= 1500) score += 8;
    else score -= 20;
  }

  return score;
}

async function findContent(store: StoreRow, key: string) {
  const queries = [...new Set([store.name, baseName(store.name)].filter(Boolean))];
  let best: { item: SearchItem; score: number } | null = null;

  for (const keyword of queries) {
    const payload = await tourFetch<SearchItem>("searchKeyword2", key, {
      keyword,
      contentTypeId: 39,
      arrange: "A",
      numOfRows: 20,
      pageNo: 1,
    });
    for (const item of arrayItems(payload)) {
      const score = candidateScore(store, item);
      if (!best || score > best.score) best = { item, score };
    }
    if (best && best.score >= 70) break;
  }

  return best && best.score >= 50 ? best : null;
}

async function detailImages(contentId: string, imageYN: "N" | "Y", key: string) {
  const payload = await tourFetch<ImageItem>("detailImage2", key, {
    contentId,
    imageYN,
    numOfRows: 30,
    pageNo: 1,
  });
  return arrayItems(payload).filter((item) => /^https?:\/\//i.test(String(item.originimgurl ?? "")));
}

async function selectImage(item: SearchItem, key: string): Promise<CandidateImage | null> {
  const contentId = String(item.contentid ?? "");
  if (!contentId) return null;

  const menuImages = await detailImages(contentId, "N", key);
  if (menuImages.length) {
    const image = menuImages[0];
    return {
      url: String(image.originimgurl),
      source: "tourapi_menu",
      license: String(image.cpyrhtDivCd || "unknown"),
      label: "음식메뉴 이미지",
    };
  }

  if (/^https?:\/\//i.test(String(item.firstimage ?? ""))) {
    return {
      url: String(item.firstimage),
      source: "tourapi_representative",
      license: "unknown",
      label: "대표 이미지",
    };
  }

  const generalImages = await detailImages(contentId, "Y", key);
  if (generalImages.length) {
    const image = generalImages[0];
    return {
      url: String(image.originimgurl),
      source: "tourapi_general",
      license: String(image.cpyrhtDivCd || "unknown"),
      label: "일반 콘텐츠 이미지",
    };
  }

  return null;
}

async function statusSnapshot() {
  const { supabase, key, checkedIds } = await resolveSettings();
  const { data, error } = await supabase
    .from("public_data_restaurants")
    .select("source_id,image_url")
    .in("region_key", ACTIVE_REGIONS)
    .limit(5000);
  if (error) throw error;

  const missing = (data ?? []).filter((row) => !String(row.image_url ?? "").trim());
  const unchecked = missing.filter((row) => !checkedIds.has(String(row.source_id)));
  return {
    configured: Boolean(key),
    missing: missing.length,
    checked: missing.length - unchecked.length,
    remainingUnchecked: unchecked.length,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await statusSnapshot());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TourAPI 현황 조회 실패" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, key, checkedIds } = await resolveSettings();
    if (!key) return NextResponse.json({ error: "한국관광공사 TourAPI 키가 저장되지 않았습니다." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { limit?: number; reset?: boolean };
    if (body.reset) {
      await supabase.from("app_settings").upsert({ key: CHECKED_SETTING, value: "[]", updated_at: new Date().toISOString() }, { onConflict: "key" });
      return NextResponse.json({ reset: true, ...(await statusSnapshot()) });
    }

    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), 10);
    const { data, error } = await supabase
      .from("public_data_restaurants")
      .select("source_id,name,road_address,address,latitude,longitude,region_key,image_url")
      .in("region_key", ACTIVE_REGIONS)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw error;

    const targets = ((data ?? []) as StoreRow[])
      .filter((store) => !String(store.image_url ?? "").trim() && !checkedIds.has(String(store.source_id)))
      .slice(0, limit);

    let attempted = 0;
    let matched = 0;
    let saved = 0;
    let noMatch = 0;
    let noImage = 0;
    let failed = 0;
    let upstreamError = "";
    const samples: Array<{ name: string; result: string }> = [];
    const now = new Date().toISOString();

    for (const store of targets) {
      const id = String(store.source_id);
      attempted += 1;
      try {
        const match = await findContent(store, key);
        if (!match) {
          noMatch += 1;
          samples.push({ name: store.name, result: "매칭 없음" });
          checkedIds.add(id);
          continue;
        }

        matched += 1;
        const image = await selectImage(match.item, key);
        if (!image) {
          noImage += 1;
          samples.push({ name: store.name, result: "TourAPI 이미지 없음" });
          checkedIds.add(id);
          continue;
        }

        const contentId = String(match.item.contentid ?? "");
        const attribution = `한국관광공사 TourAPI · ${image.license} · ${image.label}`;
        const { error: updateError } = await supabase
          .from("public_data_restaurants")
          .update({
            image_url: image.url,
            image_source: `${image.source}_${image.license.toLowerCase()}`,
            image_attribution: attribution,
            image_source_url: `${BASE_URL}/detailImage2?contentId=${encodeURIComponent(contentId)}`,
            image_checked_at: now,
            updated_at: now,
          })
          .eq("source_id", id);
        if (updateError) throw updateError;

        saved += 1;
        checkedIds.add(id);
        samples.push({ name: store.name, result: `${image.label} 연결` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "처리 실패";
        samples.push({ name: store.name, result: message });

        if (isTemporaryTourError(message)) {
          upstreamError = message;
          break;
        }

        failed += 1;
        checkedIds.add(id);
      }
    }

    await supabase.from("app_settings").upsert({
      key: CHECKED_SETTING,
      value: JSON.stringify([...checkedIds]),
      updated_at: now,
    }, { onConflict: "key" });

    const responseBody = {
      processed: attempted,
      matched,
      saved,
      noMatch,
      noImage,
      failed,
      samples,
      ...(await statusSnapshot()),
    };

    if (upstreamError) {
      const rateLimited = /(LIMITED_NUMBER|TOO_MANY|429|트래픽|요청.*초과)/i.test(upstreamError);
      return NextResponse.json(
        {
          ...responseBody,
          error: rateLimited
            ? "TourAPI 요청이 잠시 몰려 자동 실행을 멈췄습니다. 잠시 뒤 다시 실행해주세요."
            : `TourAPI 일시 오류로 중단했습니다: ${upstreamError}`,
          retryable: true,
        },
        { status: rateLimited ? 429 : 503 },
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TourAPI 이미지 보강 실패" },
      { status: 500 },
    );
  }
}
