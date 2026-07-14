import Link from "next/link";
import PublicDataTabs from "@/components/PublicDataTabs";
import { getSupabaseServerClient } from "@/lib/supabase";

export const metadata = { title: "이용 현황 | MapForYou" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SEOUL_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type AnalyticsEvent = {
  visitor_id: string;
  event_name: "page_view" | "search" | "store_select";
  language: "en" | "ja" | null;
  search_query: string | null;
  region: string | null;
  category: string | null;
  result_count: number | null;
  store_name: string | null;
  created_at: string;
};

function dateKey(value: string | number | Date) {
  return dateKeyFormatter.format(new Date(value));
}

function recentDateKeys(days: number) {
  return Array.from({ length: days }, (_, index) => {
    const offset = days - index - 1;
    return dateKey(Date.now() - offset * DAY_MS);
  });
}

function shortDateLabel(key: string) {
  const [, month, day] = key.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function searchLabel(event: AnalyticsEvent) {
  const query = event.search_query?.trim();
  if (query) return query;

  const region = event.region && event.region !== "all" ? event.region : "전체 지역";
  const category = event.category && event.category !== "all" ? event.category : "전체 카테고리";
  return `${region} · ${category}`;
}

function topCounts(values: string[], limit = 10) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit);
}

function MetricCard({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <article
      style={{
        padding: 20,
        border: "1px solid var(--line)",
        borderRadius: 18,
        background: "white",
        boxShadow: "0 10px 35px rgba(30,36,28,.035)",
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>{label}</span>
      <strong style={{ display: "block", marginTop: 10, fontSize: 32, letterSpacing: "-.04em" }}>
        {value.toLocaleString("ko-KR")}
      </strong>
      <small style={{ display: "block", marginTop: 7, color: "var(--muted)" }}>{note}</small>
    </article>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: string }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 28, color: "var(--muted)", textAlign: "center" }}>
        {children}
      </td>
    </tr>
  );
}

export default async function AnalyticsAdminPage() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return (
      <>
        <PublicDataTabs active="analytics" />
        <main style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 80px" }}>
          <section className="card">
            <h1 style={{ marginTop: 0 }}>이용 현황</h1>
            <p style={{ marginBottom: 0, color: "var(--muted)" }}>
              Supabase 환경변수가 없어 데이터를 불러오지 못했습니다.
            </p>
          </section>
        </main>
      </>
    );
  }

  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("analytics_events")
    .select(
      "visitor_id,event_name,language,search_query,region,category,result_count,store_name,created_at",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);

  const events = (data ?? []) as AnalyticsEvent[];
  const today = dateKey(Date.now());
  const sevenDayKeys = recentDateKeys(7);
  const sevenDaySet = new Set(sevenDayKeys);
  const lastSevenDays = events.filter((event) => sevenDaySet.has(dateKey(event.created_at)));
  const pageViews = lastSevenDays.filter((event) => event.event_name === "page_view");
  const searches = lastSevenDays.filter((event) => event.event_name === "search");
  const zeroResults = searches.filter((event) => event.result_count === 0);
  const storeSelections = lastSevenDays.filter((event) => event.event_name === "store_select");

  const todayVisitors = new Set(
    pageViews.filter((event) => dateKey(event.created_at) === today).map((event) => event.visitor_id),
  ).size;
  const sevenDayVisitors = new Set(pageViews.map((event) => event.visitor_id)).size;

  const dailyRows = sevenDayKeys.map((key) => {
    const dailyEvents = lastSevenDays.filter((event) => dateKey(event.created_at) === key);
    const dailySearches = dailyEvents.filter((event) => event.event_name === "search");
    return {
      key,
      visitors: new Set(
        dailyEvents.filter((event) => event.event_name === "page_view").map((event) => event.visitor_id),
      ).size,
      searches: dailySearches.length,
      zeroResults: dailySearches.filter((event) => event.result_count === 0).length,
      selections: dailyEvents.filter((event) => event.event_name === "store_select").length,
    };
  });

  const recentSearches = events.filter((event) => event.event_name === "search").slice(0, 20);
  const topZeroResults = topCounts(zeroResults.map(searchLabel));
  const topStores = topCounts(
    storeSelections.map((event) => event.store_name?.trim() || "이름 확인 필요"),
  );

  return (
    <>
      <PublicDataTabs active="analytics" />
      <main style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 80px" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 20,
            marginBottom: 22,
          }}
        >
          <div>
            <p className="eyebrow">ANONYMOUS ANALYTICS</p>
            <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.05em" }}>
              이용 현황
            </h1>
            <p style={{ margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.65 }}>
              익명 방문, 검색, 결과 없음, 식당 선택 기록만 표시합니다. 최근 30일 데이터를 불러와 핵심 수치는 최근
              7일 기준으로 계산합니다.
            </p>
          </div>
          <Link href="/admin/public-data/analytics" className="ghost-button" style={{ whiteSpace: "nowrap" }}>
            새로고침
          </Link>
        </header>

        {error ? (
          <div className="notice" style={{ marginBottom: 18, color: "#8b4a42", background: "#f5dfdc" }}>
            데이터를 불러오지 못했습니다: {error.message}
          </div>
        ) : null}

        <section
          aria-label="최근 7일 핵심 지표"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <MetricCard label="오늘 방문자" value={todayVisitors} note="브라우저 기준 익명 방문자" />
          <MetricCard label="7일 방문자" value={sevenDayVisitors} note="중복 제거한 익명 방문자" />
          <MetricCard label="7일 검색" value={searches.length} note="검색어·지역·카테고리 변경" />
          <MetricCard label="결과 0건" value={zeroResults.length} note="개선이 필요한 검색" />
          <MetricCard label="식당 선택" value={storeSelections.length} note="카드 또는 지도에서 선택" />
        </section>

        <section className="card">
          <div className="section-heading">
            <div>
              <span>DAILY</span>
              <h2>최근 7일 흐름</h2>
            </div>
            <p>한국 시간 기준</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>방문자</th>
                  <th>검색</th>
                  <th>결과 0건</th>
                  <th>식당 선택</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <strong>{shortDateLabel(row.key)}</strong>
                    </td>
                    <td>{row.visitors.toLocaleString("ko-KR")}</td>
                    <td>{row.searches.toLocaleString("ko-KR")}</td>
                    <td>{row.zeroResults.toLocaleString("ko-KR")}</td>
                    <td>{row.selections.toLocaleString("ko-KR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 18,
          }}
        >
          <article className="card" style={{ marginBottom: 0 }}>
            <div className="section-heading">
              <div>
                <span>ZERO RESULTS</span>
                <h2>결과가 없었던 검색</h2>
              </div>
              <p>최근 7일</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>검색 조건</th>
                    <th>횟수</th>
                  </tr>
                </thead>
                <tbody>
                  {topZeroResults.length ? (
                    topZeroResults.map(([label, count]) => (
                      <tr key={label}>
                        <td>
                          <strong>{label}</strong>
                        </td>
                        <td>{count.toLocaleString("ko-KR")}</td>
                      </tr>
                    ))
                  ) : (
                    <EmptyRow colSpan={2}>최근 7일 동안 결과 0건 검색이 없습니다.</EmptyRow>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card" style={{ marginBottom: 0 }}>
            <div className="section-heading">
              <div>
                <span>STORE PICKS</span>
                <h2>많이 선택한 식당</h2>
              </div>
              <p>최근 7일</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>식당</th>
                    <th>선택</th>
                  </tr>
                </thead>
                <tbody>
                  {topStores.length ? (
                    topStores.map(([name, count]) => (
                      <tr key={name}>
                        <td>
                          <strong>{name}</strong>
                        </td>
                        <td>{count.toLocaleString("ko-KR")}</td>
                      </tr>
                    ))
                  ) : (
                    <EmptyRow colSpan={2}>최근 7일 동안 식당 선택 기록이 없습니다.</EmptyRow>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="card" style={{ marginTop: 18 }}>
          <div className="section-heading">
            <div>
              <span>RECENT SEARCHES</span>
              <h2>최근 검색 기록</h2>
            </div>
            <p>최대 20건</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>시간</th>
                  <th>검색어</th>
                  <th>지역</th>
                  <th>카테고리</th>
                  <th>결과</th>
                  <th>언어</th>
                </tr>
              </thead>
              <tbody>
                {recentSearches.length ? (
                  recentSearches.map((event, index) => (
                    <tr key={`${event.created_at}-${event.visitor_id}-${index}`}>
                      <td>{dateTimeFormatter.format(new Date(event.created_at))}</td>
                      <td>
                        <strong>{event.search_query?.trim() || "검색어 없음"}</strong>
                      </td>
                      <td>{event.region === "all" || !event.region ? "전체" : event.region}</td>
                      <td>{event.category === "all" || !event.category ? "전체" : event.category}</td>
                      <td>
                        <span className={event.result_count === 0 ? "status-pill status-missing" : "status-pill status-found"}>
                          {event.result_count === null ? "확인 불가" : `${event.result_count.toLocaleString("ko-KR")}개`}
                        </span>
                      </td>
                      <td>{event.language === "ja" ? "일본어" : "영어"}</td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={6}>아직 검색 기록이 없습니다.</EmptyRow>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="fine-print" style={{ marginTop: 14 }}>
          방문자는 브라우저에 저장된 익명 ID 기준입니다. 쿠키·저장소 삭제 또는 다른 기기 사용 시 새 방문자로 집계될 수
          있으며, 분석 기능 배포 이전 기록은 포함되지 않습니다.
        </p>
      </main>
    </>
  );
}
