import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PLACE_ID = "31316692";

function snippets(html: string, pattern: RegExp, radius = 180, limit = 8) {
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const index = match.index ?? 0;
    values.push(html.slice(Math.max(0, index - radius), Math.min(html.length, index + match[0].length + radius)));
    if (values.length >= limit) break;
  }
  return values;
}

export async function GET() {
  const url = `https://pcmap.place.naver.com/place/${PLACE_ID}/home`;
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = (await response.text()).slice(0, 1_500_000).replace(/\\u002F/gi, "/").replace(/\\\//g, "/");

  return NextResponse.json({
    status: response.status,
    finalUrl: response.url,
    length: html.length,
    keys: {
      placeName: snippets(html, /(?:placeName|businessName|name)[\\\"']?\s*[:=]/gi),
      roadAddress: snippets(html, /roadAddress|도로명/gi),
      phone: snippets(html, /telephone|phone|전화/gi),
      instagram: snippets(html, /instagram\.com/gi),
      menu: snippets(html, /menuName|menu_name|메뉴/gi),
      price: snippets(html, /(?:price|가격)[\\\"']?\s*[:=]/gi),
      placeId: snippets(html, new RegExp(PLACE_ID, "g"), 120, 4),
    },
  });
}
