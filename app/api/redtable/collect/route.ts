import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_URL = "https://seoul.openapi.redtable.global";

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

type ApiPayload<T> = {
  header?: ApiHeader;
  body?: T[];
};

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
  RSTR_NM?: string;
};

type ImageRow = {
  RSTR_ID?: string | number;
  RSTR_IMG_URL?: string;
};

async function fetchPage<T>(path: string, token: string, pageNo: number): Promise<ApiPayload<T>> {
  const url = new URL(path, BASE_URL);
  url.searchParams.set("serviceKey", token);
  url.searchParams.set("pageNo", String(pageNo));

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) throw new Error(`${path} 응답 오류 (${response.status})`);
  const payload = (await response.json()) as ApiPayload<T>;
  if (payload.header?.resultCode && payload.header.resultCode !== "00") {
    throw new Error(payload.header.resultMsg || `${path} 조회에 실패했습니다.`);
  }
  return payload;
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

    const token = body.token?.trim();
    if (!token) return NextResponse.json({ error: "서울관광재단 API 토큰을 입력하세요." }, { status: 400 });

    const mode = body.mode ?? "restaurants";
    const startPage = Math.max(Number(body.pageNo) || 1, 1);
    const maxBatch = mode === "menus" ? 5 : 10;
    const pagesPerBatch = Math.min(Math.max(Number(body.pagesPerBatch) || maxBatch, 1), maxBatch);
    const pages = Array.from({ length: pagesPerBatch }, (_, index) => startPage + index);

    if (mode === "restaurants") {
      const aliases = body.regionKey === "custom"
        ? [body.customRegion?.trim() || ""]
        : REGION_ALIASES[body.regionKey || "seongsu"] ?? REGION_ALIASES.seongsu;
      const regionNeedles = aliases.filter(Boolean);
      const keyword = body.keyword?.trim() || "전체";
      const categoryNeedles = CATEGORY_ALIASES[keyword] ?? [keyword];
      const excludes = new Set((body.excludeIds ?? []).map(String));

      const payloads = await Promise.all(pages.map((page) => fetchPage<RestaurantRow>("/api/rstr", token, page)));
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
        },
      });
    }

    const restaurantIds = new Set((body.restaurantIds ?? []).map(String));
    if (!restaurantIds.size) return NextResponse.json({ error: "메뉴를 연결할 식당이 없습니다." }, { status: 400 });

    if (mode === "menus") {
      const bundles = await Promise.all(pages.map(async (page) => {
        const [ko, en, ja] = await Promise.all([
          fetchPage<MenuRow>("/api/menu/korean", token, page),
          fetchPage<MenuRow>("/api/menu/eng", token, page),
          fetchPage<MenuRow>("/api/menu/jpnse", token, page),
        ]);
        return { page, ko, en, ja };
      }));

      const menusByRestaurant: Record<string, Array<{
        menuId: string;
        nameKo: string;
        nameEn: string;
        nameJa: string;
        price: number;
        isSpecialty: boolean;
      }>> = {};

      for (const bundle of bundles) {
        const enById = new Map((bundle.en.body ?? []).map((row) => [String(row.MENU_ID ?? ""), row]));
        const jaById = new Map((bundle.ja.body ?? []).map((row) => [String(row.MENU_ID ?? ""), row]));

        for (const ko of bundle.ko.body ?? []) {
          const restaurantId = String(ko.RSTR_ID ?? "");
          if (!restaurantIds.has(restaurantId)) continue;
          const menuId = String(ko.MENU_ID ?? "");
          if (!menuId) continue;
          const en = enById.get(menuId);
          const ja = jaById.get(menuId);
          const menu = {
            menuId,
            nameKo: String(ko.MENU_NM ?? ""),
            nameEn: String(en?.MENU_NM ?? ""),
            nameJa: String(ja?.MENU_NM ?? ""),
            price: Number(ko.MENU_PRICE ?? en?.MENU_PRICE ?? ja?.MENU_PRICE ?? 0),
            isSpecialty: String(ko.SPCLT_MENU_YN ?? "N") === "Y",
          };
          (menusByRestaurant[restaurantId] ??= []).push(menu);
        }
      }

      const lastPayload = bundles.at(-1)?.ko;
      const lastPage = pages.at(-1) ?? startPage;
      return NextResponse.json({
        menusByRestaurant,
        nextPage: nextPage(lastPayload?.header, lastPage),
        stats: {
          scannedFrom: startPage,
          scannedTo: lastPage,
          totalCount: Number(lastPayload?.header?.totalCount) || 0,
        },
      });
    }

    const payloads = await Promise.all(pages.map((page) => fetchPage<ImageRow>("/api/rstr/img", token, page)));
    const imagesByRestaurant: Record<string, string> = {};
    for (const payload of payloads) {
      for (const row of payload.body ?? []) {
        const restaurantId = String(row.RSTR_ID ?? "");
        if (!restaurantIds.has(restaurantId) || imagesByRestaurant[restaurantId]) continue;
        imagesByRestaurant[restaurantId] = normalizeImageUrl(String(row.RSTR_IMG_URL ?? ""));
      }
    }

    const lastPayload = payloads.at(-1);
    const lastPage = pages.at(-1) ?? startPage;
    return NextResponse.json({
      imagesByRestaurant,
      nextPage: nextPage(lastPayload?.header, lastPage),
      stats: {
        scannedFrom: startPage,
        scannedTo: lastPage,
        totalCount: Number(lastPayload?.header?.totalCount) || 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "통합 수집에 실패했습니다." },
      { status: 500 },
    );
  }
}
