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

class UpstreamError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchPage<T>(path: string, token: string, pageNo: number): Promise<ApiPayload<T>> {
  const url = new URL(path, BASE_URL);
  url.searchParams.set("serviceKey", token);
  url.searchParams.set("pageNo", String(pageNo));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    if (response.status === 429) {
      if (attempt === 3) {
        throw new UpstreamError(`${path} 요청 제한이 계속되고 있습니다. 잠시 후 자동 수집을 다시 실행하세요.`, 429);
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15_000)
        : [2_000, 5_000, 10_000][attempt];
      await sleep(waitMs);
      continue;
    }

    if (response.status >= 500 && attempt < 2) {
      await sleep([1_500, 4_000][attempt]);
      continue;
    }

    if (!response.ok) throw new UpstreamError(`${path} 응답 오류 (${response.status})`, response.status);

    const payload = (await response.json()) as ApiPayload<T>;
    if (payload.header?.resultCode && payload.header.resultCode !== "00") {
      throw new UpstreamError(payload.header.resultMsg || `${path} 조회에 실패했습니다.`, 502);
    }
    return payload;
  }

  throw new UpstreamError(`${path} 조회에 실패했습니다.`, 502);
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
      mode?: "restaurants" | "menus" | "images";
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
    const maxBatch = mode === "menus" ? 2 : 3;
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

      const payloads: ApiPayload<RestaurantRow>[] = [];
      for (const page of pages) {
        payloads.push(await fetchPage<RestaurantRow>("/api/rstr", token, page));
        await sleep(300);
      }

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

      for (const payload of payloads) {
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
      }

      const lastPayload = payloads.at(-1);
      const lastPage = pages.at(-1) ?? startPage;
      return NextResponse.json({
        restaurants,
        nextPage: nextPage(lastPayload?.header, lastPage),
        stats: {
          scannedFrom: startPage,
          scannedTo: lastPage,
          rawCount: payloads.reduce((sum, payload) => sum + (payload.body?.length ?? 0), 0),
          totalCount: Number(lastPayload?.header?.totalCount) || 0,
          excludedStoredCount: excludes.size,
        },
      });
    }

    const restaurantIds = new Set((body.restaurantIds ?? []).map(String));
    if (!restaurantIds.size) return NextResponse.json({ error: "메뉴를 연결할 식당이 없습니다." }, { status: 400 });

    if (mode === "menus") {
      const menusByRestaurant: Record<string, Array<{
        menuId: string;
        nameKo: string;
        nameEn: string;
        nameJa: string;
        price: number;
        isSpecialty: boolean;
      }>> = {};
      let lastHeader: ApiHeader | undefined;

      for (const page of pages) {
        const ko = await fetchPage<MenuRow>("/api/menu/korean", token, page);
        await sleep(220);
        const en = await fetchPage<MenuRow>("/api/menu/eng", token, page);
        await sleep(220);
        const ja = await fetchPage<MenuRow>("/api/menu/jpnse", token, page);
        await sleep(300);
        lastHeader = ko.header;

        const enById = new Map((en.body ?? []).map((row) => [String(row.MENU_ID ?? ""), row]));
        const jaById = new Map((ja.body ?? []).map((row) => [String(row.MENU_ID ?? ""), row]));

        for (const koRow of ko.body ?? []) {
          const restaurantId = String(koRow.RSTR_ID ?? "");
          if (!restaurantIds.has(restaurantId)) continue;
          const menuId = String(koRow.MENU_ID ?? "");
          if (!menuId) continue;
          const enRow = enById.get(menuId);
          const jaRow = jaById.get(menuId);
          (menusByRestaurant[restaurantId] ??= []).push({
            menuId,
            nameKo: String(koRow.MENU_NM ?? ""),
            nameEn: String(enRow?.MENU_NM ?? ""),
            nameJa: String(jaRow?.MENU_NM ?? ""),
            price: Number(koRow.MENU_PRICE ?? enRow?.MENU_PRICE ?? jaRow?.MENU_PRICE ?? 0),
            isSpecialty: String(koRow.SPCLT_MENU_YN ?? "N") === "Y",
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
      const payload = await fetchPage<ImageRow>("/api/rstr/img", token, page);
      lastHeader = payload.header;
      for (const row of payload.body ?? []) {
        const restaurantId = String(row.RSTR_ID ?? "");
        if (!restaurantIds.has(restaurantId) || imagesByRestaurant[restaurantId]) continue;
        imagesByRestaurant[restaurantId] = normalizeImageUrl(String(row.RSTR_IMG_URL ?? ""));
      }
      await sleep(300);
    }

    const lastPage = pages.at(-1) ?? startPage;
    return NextResponse.json({
      imagesByRestaurant,
      nextPage: nextPage(lastHeader, lastPage),
      stats: { scannedFrom: startPage, scannedTo: lastPage, totalCount: Number(lastHeader?.totalCount) || 0 },
    });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "통합 수집에 실패했습니다." },
      { status },
    );
  }
}
