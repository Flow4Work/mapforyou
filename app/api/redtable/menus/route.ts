import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_URL = "https://seoul.openapi.redtable.global";

type MenuRow = {
  MENU_ID?: string | number;
  MENU_NM?: string;
  MENU_PRICE?: string | number | null;
  SPCLT_MENU_YN?: string | null;
  RSTR_ID?: string | number;
  RSTR_NM?: string;
  AREA_NM?: string;
};

type ApiPayload = {
  header?: {
    resultCode?: string;
    resultMsg?: string;
    numOfRows?: number;
    pageNo?: number;
    totalCount?: number;
  };
  body?: MenuRow[];
};

async function fetchMenuPage(path: string, token: string, pageNo: number) {
  const url = new URL(path, BASE_URL);
  url.searchParams.set("serviceKey", token);
  url.searchParams.set("pageNo", String(pageNo));

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${path} 응답 오류 (${response.status})`);

  const payload = (await response.json()) as ApiPayload;
  if (payload.header?.resultCode && payload.header.resultCode !== "00") {
    throw new Error(payload.header.resultMsg || `${path} 조회에 실패했습니다.`);
  }
  return payload;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: string; pageNo?: number };
    const token = body.token?.trim();
    if (!token) {
      return NextResponse.json({ error: "서울관광재단 API 토큰을 입력하세요." }, { status: 400 });
    }

    const pageNo = Math.max(Number(body.pageNo) || 1, 1);
    const [koPayload, enPayload, jaPayload] = await Promise.all([
      fetchMenuPage("/api/menu/korean", token, pageNo),
      fetchMenuPage("/api/menu/eng", token, pageNo),
      fetchMenuPage("/api/menu/jpnse", token, pageNo),
    ]);

    const enById = new Map((enPayload.body ?? []).map((row) => [String(row.MENU_ID ?? ""), row]));
    const jaById = new Map((jaPayload.body ?? []).map((row) => [String(row.MENU_ID ?? ""), row]));

    const menus = (koPayload.body ?? []).map((ko) => {
      const menuId = String(ko.MENU_ID ?? "");
      const en = enById.get(menuId);
      const ja = jaById.get(menuId);
      return {
        menuId,
        restaurantId: String(ko.RSTR_ID ?? en?.RSTR_ID ?? ja?.RSTR_ID ?? ""),
        restaurantNameKo: String(ko.RSTR_NM ?? ""),
        restaurantNameEn: String(en?.RSTR_NM ?? ""),
        restaurantNameJa: String(ja?.RSTR_NM ?? ""),
        nameKo: String(ko.MENU_NM ?? ""),
        nameEn: String(en?.MENU_NM ?? ""),
        nameJa: String(ja?.MENU_NM ?? ""),
        price: Number(ko.MENU_PRICE ?? en?.MENU_PRICE ?? ja?.MENU_PRICE ?? 0),
        isSpecialty: String(ko.SPCLT_MENU_YN ?? "N") === "Y",
      };
    }).filter((menu) => menu.menuId && menu.restaurantId);

    const restaurantMap = new Map<string, {
      restaurantId: string;
      nameKo: string;
      nameEn: string;
      nameJa: string;
      menus: typeof menus;
    }>();

    for (const menu of menus) {
      const current = restaurantMap.get(menu.restaurantId) ?? {
        restaurantId: menu.restaurantId,
        nameKo: menu.restaurantNameKo,
        nameEn: menu.restaurantNameEn,
        nameJa: menu.restaurantNameJa,
        menus: [],
      };
      current.menus.push(menu);
      restaurantMap.set(menu.restaurantId, current);
    }

    return NextResponse.json({
      pageNo,
      nextPage: menus.length ? pageNo + 1 : null,
      header: koPayload.header ?? null,
      restaurants: [...restaurantMap.values()],
      stats: {
        menuCount: menus.length,
        restaurantCount: restaurantMap.size,
        englishMatched: menus.filter((menu) => menu.nameEn).length,
        japaneseMatched: menus.filter((menu) => menu.nameJa).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "메뉴 데이터를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
