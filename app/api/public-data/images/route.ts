import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";

const MAX_ROWS = 20_000;
const PAGE_SIZE = 1_000;
const ACTIVE_REGIONS = new Set(["seongsu", "hongdae"]);

type ImageCandidate = {
  url?: string;
  source?: string;
  attribution?: string;
  sourceUrl?: string;
};

type ImageRow = {
  source_id: string;
  name: string;
  road_address: string | null;
  address: string | null;
  category: string | null;
  region_key: string | null;
  image_url: string | null;
  image_source: string | null;
};

async function loadImageStatus() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase 환경변수가 연결되지 않았습니다.");

  const rows: ImageRow[] = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("public_data_restaurants")
      .select("source_id,name,road_address,address,category,region_key,image_url,image_source")
      .in("region_key", [...ACTIVE_REGIONS])
      .order("updated_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as ImageRow[]));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  const missing = rows.filter((row) => !String(row.image_url ?? "").trim());
  const sourceCounts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.image_url) continue;
    const source = row.image_source || "legacy";
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }

  return {
    total: rows.length,
    withImage: rows.length - missing.length,
    withoutImage: missing.length,
    missingIds: missing.map((row) => String(row.source_id)),
    missingStores: missing.slice(0, 30).map((row) => ({
      sourceId: String(row.source_id),
      name: row.name,
      address: row.road_address || row.address || "",
      category: row.category || "",
      regionKey: row.region_key || "",
    })),
    sourceCounts,
  };
}

function normalizeCandidate(value: string | ImageCandidate): Required<ImageCandidate> | null {
  const candidate = typeof value === "string" ? { url: value, source: "redtable_restaurant" } : value;
  const url = String(candidate.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    url,
    source: String(candidate.source || "manual_authorized").trim(),
    attribution: String(candidate.attribution || "").trim(),
    sourceUrl: String(candidate.sourceUrl || "").trim(),
  };
}

export async function GET() {
  try {
    return NextResponse.json(await loadImageStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "사진 현황 조회 실패" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });

    const body = (await request.json()) as {
      imagesByRestaurant?: Record<string, string | ImageCandidate>;
    };
    const entries = Object.entries(body.imagesByRestaurant ?? {})
      .map(([sourceId, value]) => [sourceId, normalizeCandidate(value)] as const)
      .filter((entry): entry is readonly [string, Required<ImageCandidate>] => Boolean(entry[1]));

    if (!entries.length) return NextResponse.json({ updated: 0, ...(await loadImageStatus()) });

    const now = new Date().toISOString();
    let updated = 0;

    for (let index = 0; index < entries.length; index += 20) {
      const chunk = entries.slice(index, index + 20);
      const results = await Promise.all(
        chunk.map(([sourceId, image]) =>
          supabase
            .from("public_data_restaurants")
            .update({
              image_url: image.url,
              image_source: image.source,
              image_attribution: image.attribution || null,
              image_source_url: /^https?:\/\//i.test(image.sourceUrl) ? image.sourceUrl : null,
              image_checked_at: now,
              updated_at: now,
            })
            .eq("source_id", sourceId)
            .in("region_key", [...ACTIVE_REGIONS])
            .select("source_id"),
        ),
      );

      for (const result of results) {
        if (result.error) throw result.error;
        updated += result.data?.length ?? 0;
      }
    }

    return NextResponse.json({ updated, ...(await loadImageStatus()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "사진 저장 실패" },
      { status: 500 },
    );
  }
}
