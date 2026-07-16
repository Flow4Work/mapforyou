import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PLACE_ID = "31316692";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const previewResponse = await fetch(`${origin}/api/public-data/curated-place`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "preview",
      url: `https://pcmap.place.naver.com/place/${PLACE_ID}/home`,
    }),
    cache: "no-store",
  });
  const preview = await previewResponse.json().catch(() => null) as {
    preview?: {
      naverPlaceId?: string;
      name?: string;
      roadAddress?: string;
      phone?: string;
      instagramUrl?: string;
      officialWebsiteUrl?: string;
      menus?: unknown[];
      warnings?: string[];
    };
    error?: string;
  } | null;

  return NextResponse.json({
    ok: previewResponse.ok,
    status: previewResponse.status,
    result: preview?.preview ? {
      naverPlaceId: preview.preview.naverPlaceId,
      name: preview.preview.name,
      roadAddress: preview.preview.roadAddress,
      phone: preview.preview.phone,
      instagramFound: Boolean(preview.preview.instagramUrl),
      officialWebsiteFound: Boolean(preview.preview.officialWebsiteUrl),
      menuCount: preview.preview.menus?.length ?? 0,
      warnings: preview.preview.warnings ?? [],
    } : null,
    error: preview?.error ?? null,
  }, { status: previewResponse.ok ? 200 : previewResponse.status });
}
