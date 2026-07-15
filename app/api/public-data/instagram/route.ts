import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_REGIONS = ["seongsu", "hongdae"] as const;
const API_KEY_SETTING_KEY = "foursquare_places_api_key";
const FOURSQUARE_API_VERSION = process.env.FOURSQUARE_API_VERSION?.trim() || "1970-01-01";
const MAX_BATCH_SIZE = 20;
const MAX_STATUS_ROWS = 100;
const SEARCH_RADIUS_METERS = 800;
const MATCH_THRESHOLD = 68;
const AUTO_VERIFY_THRESHOLD = 88;

const RESERVED_INSTAGRAM_PATHS = new Set([
  "about",
  "accounts",
  "challenge",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "legal",
  "p",
  "press",
  "privacy",
  "reel",
  "reels",
  "stories",
  "terms",
  "tv",
  "web",
]);

type RegionKey = (typeof ACTIVE_REGIONS)[number];

type RestaurantRow = {
  source_id: string;
  name: string;
  road_address: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  category: string | null;
  region_key: string | null;
  instagram_url: string | null;
  instagram_username: string | null;
  instagram_status: string | null;
  instagram_source: string | null;
  instagram_confidence: number | null;
  instagram_candidates: unknown;
  instagram_search_query: string | null;
  instagram_checked_at: string | null;
};

type FoursquarePlace = {
  fsq_id?: string;
  name?: string;
  distance?: number;
  tel?: string;
  website?: string;
  verified?: boolean;
  venue_reality_bucket?: string;
  geocodes?: { main?: { latitude?: number; longitude?: number } };
  location?: {
    address?: string;
    formatted_address?: string;
    locality?: string;
    region?: string;
  };
  social_media?: { instagram?: string };
};

type PlaceCandidate = {
  provider: "foursquare";
  fsqId: string;
  placeName: string;
  address: string;
  distance: number | null;
  score: number;
  reasons: string[];
  instagramUrl: string | null;
  instagramUsername: string | null;
  website: string | null;
  phone: string | null;
  verifiedPlace: boolean;
};

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function compact(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/&amp;/gi, "&")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function canonicalName(value: string) {
  return compact(
    value
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/(?:성수점|홍대점|연남점|서울숲점|본점|직영점|지점)$/g, ""),
  );
}

function nameTokens(value: string) {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/[\s·\-_/]+/)
    .map(compact)
    .filter((token) => token.length >= 2 && !["성수점", "홍대점", "본점", "직영점"].includes(token));
}

function normalizePhone(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function addressHints(value: string) {
  return [...new Set(
    value
      .split(/\s+/)
      .map((part) => compact(part))
      .filter((part) => part.length >= 2 && /(?:구|동|로|길|가)$/.test(part)),
  )];
}

function normalizeInstagramProfile(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  if (/^[a-z0-9._]{1,30}$/i.test(raw) && !RESERVED_INSTAGRAM_PATHS.has(raw.toLowerCase())) {
    const username = raw.toLowerCase();
    return { username, url: `https://www.instagram.com/${username}/` };
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    if (host !== "instagram.com") return null;
    const username = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
    if (!username || RESERVED_INSTAGRAM_PATHS.has(username)) return null;
    if (!/^[a-z0-9._]{1,30}$/.test(username)) return null;
    return { username, url: `https://www.instagram.com/${username}/` };
  } catch {
    return null;
  }
}

function scorePlace(row: RestaurantRow, place: FoursquarePlace) {
  const reasons: string[] = [];
  const sourceName = canonicalName(row.name);
  const placeName = canonicalName(place.name ?? "");
  const sourceTokens = nameTokens(row.name);
  const targetTokens = new Set(nameTokens(place.name ?? ""));
  let score = 0;

  if (sourceName && placeName && sourceName === placeName) {
    score += 55;
    reasons.push("상호명 일치");
  } else if (
    sourceName.length >= 3 &&
    placeName.length >= 3 &&
    (sourceName.includes(placeName) || placeName.includes(sourceName))
  ) {
    score += 42;
    reasons.push("상호명 대부분 일치");
  } else if (sourceTokens.length) {
    const overlap = sourceTokens.filter((token) => targetTokens.has(token)).length;
    const ratio = overlap / Math.max(sourceTokens.length, targetTokens.size, 1);
    const tokenScore = Math.round(ratio * 30);
    score += tokenScore;
    if (tokenScore >= 15) reasons.push("상호명 단어 일치");
  }

  const distance = Number.isFinite(place.distance) ? Number(place.distance) : null;
  if (distance !== null) {
    if (distance <= 40) {
      score += 25;
      reasons.push("40m 이내");
    } else if (distance <= 80) {
      score += 21;
      reasons.push("80m 이내");
    } else if (distance <= 150) {
      score += 15;
      reasons.push("150m 이내");
    } else if (distance <= 300) {
      score += 8;
      reasons.push("300m 이내");
    } else if (distance <= 500) {
      score += 3;
    } else {
      score -= 15;
      reasons.push("거리가 멂");
    }
  }

  const sourcePhone = normalizePhone(row.phone);
  const targetPhone = normalizePhone(place.tel);
  if (sourcePhone.length >= 8 && sourcePhone === targetPhone) {
    score += 25;
    reasons.push("전화번호 일치");
  }

  const sourceAddress = row.road_address || row.address || "";
  const targetAddress = place.location?.formatted_address || place.location?.address || "";
  const targetAddressCompact = compact(targetAddress);
  const hintMatches = addressHints(sourceAddress).filter((hint) => targetAddressCompact.includes(hint)).length;
  if (hintMatches) {
    score += Math.min(12, hintMatches * 4);
    reasons.push("주소 일부 일치");
  }

  if (place.verified) {
    score += 3;
    reasons.push("Foursquare 인증 장소");
  }
  if (["high", "veryhigh"].includes(String(place.venue_reality_bucket ?? "").toLowerCase())) score += 4;
  return { score: Math.max(0, Math.min(99, score)), reasons, distance };
}

function toCandidate(row: RestaurantRow, place: FoursquarePlace): PlaceCandidate {
  const scored = scorePlace(row, place);
  const profile = normalizeInstagramProfile(place.social_media?.instagram ?? "");
  return {
    provider: "foursquare",
    fsqId: String(place.fsq_id ?? ""),
    placeName: String(place.name ?? ""),
    address: String(place.location?.formatted_address || place.location?.address || ""),
    distance: scored.distance,
    score: scored.score,
    reasons: scored.reasons,
    instagramUrl: profile?.url ?? null,
    instagramUsername: profile?.username ?? null,
    website: /^https?:\/\//i.test(String(place.website ?? "")) ? String(place.website) : null,
    phone: String(place.tel ?? "") || null,
    verifiedPlace: Boolean(place.verified),
  };
}

async function loadApiKey() {
  const environmentKey = process.env.FOURSQUARE_API_KEY?.trim() ?? "";
  if (environmentKey) return environmentKey;
  const supabase = getSupabaseServerClient();
  if (!supabase) return "";
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", API_KEY_SETTING_KEY)
    .maybeSingle();
  if (error) throw error;
  return String(data?.value ?? "").trim();
}

async function foursquareSearch(row: RestaurantRow, apiKey: string) {
  if (typeof row.latitude !== "number" || typeof row.longitude !== "number") {
    return { query: row.name, candidates: [] as PlaceCandidate[] };
  }

  const url = new URL("https://api.foursquare.com/v3/places/search");
  url.searchParams.set("query", row.name);
  url.searchParams.set("ll", `${row.latitude},${row.longitude}`);
  url.searchParams.set("radius", String(SEARCH_RADIUS_METERS));
  url.searchParams.set("limit", "5");
  url.searchParams.set("sort", "DISTANCE");
  url.searchParams.set(
    "fields",
    "fsq_id,name,geocodes,location,distance,tel,website,social_media,verified,venue_reality_bucket",
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: apiKey,
      "X-Places-Api-Version": FOURSQUARE_API_VERSION,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { results?: FoursquarePlace[]; message?: string; error?: string }
    | null;

  if (!response.ok) {
    if (response.status === 401) throw new Error("Foursquare API Key 인증에 실패했습니다.");
    if (response.status === 403) throw new Error("Foursquare Places API 사용 권한이 없습니다.");
    if (response.status === 429) throw new Error("Foursquare API 호출 한도에 도달했습니다.");
    throw new Error(payload?.message || payload?.error || `Foursquare 검색 실패 HTTP ${response.status}`);
  }

  const candidates = (payload?.results ?? [])
    .map((place) => toCandidate(row, place))
    .sort((a, b) => b.score - a.score || (a.distance ?? 9999) - (b.distance ?? 9999));
  return { query: `${row.name} @ ${row.latitude},${row.longitude}`, candidates };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, () => runWorker()),
  );
  return results;
}

function normalizeCandidateList(value: unknown): PlaceCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object"))
    .map((candidate) => ({
      provider: "foursquare" as const,
      fsqId: String(candidate.fsqId ?? ""),
      placeName: String(candidate.placeName ?? ""),
      address: String(candidate.address ?? ""),
      distance:
        candidate.distance === null || candidate.distance === undefined || candidate.distance === ""
          ? null
          : Number.isFinite(Number(candidate.distance))
            ? Number(candidate.distance)
            : null,
      score: Number(candidate.score ?? 0),
      reasons: Array.isArray(candidate.reasons) ? candidate.reasons.map(String) : [],
      instagramUrl: candidate.instagramUrl ? String(candidate.instagramUrl) : null,
      instagramUsername: candidate.instagramUsername ? String(candidate.instagramUsername) : null,
      website: candidate.website ? String(candidate.website) : null,
      phone: candidate.phone ? String(candidate.phone) : null,
      verifiedPlace: Boolean(candidate.verifiedPlace),
    }));
}

function serializeRow(row: RestaurantRow) {
  return {
    sourceId: row.source_id,
    name: row.name,
    address: row.road_address || row.address || "",
    category: row.category || "",
    regionKey: row.region_key || "",
    instagramUrl: row.instagram_url,
    instagramUsername: row.instagram_username,
    instagramStatus: row.instagram_status || "unchecked",
    instagramSource: row.instagram_source,
    confidence: row.instagram_confidence,
    candidates: normalizeCandidateList(row.instagram_candidates),
    searchQuery: row.instagram_search_query,
    checkedAt: row.instagram_checked_at,
  };
}

function selectedRegions(region: string | null) {
  return ACTIVE_REGIONS.includes(region as RegionKey) ? [region as RegionKey] : [...ACTIVE_REGIONS];
}

const SELECT_FIELDS =
  "source_id,name,road_address,address,latitude,longitude,phone,category,region_key,instagram_url,instagram_username,instagram_status,instagram_source,instagram_confidence,instagram_candidates,instagram_search_query,instagram_checked_at";

async function loadStatus(region: string | null) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase 환경변수가 연결되지 않았습니다.");
  const regions = selectedRegions(region);
  const { data, error } = await supabase
    .from("public_data_restaurants")
    .select(SELECT_FIELDS)
    .in("region_key", regions)
    .order("instagram_checked_at", { ascending: false, nullsFirst: false })
    .limit(2_000);
  if (error) throw error;
  const rows = (data ?? []) as RestaurantRow[];
  const statusCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.instagram_status || "unchecked";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return {
    region: regions.length === 1 ? regions[0] : "all",
    total: rows.length,
    unchecked: statusCounts.unchecked ?? 0,
    candidate: statusCounts.candidate ?? 0,
    verified: statusCounts.verified ?? 0,
    notFound: statusCounts.not_found ?? 0,
    rejected: statusCounts.rejected ?? 0,
    rows: rows
      .filter((row) => row.instagram_status !== "unchecked" || row.instagram_checked_at)
      .slice(0, MAX_STATUS_ROWS)
      .map(serializeRow),
  };
}

export async function GET(request: Request) {
  try {
    const region = new URL(request.url).searchParams.get("region");
    return NextResponse.json(await loadStatus(region));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "인스타그램 현황 조회 실패" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Supabase 연결 없음" }, { status: 503 });
    const body = (await request.json()) as {
      action?: "scan" | "verify" | "manual" | "not_found" | "reject";
      region?: string;
      limit?: number;
      retry?: boolean;
      sourceId?: string;
      url?: string;
    };
    const action = body.action ?? "scan";
    const region = ACTIVE_REGIONS.includes(body.region as RegionKey) ? body.region! : "all";

    if (action === "scan") {
      const apiKey = await loadApiKey();
      if (!apiKey) {
        return NextResponse.json({ error: "Foursquare Places API Key를 먼저 저장해주세요." }, { status: 400 });
      }
      const limit = Math.min(Math.max(Number(body.limit) || MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
      const targetStatus = body.retry ? "not_found" : "unchecked";
      const { data, error } = await supabase
        .from("public_data_restaurants")
        .select(SELECT_FIELDS)
        .in("region_key", selectedRegions(region))
        .eq("instagram_status", targetStatus)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .order(body.retry ? "instagram_checked_at" : "created_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw error;
      const stores = (data ?? []) as RestaurantRow[];
      if (!stores.length) {
        return NextResponse.json({
          processed: 0,
          message: body.retry ? "재확인할 결과 없음 가게가 없습니다." : "미확인 가게가 없습니다.",
          ...(await loadStatus(region)),
        });
      }

      const processed = await mapWithConcurrency(stores, 4, async (store) => {
        const result = await foursquareSearch(store, apiKey);
        const reliable = result.candidates.filter((candidate) => candidate.score >= MATCH_THRESHOLD);
        const best = reliable[0] ?? null;
        const hasInstagram = Boolean(best?.instagramUrl && best.instagramUsername);
        const autoVerified = Boolean(hasInstagram && best && best.score >= AUTO_VERIFY_THRESHOLD);
        const now = new Date().toISOString();
        const status = autoVerified ? "verified" : hasInstagram ? "candidate" : "not_found";
        const source = autoVerified
          ? "foursquare_auto"
          : hasInstagram
            ? "foursquare_candidate"
            : best
              ? "foursquare_no_instagram"
              : "foursquare_unmatched";
        const { error: updateError } = await supabase
          .from("public_data_restaurants")
          .update({
            instagram_url: autoVerified ? best?.instagramUrl : null,
            instagram_username: autoVerified ? best?.instagramUsername : null,
            instagram_status: status,
            instagram_source: source,
            instagram_confidence: best?.score ?? null,
            instagram_candidates: result.candidates.slice(0, 5),
            instagram_search_query: result.query,
            instagram_checked_at: now,
            updated_at: now,
          })
          .eq("source_id", store.source_id);
        if (updateError) throw updateError;
        return { matched: Boolean(best), found: hasInstagram, autoVerified };
      });

      const matched = processed.filter((item) => item.matched).length;
      const found = processed.filter((item) => item.found).length;
      const autoVerified = processed.filter((item) => item.autoVerified).length;
      return NextResponse.json({
        processed: processed.length,
        matched,
        found,
        autoVerified,
        message: `${processed.length}곳 중 장소 ${matched}곳을 매칭했고, 인스타 ${found}곳을 찾았습니다. 높은 일치도 ${autoVerified}곳은 자동 확정했습니다.`,
        ...(await loadStatus(region)),
      });
    }

    const sourceId = body.sourceId?.trim() ?? "";
    if (!sourceId) return NextResponse.json({ error: "가게 ID가 없습니다." }, { status: 400 });
    const now = new Date().toISOString();
    if (action === "verify" || action === "manual") {
      const profile = normalizeInstagramProfile(body.url?.trim() ?? "");
      if (!profile) {
        return NextResponse.json({ error: "인스타그램 프로필 URL을 정확히 입력해주세요." }, { status: 400 });
      }
      const { error } = await supabase
        .from("public_data_restaurants")
        .update({
          instagram_url: profile.url,
          instagram_username: profile.username,
          instagram_status: "verified",
          instagram_source: action === "manual" ? "manual_verified" : "foursquare_verified",
          instagram_checked_at: now,
          updated_at: now,
        })
        .eq("source_id", sourceId)
        .in("region_key", [...ACTIVE_REGIONS]);
      if (error) throw error;
      return NextResponse.json({ saved: true, ...(await loadStatus(region)) });
    }

    const nextStatus = action === "reject" ? "rejected" : "not_found";
    const { error } = await supabase
      .from("public_data_restaurants")
      .update({
        instagram_url: null,
        instagram_username: null,
        instagram_status: nextStatus,
        instagram_checked_at: now,
        updated_at: now,
      })
      .eq("source_id", sourceId)
      .in("region_key", [...ACTIVE_REGIONS]);
    if (error) throw error;
    return NextResponse.json({ saved: true, ...(await loadStatus(region)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "인스타그램 처리 실패" },
      { status: 500 },
    );
  }
}
