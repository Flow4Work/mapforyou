import { NextResponse } from "next/server";
import { searchKakaoPlaces } from "@/lib/kakao";
import type { SearchRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SearchRequest;
    if (!body.apiKey?.trim()) return NextResponse.json({ error: "카카오 REST API 키를 입력하세요." }, { status: 400 });
    if (!body.keyword?.trim()) return NextResponse.json({ error: "업종 또는 검색어를 입력하세요." }, { status: 400 });
    const result = await searchKakaoPlaces({
      ...body,
      apiKey: body.apiKey.trim(),
      keyword: body.keyword.trim(),
      targetCount: Math.min(Math.max(Number(body.targetCount) || 30, 1), 50),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "매장 후보 수집에 실패했습니다." },
      { status: 500 },
    );
  }
}
