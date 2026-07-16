import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/api/public-data/curated-place/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://naver.me/xxY2USDZ" }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => null) as {
    preview?: {
      naverPlaceId?: string;
      name?: string;
      roadAddress?: string;
      instagramUrl?: string;
      menus?: unknown[];
    };
    error?: string;
  } | null;

  return NextResponse.json({
    ok: response.ok,
    status: response.status,
    result: data?.preview ? {
      naverPlaceId: data.preview.naverPlaceId,
      name: data.preview.name,
      roadAddress: data.preview.roadAddress,
      instagramFound: Boolean(data.preview.instagramUrl),
      menuCount: data.preview.menus?.length ?? 0,
    } : null,
    error: data?.error ?? null,
  }, { status: response.ok ? 200 : response.status });
}
