import { NextResponse } from "next/server";
import { inspectKakaoMenu } from "@/lib/menu-inspector";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { placeUrl } = (await request.json()) as { placeUrl?: string };
    if (!placeUrl || !/^https?:\/\//.test(placeUrl)) {
      return NextResponse.json({ error: "유효한 카카오맵 상세 링크가 필요합니다." }, { status: 400 });
    }
    return NextResponse.json(await inspectKakaoMenu(placeUrl));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "메뉴 검사에 실패했습니다." },
      { status: 500 },
    );
  }
}
