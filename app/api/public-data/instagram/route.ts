import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_REGIONS = ["seongsu", "hongdae"] as const;
const CLIENT_ID_SETTING_KEY = "naver_search_client_id";
const CLIENT_SECRET_SETTING_KEY = "naver_search_client_secret";
const MAX_BATCH_SIZE = 10;
const MAX_STATUS_ROWS = 80;

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

type NaverItem = {
  title?: string;
  link?: string;
  description?: string;
};

type InstagramCandidate = {
  url: string;
  username: string;
  title: string;
  description: string;
  score: number;
  query: string;
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

function decodeText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string) {
  return decodeText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function normalizeInstagramProfile(value: string) {
  const raw = decodeText(value).trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;

  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    if (host !== "instagram.com") return null;

    const username = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
    if (!username || RESERVED_INSTAGRAM_PATHS.has(username)) return null;
    if (!/^[a-z0-9._]{1,30}$/.test(username)) return null;

    return {
      username,
      url: `https://www.instagram.com/${username}/`,
    };
  } catch {
    return null;
  }
}

function extractInstagramProfiles(item: NaverItem) {
  const values = [item.link ?? "", decodeText(item.title ?? ""), decodeText(item.description ?? "")];
  const profiles = new Map<string, { username: string; url: string }>();

  for (const value of values) {
    const direct = normalizeInstagramProfile(value);
    if (direct) profiles.set(direct.username, direct);

    const matches = value.match(/(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/[a-z0-9._]+/gi) ?? [];
    for (const match of matches) {
      const profile = normalizeInstagramProfile(match);
      if (profile) profiles.set(profile.username, profile);
    }
  }

  return [...profiles.values()];
}

function addressHints(row: RestaurantRow) {
  const address = row.road_address || row.address || "";
  const parts = address.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  const district = parts.find((part) => part.endsWith("구")) ?? "";
  const neighborhood = parts.find((part) => /(?:동|가)$/.test(part)) ?? "";
  const region = row.region_key === "seongsu" ? "성수" : row.region_key === "hongdae" ? "홍대" : "서울";
  return [...new Set([region, district, neighborhood])].filter(Boolean);
}

function buildQueries(row: RestaurantRow) {
  const hints = addressHints(row);
  const regionText = hints.slice(0, 2).join(" ");
  return [
    `${row.name} ${regionText} 인스타그램`.trim(),
    `site:instagram.com ${row.name} ${hints[0] ?? "서울"}`.trim(),
  ];
}

function scoreCandidate(
  row: RestaurantRow,
  item: NaverItem,
  profile: { username: string; url: string },
  query: string,
  rank: number,
  queryIndex: number,
) {
  const title = decodeText(item.title ?? "");
  const description = decodeText(item.description ?? "");
  const searchBlob = compact(`${title} ${description} ${profile.username}`);
  const normalizedName = compact(row.name);
  const nameTokens = decodeText(row.name)
    .split(/[\s·\-_/()[\]]+/)
    .map(compact)
    .filter((token) => token.length >= 2);

  let score = 18 + Math.max(0, 10 - rank);

  if (normalizedName.length >= 2 && searchBlob.includes(normalizedName)) {
    score += 46;
  } else {
    const matchedTokens = nameTokens.filter((token) => searchBlob.includes(token)).length;
    score += Math.min(28, matchedTokens * 14);
  }

  const hintMatches = addressHints(row).filter((hint) => searchBlob.includes(compact(hint))).length;
  score += Math.min(18, hintMatches * 9);

  if (/instagram|인스타그램/i.test(`${title} ${description}`)) score += 5;
  if (queryIndex === 0) score += 4;

  return Math.max(0, Math.min(99, score));
}

async function loadCredentials() {
  const envClientId = process.env.NAVER_CLIENT_ID?.trim() ?? "";
  const envClientSecret = process.env.NAVER_CLIENT_SECRET?.trim() ?? "";
  if (envClientId && envClientSecret) {
    return { clientId: envClientId, clientSecret: envClientSecret };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", [CLIENT_ID_SETTING_KEY, CLIENT_SECRET_SETTING_KEY]);

  if (error) throw error;

  const values = new Map((data ?? []).map((row) => [String(row.key), String(row.value ?? "")]));
  const clientId = values.get(CLIENT_ID_SETTING_KEY)?.trim() ?? "";
  const clientSecret = values.get(CLIENT_SECRET_SETTING_KEY)?.trim() ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function naverWebSearch(query: string, credentials: { clientId: string; clientSecret: string }) {
  const url = new URL("https://openapi.naver.com/v1/search/webkr.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", "10");
  url.searchParams.set("start", "1");

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": credentials.clientId,
      "X-Naver-Client-Secret": credentials.clientSecret,
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | { items?: NaverItem[]; errorMessage?: string; errorCode?: string }
    | null;

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("네이버 애플리케이션에 검색 API 권한이 없습니다. API 설정에서 ‘검색’을 추가해주세요.");
    }
    if (response.status === 429) {
      throw new Error("네이버 검색 API 호출 한도에 도달했습니다.");
    }
    throw new Error(payload?.errorMessage || payload?.errorCode || `네이버 검색 실패 HTTP ${response.status}`);
  }

  return payload?.items ?? [];
}

async function discoverCandidates(
  row: RestaurantRow,
  credentials: { clientId: string; clientSecret: string },
) {
  const queries = buildQueries(row);
  const candidates = new Map<string, InstagramCandidate>();
  const usedQueries: string[] = [];

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    usedQueries.push(query);
    const items = await naverWebSearch(query, credentials);

    items.forEach((item, rank) => {
      for (const profile of extractInstagramProfiles(item)) {
        const candidate: InstagramCandidate = {
          ...profile,
          title: decodeText(item.title ?? ""),
          description: decodeText(item.description ?? ""),
          score: scoreCandidate(row, item, profile, query, rank, queryIndex),
          query,
        };
        const previous = candidates.get(profile.username);
        if (!previous || candidate.score > previous.score) candidates.set(profile.username, candidate);
      }
    });

    if (candidates.size >= 3) break;
  }

  return {
    queries: usedQueries,
    candidates: [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 5),
  };
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

function normalizeCandidateList(value: unknown): InstagramCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is InstagramCandidate => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as Partial<InstagramCandidate>;
      return Boolean(item.url && item.username);
    })
    .map((candidate) => ({
      url: String(candidate.url),
      username: String(candidate.username),
      title: String(candidate.title ?? ""),
      description: String(candidate.description ?? ""),
      score: Number(candidate.score ?? 0),
      query: String(candidate.query ?? ""),
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

async function loadStatus(region: string | null) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase 환경변수가 연결되지 않았습니다.");

  const regions = selectedRegions(region);
  const { data, error } = await supabase
    .from("public_data_restaurants")
    .select(
      "source_id,name,road_address,address,category,region_key,instagram_url,instagram_username,instagram_status,instagram_source,instagram_confidence,instagram_candidates,instagram_search_query,instagram_checked_at",
    )
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

  const visible = rows
    .filter((row) => row.instagram_status !== "unchecked" || row.instagram_checked_at)
    .slice(0, MAX_STATUS_ROWS)
    .map(serializeRow);

  return {
    region: regions.length === 1 ? regions[0] : "all",
    total: rows.length,
    unchecked: statusCounts.unchecked ?? 0,
    candidate: statusCounts.candidate ?? 0,
    verified: statusCounts.verified ?? 0,
    notFound: statusCounts.not_found ?? 0,
    rejected: statusCounts.rejected ?? 0,
    rows: visible,
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
      const credentials = await loadCredentials();
      if (!credentials) {
        return NextResponse.json(
          { error: "네이버 검색 Client ID와 Client Secret을 먼저 저장해주세요." },
          { status: 400 },
        );
      }

      const limit = Math.min(Math.max(Number(body.limit) || MAX_BATCH_SIZE, 1), MAX_BATCH_SIZE);
      const targetStatus = body.retry ? "not_found" : "unchecked";
      let query = supabase
        .from("public_data_restaurants")
        .select(
          "source_id,name,road_address,address,category,region_key,instagram_url,instagram_username,instagram_status,instagram_source,instagram_confidence,instagram_candidates,instagram_search_query,instagram_checked_at",
        )
        .in("region_key", selectedRegions(region))
        .eq("instagram_status", targetStatus)
        .order(body.retry ? "instagram_checked_at" : "created_at", { ascending: true, nullsFirst: true })
        .limit(limit);

      const { data, error } = await query;
      if (error) throw error;
      const stores = (data ?? []) as RestaurantRow[];

      if (!stores.length) {
        return NextResponse.json({
          processed: 0,
          message: body.retry ? "다시 검색할 결과 없음 가게가 없습니다." : "미확인 가게가 없습니다.",
          ...(await loadStatus(region)),
        });
      }

      const processed = await mapWithConcurrency(stores, 3, async (store) => {
        const result = await discoverCandidates(store, credentials);
        const best = result.candidates[0] ?? null;
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("public_data_restaurants")
          .update({
            instagram_status: best ? "candidate" : "not_found",
            instagram_source: "naver_web",
            instagram_confidence: best?.score ?? null,
            instagram_candidates: result.candidates,
            instagram_search_query: result.queries.join(" | "),
            instagram_checked_at: now,
            updated_at: now,
          })
          .eq("source_id", store.source_id);

        if (updateError) throw updateError;
        return { sourceId: store.source_id, found: Boolean(best) };
      });

      const found = processed.filter((item) => item.found).length;
      return NextResponse.json({
        processed: processed.length,
        found,
        message: `${processed.length}곳을 검색해 ${found}곳에서 인스타 후보를 찾았습니다.`,
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
          instagram_source: action === "manual" ? "manual_verified" : "naver_web_verified",
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
