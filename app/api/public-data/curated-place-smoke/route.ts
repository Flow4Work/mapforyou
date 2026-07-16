import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PLACE_ID = "31316692";

function titleOf(html: string) {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function markerCount(html: string, pattern: RegExp) {
  return (html.match(pattern) ?? []).length;
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const candidates = [
    `https://map.naver.com/p/entry/place/${PLACE_ID}`,
    `https://m.place.naver.com/cafe/${PLACE_ID}/home`,
    `https://m.place.naver.com/restaurant/${PLACE_ID}/home`,
    `https://m.place.naver.com/place/${PLACE_ID}/home`,
    `https://pcmap.place.naver.com/cafe/${PLACE_ID}/home`,
    `https://pcmap.place.naver.com/restaurant/${PLACE_ID}/home`,
    `https://pcmap.place.naver.com/place/${PLACE_ID}/home`,
  ];

  const pages = [] as Array<Record<string, unknown>>;
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
          "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
          accept: "text/html,application/xhtml+xml",
        },
      });
      const html = (await response.text()).slice(0, 1_500_000);
      pages.push({
        requestedUrl: url,
        finalUrl: response.url,
        status: response.status,
        length: html.length,
        title: titleOf(html),
        hasPlaceId: html.includes(PLACE_ID),
        instagramMarkers: markerCount(html, /instagram\.com/gi),
        menuMarkers: markerCount(html, /메뉴|menu/gi),
        addressMarkers: markerCount(html, /도로명|주소|roadAddress/gi),
        nextData: html.includes("__NEXT_DATA__"),
      });
    } catch (error) {
      pages.push({ requestedUrl: url, error: error instanceof Error ? error.message : "fetch failed" });
    }
  }

  const previewResponse = await fetch(`${origin}/api/public-data/curated-place`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "preview", url: PLACE_ID }),
    cache: "no-store",
  });
  const preview = await previewResponse.json().catch(() => null);

  return NextResponse.json({ pages, currentPreview: preview });
}
