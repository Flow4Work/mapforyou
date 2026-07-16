import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u003A/gi, ":");
}

function imageCandidates(html: string) {
  const decoded = decodeHtml(html);
  const matches = decoded.match(/https?:\/\/[^\s"'<>\\]+/gi) ?? [];
  const values = matches
    .map((value) => value.replace(/[),.;]+$/, ""))
    .filter((value) => /(?:pstatic\.net|naver\.net)/i.test(value))
    .filter((value) => !/(?:map|marker|sprite|favicon|logo|icon|profile|thumb_default)/i.test(value))
    .filter((value) => /(?:ldb-phinf|search\.pstatic|blogfiles|postfiles|mblogthumb)/i.test(value));
  return [...new Set(values)].slice(0, 80);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId")?.replace(/\D/g, "") ?? "";
  if (!/^\d{5,}$/.test(placeId)) return NextResponse.json({ error: "placeId required" }, { status: 400 });
  const response = await fetch(`https://pcmap.place.naver.com/place/${placeId}/home`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
    },
  });
  const html = await response.text();
  const ogImage = decodeHtml(html).match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
  return NextResponse.json({ placeId, status: response.status, bytes: html.length, ogImage, candidates: imageCandidates(html) });
}
