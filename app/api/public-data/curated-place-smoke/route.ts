import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PLACE_ID = "31316692";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/api/public-data/curated-place/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: PLACE_ID }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null) as {
    preview?: {
      naverPlaceId?: string;
      name?: string;
      roadAddress?: string;
      phone?: string;
      latitude?: number | null;
      longitude?: number | null;
      instagramUrl?: string;
      officialWebsiteUrl?: string;
      menus?: Array<{ nameKo?: string; price?: number }>;
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
      phone: data.preview.phone,
      coordinates: [data.preview.latitude, data.preview.longitude],
      instagramUrl: data.preview.instagramUrl,
      officialWebsiteFound: Boolean(data.preview.officialWebsiteUrl),
      menuCount: data.preview.menus?.length ?? 0,
      menuSample: data.preview.menus?.slice(0, 5) ?? [],
      warnings: data.preview.warnings ?? [],
    } : null,
    error: data?.error ?? null,
  }, { status: response.ok ? 200 : response.status });
}
