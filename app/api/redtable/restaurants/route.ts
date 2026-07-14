import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_URL = "https://seoul.openapi.redtable.global";

const REGION_ALIASES: Record<string, string[]> = {
  seongsu: ["성동구", "성수동"],
  hongdae: ["마포구", "서교동", "동교동", "연남동", "상수동", "합정동"],
  geondae: ["광진구", "자양동", "화양동", "군자동"],
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

function includesAny(value: string, needles: string[]) {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      pageNo?: number;
      pagesPerBatch?: number;
      regionKey?: string;
      customRegion?: string;
      keyword?: string;
      excludeIds?: string[];
    };

    const token = body.token?.trim();
    if (!token) {
      return NextResponse.json({ error: "서울관광재단 API 토큰을 입력하세요." }, { status: 400 });
    }

    const startPage = Math.max(Number(body.pageNo) || 1, 1);
    const pagesPerBatch = Math.min(Math.max(Number(body.pagesPerBatch) || 5, 1), 10);
    const aliases = body.regionKey === "custom"
      ? [body.customRegion?.trim() || ""]
      : REGION_ALIASES[body.regionKey || "seongsu"] ?? REGION_ALIASES.seongsu;
    const regionNeedles = aliases.filter(Boolean);
    const keyword = body.keyword?.trim() || "전체";
    const excludes = new Set((body.excludeIds ?? []).map(String));

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

    let totalCount = 0;
    let rawCount = 0;
    let lastPage = startPage;
    let reachedEnd = false;

    for (let offset = 0; offset < pagesPerBatch; offset += 1) {
      const currentPage = startPage + offset;
      lastPage = currentPage;
      const url = new URL("/api/rstr", BASE_URL);
      url.searchParams.set("serviceKey", token);
      url.searchParams.set("pageNo", String(currentPage));

      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`식당 기본정보 API 오류 (${response.status})`);

      const payload = (await response.json()) as {
        header?: { resultCode?: string; resultMsg?: string; numOfRows?: number; totalCount?: number };
        body?: RestaurantRow[];
      };
      if (payload.header?.resultCode && payload.header.resultCode !== "00") {
        throw new Error(payload.header.resultMsg || "식당 기본정보 조회에 실패했습니다.");
      }

      const rows = payload.body ?? [];
      rawCount += rows.length;
      totalCount = Number(payload.header?.totalCount) || totalCount;
      if (!rows.length) {
        reachedEnd = true;
        break;
      }

      for (const row of rows) {
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
        if (keyword !== "전체" && !searchText.toLowerCase().includes(keyword.toLowerCase())) continue;

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

      const rowsPerPage = Number(payload.header?.numOfRows) || rows.length;
      if (totalCount && currentPage * rowsPerPage >= totalCount) {
        reachedEnd = true;
        break;
      }
    }

    return NextResponse.json({
      restaurants,
      nextPage: reachedEnd ? null : lastPage + 1,
      stats: {
        startPage,
        lastPage,
        scannedPages: lastPage - startPage + 1,
        rawCount,
        matchedCount: restaurants.length,
        totalCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "식당 데이터를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
