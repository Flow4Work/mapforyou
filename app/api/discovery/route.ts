import { NextResponse } from "next/server";
import { loadDiscoveryRestaurantPage } from "@/lib/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function integerParam(value: string | null, fallback: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const offset = integerParam(url.searchParams.get("offset"), 0);
    const perRegion = integerParam(url.searchParams.get("perRegion"), 20);
    const page = await loadDiscoveryRestaurantPage({ offset, perRegion });

    return NextResponse.json(
      { stores: page.stores, nextOffset: page.nextOffset },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error("discovery pagination failed", error);
    return NextResponse.json({ error: "Discovery data unavailable" }, { status: 500 });
  }
}
