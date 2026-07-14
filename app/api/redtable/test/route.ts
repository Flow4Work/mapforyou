import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const BASE_URL = "https://seoul.openapi.redtable.global";

export async function POST(request: Request) {
  try {
    const { token } = (await request.json()) as { token?: string };
    if (!token?.trim()) {
      return NextResponse.json({ error: "서울관광재단 API 토큰을 입력하세요." }, { status: 400 });
    }

    const url = new URL("/api/rstr", BASE_URL);
    url.searchParams.set("serviceKey", token.trim());
    url.searchParams.set("pageNo", "1");

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `OPEN API 응답 오류 (${response.status})` },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as {
      header?: {
        resultCode?: string;
        resultMsg?: string;
        numOfRows?: number;
        pageNo?: number;
        totalCount?: number;
      };
      body?: Array<Record<string, unknown>>;
    };

    if (payload.header?.resultCode && payload.header.resultCode !== "00") {
      return NextResponse.json(
        { error: payload.header.resultMsg || "토큰 인증에 실패했습니다." },
        { status: 401 },
      );
    }

    const samples = (payload.body ?? []).slice(0, 3).map((row) => ({
      id: String(row.RSTR_ID ?? ""),
      name: String(row.RSTR_NM ?? ""),
      roadAddress: String(row.RSTR_RDNMADR ?? ""),
      phone: String(row.RSTR_TELNO ?? ""),
      category: String(row.BSNS_STATM_BZCND_NM ?? row.BSNS_LCNC_NM ?? ""),
    }));

    return NextResponse.json({
      connected: true,
      header: payload.header ?? null,
      samples,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OPEN API 연결에 실패했습니다." },
      { status: 500 },
    );
  }
}
