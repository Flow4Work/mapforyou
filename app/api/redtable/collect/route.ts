import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_URL = "https://seoul.openapi.redtable.global";
const TOKEN_SETTING_KEY = "seoul_tourism_api_token";

const REGION_ALIASES: Record<string, string[]> = {
  seongsu: ["성동구", "성수동"],
  hongdae: ["마포구", "서교동", "동교동", "연남동", "상수동", "합정동"],
  geondae: ["광진구", "자양동", "화양동", "군자동"],
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  전체: [],
  카페: ["카페", "커피", "다방", "제과", "베이커리", "휴게음식점"],
  치킨: ["치킨", "통닭", "닭"],
  삼겹살: ["삼겹살", "돼지고기", "육류", "고기", "구이"],
  한식: ["한식", "한정식", "백반"],
  일식: ["일식", "초밥", "스시", "돈까스", "우동", "라멘"],
  중식: ["중식", "중국식", "짜장", "짬뽕", "마라"],
};

type ApiHeader = {
  resultCode?: string;
  resultMsg?: string;
  numOfRows?: number;
  pageNo?: number;
  totalCount?: number;
};

type ApiPayload<T> = { header?: ApiHeader; body?: T[] };

type RestaurantRow = {
  RSTR_ID?: string | number;
  RSTR_NM?: string;
  RSTR_RDNMADR?: string;
  RSTR_LNNO_ADRES?: string;
  RSTR_LA?: string | number;
  RSTR_LO?: string | number;
  RSTR_TELNO?: string;
  BSNS_STATM_BZCND_NM?: string;
  BSNS_LCNC_NM?: string;
  RSTR_INTRCN_CONT?: string;
  RSTR_AREA_CLSF_NM?: string;
};

type MenuRow = {
  MENU_ID?: string | number;
  MENU_NM?: string;
  MENU_PRICE?: string | number | null;
  SPCLT_MENU_YN?: string | null;
  RSTR_ID?: string | number;
};

type ImageRow = { RSTR_ID?: string | number; RSTR_IMG_URL?: string };

type MenuResult = {
  menuId: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  price: number;
  isSpecialty: boolean;
};

class UpstreamError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status = 502, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortableSleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveToken(provided?: string) {
  if (provided?.trim()) return provided.trim();
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new UpstreamError("Supabase 연결이 없어 저장된 API 토큰을 읽지 못했습니다.", 503);

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", TOKEN_SETTING_KEY)
    .maybeSingle();

  if (error) throw new UpstreamError(`저장된 API 토큰 조회 실패: ${error.message}`, 503);
  if (!data?.value) throw new UpstreamError("서울관광재단 API 토큰이 저장되지 않았습니다.", 400);
  return String(data.value);
}

async function fetchPage<T>(path: string, token: string, pageNo: number, signal: AbortSignal): Promise<ApiPayload<T>> {
  const url = new URL(path, BASE_URL);
  url.searchParams.set("serviceKey", token);
  url.searchParams.set("pageNo", String(pageNo));

  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: { accept: "application/json" },
  });

  const text = await response.text();
  let payload: ApiPayload<T> = {};
  try {
    payload = text ? JSON.parse(text) as ApiPayload<T> : {};
  } catch {
    if (!response.ok) throw new UpstreamError(`${path} 응답 오류 (${response.status})`, response.status);
    throw new UpstreamError(`${path} 응답 형식이 올바르지 않습니다.`, 502);
  }

  const resultCode = payload.header?.resultCode;
  const resultMessage = payload.header?.resultMsg;
  if (response.status === 429 || resultCode === "22") {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new UpstreamError(
      resultMessage || "OPEN API 요청 한도가 초과되었습니다.",
      429,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }

  if (!response.ok) throw new UpstreamError(`${path} 응답 오류 (${response.status})`, response.status);
  if (resultCode && resultCode !== "00") {
    throw new UpstreamError(resultMessage || `${path} 조회에 실패했습니다.`, 502);
  }
  return payload;
}

async function getStoredRestaurantIds() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return new Set<string>();

  const ids = new Set<string>();
  const pageSize = 1000;
  for (let start = 0; start < 20_000; start += pageSize) {
    const { data, error } = await supabase
      .from("public_data_restaurants")
      .select("source_id")
      .range(start, start + pageSize - 1);
    if (error) throw new UpstreamError(`기존 식당 목록 조회 실패: ${error.message}`, 503);
    for (const row of data ?? []) ids.add(String(row.source_id));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return ids;
}

function includesAny(value: string, needles: string[]) {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function nextPage(header: ApiHeader | undefined, lastPage: number) {
  const rows = Number(header?.numOfRows) || 1000;
  const total = Number(header?.totalCount) || 0;
  return total && lastPage * rows >= total ? null : lastPage + 1;
}

function normalizeImageUrl(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${BASE_URL}/${value.replace(/^\/+/, "")}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      mode?: "restaurants" | "menus-ko" | "menu-translations" | "images";
      pageNo?: number;
      pagesPerBatch?: number;
      regionKey?: string;
      customRegion?: string;
      keyword?: string;
      excludeIds?: string[];
      restaurantIds?: string[];
    };

    const token = await resolveToken(body.token);
    const mode = body.mode ?? "restaurants";
    const startPage = Math.max(Number(body.pageNo) || 1, 1);
    const maxBatch = mode === "restaurants" ? 2 : 1;
    const pagesPerBatch = Math.min(Math.max(Number(body.pagesPerBatch) || 1, 1), maxBatch);
    const pages = Array.from({ length: pagesPerBatch }, (_, index) => startPage + index);

    if (mode === "restaurants") {
      const aliases = body.regionKey === "custom"
        ? [body.customRegion?.trim() || ""]
        : REGION_ALIASES[body.regionKey || "seongsu"] ?? REGION_ALIASES.seongsu;
      const regionNeedles = aliases.filter(Boolean);
      const keyword = body.keyword?.trim() || "전체";
      const categoryNeedles = CATEGORY_ALIASES[keyword] ?? [keyword];
      const excludes = await getStoredRestaurantIds();
      for (const id of body.excludeIds ?? []) excludes.add(String(id));

      const restaurants: Array<{
        sourceId: string;
        name: string;
        roadAddress: string;
        address: string;
        latitude: string;
        longitude: string;
        phone: string;
        category: string;
        licenseType: string;
        introduction: string;
      }> = [];
      let lastHeader: ApiHeader | undefined;
      let rawCount = 0;

      for (const page of pages) {
        const payload = await fetchPage<RestaurantRow>("/api/rstr", token, page, request.signal);
        lastHeader = payload.header;
        rawCount += payload.body?.length ?? 0;

        for (const row of payload.body ?? []) {
          const sourceId = String(row.RSTR_ID ?? "");
          if (!sourceId || excludes.has(sourceId)) continue;

          const addressText = `${row.RSTR_RDNMADR ?? ""} ${row.RSTR_LNNO_ADRES ?? ""}`;
          if (regionNeedles.length && !includesAny(addressText, regionNeedles)) continue;

          const searchText = [
            row.RSTR_NM,
            row.BSNS_STATM_BZCND_NM,
            row.BSNS_LCNC_NM,
            row.RSTR_INTRCN_CONT,
            row.RSTR_AREA_CLSF_NM,
          ].filter(Boolean).join(" ");
          if (categoryNeedles.length && !includesAny(searchText, categoryNeedles)) continue;

          restaurants.push({
            sourceId,
            name: row.RSTR_NM ?? "이름 없음",
            roadAddress: row.RSTR_RDNMADR ?? "",
            address: row.RSTR_LNNO_ADRES ?? "",
            latitude: String(row.RSTR_LA ?? ""),
            longitude: String(row.RSTR_LO ?? ""),
            phone: row.RSTR_TELNO ?? "",
            category: row.BSNS_STATM_BZCND_NM ?? "",
            licenseType: row.BSNS_LCNC_NM ?? "",
            introduction: row.RSTR_INTRCN_CONT ?? "",
          });
        }

        if (page !== pages.at(-1)) await abortableSleep(250, request.signal);
      }

      const lastPage = pages.at(-1) ?? startPage;
      return NextResponse.json({
        restaurants,
        nextPage: nextPage(lastHeader, lastPage),
        stats: {
          scannedFrom: startPage,
          scannedTo: lastPage,
          rawCount,
          totalCount: Number(lastHeader?.totalCount) || 0,
          excludedStoredCount: excludes.size,
        },
      });
    }

    const restaurantIds = new Set((body.restaurantIds ?? []).map(String));
    if (!restaurantIds.size) return NextResponse.json({ error: "메뉴를 연결할 식당이 없습니다." }, { status: 400 });

    if (mode === "menus-ko") {
      const menusByRestaurant: Record<string, MenuResult[]> = {};
      let lastHeader: ApiHeader | undefined;
      const matchedPages: number[] = [];

      for (const page of pages) {
        const ko = await fetchPage<MenuRow>("/api/menu/korean", token, page, request.signal);
        lastHeader = ko.header;
        let matched = false;

        for (const row of ko.body ?? []) {
          const restaurantId = String(row.RSTR_ID ?? "");
          if (!restaurantIds.has(restaurantId)) continue;
          const menuId = String(row.MENU_ID ?? "");
          if (!menuId) continue;
          matched = true;
          (menusByRestaurant[restaurantId] ??= []).push({
            menuId,
            nameKo: String(row.MENU_NM ?? ""),
            nameEn: "",
            nameJa: "",
            price: Number(row.MENU_PRICE ?? 0),
            isSpecialty: String(row.SPCLT_MENU_YN ?? "N") === "Y",
          });
        }

        if (matched) matchedPages.push(page);
      }

      const lastPage = pages.at(-1) ?? startPage;
      return NextResponse.json({
        menusByRestaurant,
        matchedPages,
        nextPage: nextPage(lastHeader, lastPage),
        stats: { scannedFrom: startPage, scannedTo: lastPage, totalCount: Number(lastHeader?.totalCount) || 0 },
      });
    }

    if (mode === "menu-translations") {
      const menusByRestaurant: Record<string, MenuResult[]> = {};
      let lastHeader: ApiHeader | undefined;

      for (const page of pages) {
        const en = await fetchPage<MenuRow>("/api/menu/eng", token, page, request.signal);
        await abortableSleep(450, request.signal);
        const ja = await fetchPage<MenuRow>("/api/menu/jpnse", token, page, request.signal);
        lastHeader = en.header;

        const jaById = new Map((ja.body ?? []).map((row) => [String(row.MENU_ID ?? ""), row]));
        for (const enRow of en.body ?? []) {
          const restaurantId = String(enRow.RSTR_ID ?? "");
          if (!restaurantIds.has(restaurantId)) continue;
          const menuId = String(enRow.MENU_ID ?? "");
          if (!menuId) continue;
          const jaRow = jaById.get(menuId);
          (menusByRestaurant[restaurantId] ??= []).push({
            menuId,
            nameKo: "",
            nameEn: String(enRow.MENU_NM ?? ""),
            nameJa: String(jaRow?.MENU_NM ?? ""),
            price: Number(enRow.MENU_PRICE ?? jaRow?.MENU_PRICE ?? 0),
            isSpecialty: String(enRow.SPCLT_MENU_YN ?? "N") === "Y",
          });
        }
      }

      const lastPage = pages.at(-1) ?? startPage;
      return NextResponse.json({
        menusByRestaurant,
        nextPage: nextPage(lastHeader, lastPage),
        stats: { scannedFrom: startPage, scannedTo: lastPage, totalCount: Number(lastHeader?.totalCount) || 0 },
      });
    }

    const imagesByRestaurant: Record<string, string> = {};
    let lastHeader: ApiHeader | undefined;
    for (const page of pages) {
      const payload = await fetchPage<ImageRow>("/api/rstr/img", token, page, request.signal);
      lastHeader = payload.header;
      for (const row of payload.body ?? []) {
        const restaurantId = String(row.RSTR_ID ?? "");
        if (!restaurantIds.has(restaurantId) || imagesByRestaurant[restaurantId]) continue;
        imagesByRestaurant[restaurantId] = normalizeImageUrl(String(row.RSTR_IMG_URL ?? ""));
      }
    }

    const lastPage = pages.at(-1) ?? startPage;
    return NextResponse.json({
      imagesByRestaurant,
      nextPage: nextPage(lastHeader, lastPage),
      stats: { scannedFrom: startPage, scannedTo: lastPage, totalCount: Number(lastHeader?.totalCount) || 0 },
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      return NextResponse.json({ error: "수집 요청이 취소되었습니다." }, { status: 499 });
    }

    const status = error instanceof UpstreamError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "통합 수집에 실패했습니다.",
        rateLimited: status === 429,
        retryAfterSeconds: error instanceof UpstreamError ? error.retryAfterSeconds : undefined,
      },
      { status },
    );
  }
}
