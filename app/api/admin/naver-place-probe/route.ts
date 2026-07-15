import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unique(values: string[]) {
  return [...new Set(values)].slice(0, 20);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
  if (!query) return NextResponse.json({ error: "q is required" }, { status: 400 });

  const target = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
  const response = await fetch(target, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
  });
  const html = await response.text();
  const decoded = html
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");

  const placeIds = unique(
    [...decoded.matchAll(/(?:entry\/place\/|pcmap\.place\.naver\.com\/(?:restaurant|cafe|place|hospital|hairshop|nailshop|accommodation)\/)(\d+)/gi)]
      .map((match) => match[1])
      .filter(Boolean),
  );
  const entryUrls = unique(
    [...decoded.matchAll(/https?:\/\/[^"'<>\s]+(?:entry\/place\/|pcmap\.place\.naver\.com\/)[^"'<>\s]+/gi)]
      .map((match) => match[0]),
  );
  const instagramUrls = unique(
    [...decoded.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]+/gi)].map((match) => match[0]),
  );

  return NextResponse.json({
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type"),
    length: html.length,
    placeIds,
    entryUrls,
    instagramUrls,
    containsSearchIframe: /searchIframe/i.test(decoded),
    containsEntryIframe: /entryIframe/i.test(decoded),
    blocked: /captcha|자동입력|비정상적인 접근|접근이 제한|서비스 이용이 제한/i.test(decoded),
  });
}
