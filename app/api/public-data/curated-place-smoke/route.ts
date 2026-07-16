import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/api/public-data/curated-place`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "preview", url: "31316692" }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as {
    preview?: {
      naverPlaceId?: string;
      name?: string;
      roadAddress?: string;
      instagramUrl?: string;
      menus?: unknown[];
      warnings?: string[];
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
      warnings: data.preview.warnings ?? [],
    } : null,
    error: data?.error ?? null,
  }, { status: response.ok ? 200 : response.status });
}
