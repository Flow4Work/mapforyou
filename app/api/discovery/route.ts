import { NextResponse } from "next/server";
import { loadDiscoveryRestaurantPage } from "@/lib/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function integerParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const offset = integerParam(url.searchParams.get("offset"), 0);
    const perRegion = integerParam(url.searchParams.get("perRegion"), 20);
    const page = await loadDiscoveryRestaurantPage({ offset, perRegion });

    return NextResponse.json(page, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("discovery pagination failed", error);
    return NextResponse.json({ error: "Discovery data unavailable" }, { status: 500 });
  }
}
