import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";

const MAX_ROWS = 20_000;
const PAGE_SIZE = 1_000;

async function loadImageStatus() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase 환경변수가 연결되지 않았습니다.");

  const rows: Array<{ source_id: string; image_url: string | null }> = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("public_data_restaurants")
      .select("source_id, image_url")
      .range(start, start + PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  const missingIds = rows
    .filter((row) => !String(row.image_url ?? "").trim())
    .map((row) => String(row.source_id));

  return {
    total: rows.length,
    withImage: rows.length - missingIds.length,
    withoutImage: missingIds.length,
    missingIds,
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

    const body = (await request.json()) as { imagesByRestaurant?: Record<string, string> };
    const entries = Object.entries(body.imagesByRestaurant ?? {}).filter(([, imageUrl]) =>
      /^https?:\/\//i.test(String(imageUrl).trim()),
    );

    if (!entries.length) return NextResponse.json({ updated: 0 });

    const now = new Date().toISOString();
    let updated = 0;

    for (let index = 0; index < entries.length; index += 20) {
      const chunk = entries.slice(index, index + 20);
      const results = await Promise.all(
        chunk.map(([sourceId, imageUrl]) =>
          supabase
            .from("public_data_restaurants")
            .update({ image_url: imageUrl.trim(), updated_at: now })
            .eq("source_id", sourceId)
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
