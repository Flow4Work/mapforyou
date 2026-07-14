import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

const ALLOWED_EVENTS = new Set(["page_view", "search", "store_select"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4_096) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const eventName = cleanText(body.eventName, 40);
    const visitorId = cleanText(body.visitorId, 36);
    const sessionId = cleanText(body.sessionId, 36);

    if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }
    if (!visitorId || !UUID_PATTERN.test(visitorId) || !sessionId || !UUID_PATTERN.test(sessionId)) {
      return NextResponse.json({ error: "Invalid visitor" }, { status: 400 });
    }

    const resultCount = typeof body.resultCount === "number" && Number.isInteger(body.resultCount) && body.resultCount >= 0
      ? body.resultCount
      : null;
    const language = body.language === "ja" ? "ja" : "en";
    const supabase = getSupabaseServerClient();

    if (!supabase) {
      return NextResponse.json({ error: "Analytics unavailable" }, { status: 503 });
    }

    const { error } = await supabase.from("analytics_events").insert({
      visitor_id: visitorId,
      session_id: sessionId,
      event_name: eventName,
      page_path: cleanText(body.pagePath, 200) ?? "/",
      language,
      search_query: cleanText(body.searchQuery, 200),
      region: cleanText(body.region, 80),
      category: cleanText(body.category, 80),
      result_count: resultCount,
      store_id: cleanText(body.storeId, 120),
      store_name: cleanText(body.storeName, 200),
    });

    if (error) {
      console.error("analytics insert failed", error.message);
      return NextResponse.json({ error: "Analytics unavailable" }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
