import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PLACE_IDS = [
  "2033165481", "1250194088", "1839704319", "1085945481", "2095769583",
  "2004674248", "2058698022", "2035211406", "1720159258", "1880446808",
  "1451521480", "1178938443", "1870682567", "2019126383", "1038370038",
  "1553249208", "1047950394", "1693026425", "1935471901", "1216172292",
];

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u003A/gi, ":");
}

function collectOfficialImages(html: string) {
  const decoded = decodeHtml(html);
  const ogImage = decoded.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
  const direct = decoded.match(/https?:\/\/ldb-phinf\.pstatic\.net\/[^\s"'<>\\]+/gi) ?? [];
  const cleaned = direct
    .map((value) => value.replace(/[),.;]+$/, ""))
    .filter((value) => !/(?:logo|icon|profile|thumb_default)/i.test(value));
  const images = [...new Set([ogImage, ...cleaned].filter(Boolean))].slice(0, 5);
  return { imageUrl: images[0] ?? "", gallery: images };
}

async function fetchImages(placeId: string) {
  const response = await fetch(`https://pcmap.place.naver.com/place/${placeId}/home`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
    },
  });
  const html = await response.text();
  return collectOfficialImages(html);
}

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 });

  const results: Array<{ placeId: string; images: number; saved: boolean; error?: string }> = [];
  for (let start = 0; start < PLACE_IDS.length; start += 4) {
    const batch = PLACE_IDS.slice(start, start + 4);
    const rows = await Promise.all(batch.map(async (placeId) => {
      try {
        const { imageUrl, gallery } = await fetchImages(placeId);
        if (!imageUrl) return { placeId, images: 0, saved: false, error: "no official image" };
        const { error } = await supabase.from("public_data_restaurants").update({
          image_url: imageUrl,
          image_gallery_urls: gallery,
          image_source: "naver_place",
          image_source_url: `https://map.naver.com/p/entry/place/${placeId}?placePath=/home`,
          image_attribution: "NAVER Place",
          updated_at: new Date().toISOString(),
        }).eq("source_id", `naver:${placeId}`);
        if (error) throw error;
        return { placeId, images: gallery.length, saved: true };
      } catch (error) {
        return { placeId, images: 0, saved: false, error: error instanceof Error ? error.message : "failed" };
      }
    }));
    results.push(...rows);
  }

  return NextResponse.json({ saved: results.filter((item) => item.saved).length, results });
}
