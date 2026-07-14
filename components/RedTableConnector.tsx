"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Restaurant = {
  sourceId: string;
  name: string;
  roadAddress: string;
  address: string;
  latitude: string;
  longitude: string;
  phone: string;
  category: string;
  licenseType: string;
  introduction: string;
};

type TestResult = {
  connected?: boolean;
  header?: { totalCount?: number; numOfRows?: number; resultMsg?: string };
  samples?: Array<{ id: string; name: string; roadAddress: string; phone: string; category: string }>;
  error?: string;
};

type ImportResult = {
  restaurants?: Restaurant[];
  nextPage?: number | null;
  stats?: {
    startPage: number;
    lastPage: number;
    scannedPages: number;
    rawCount: number;
    matchedCount: number;
    totalCount: number;
  };
  error?: string;
};

const TOKEN_KEY = "mapforyou-redtable-token";

export default function RedTableConnector() {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(true);
  const [regionKey, setRegionKey] = useState("seongsu");
  const [customRegion, setCustomRegion] = useState("");
  const [keyword, setKeyword] = useState("전체");
  const [pageNo, setPageNo] = useState(1);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [stats, setStats] = useState<ImportResult["stats"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
  }, []);

  const uniqueRestaurants = useMemo(() => {
    const map = new Map<string, Restaurant>();
    restaurants.forEach((restaurant) => map.set(restaurant.sourceId, restaurant));
    return [...map.values()];
  }, [restaurants]);

  function saveToken(value: string) {
    setToken(value);
    if (remember) sessionStorage.setItem(TOKEN_KEY, value);
  }

  async function testConnection() {
    if (!token.trim()) {
      setMessage("API 토큰을 입력하세요.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      if (remember) sessionStorage.setItem(TOKEN_KEY, token.trim());
      const response = await fetch("/api/redtable/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = (await response.json()) as TestResult;
      if (!response.ok) throw new Error(data.error || "연결에 실패했습니다.");
      setTestResult(data);
      setMessage(`연결 성공 · 식당 기본정보 ${Number(data.header?.totalCount || 0).toLocaleString()}건`);
    } catch (error) {
      setTestResult(null);
      setMessage(error instanceof Error ? error.message : "연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function importBatch(reset = false) {
    if (!token.trim()) {
      setMessage("API 토큰을 입력하세요.");
      return;
    }
    const requestPage = reset ? 1 : pageNo;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/redtable/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          pageNo: requestPage,
          pagesPerBatch: 5,
          regionKey,
          customRegion,
          keyword,
          excludeIds: reset ? [] : uniqueRestaurants.map((restaurant) => restaurant.sourceId),
        }),
      });
      const data = (await response.json()) as ImportResult;
      if (!response.ok) throw new Error(data.error || "데이터 수집에 실패했습니다.");
      setRestaurants((current) => reset ? (data.restaurants ?? []) : [...current, ...(data.restaurants ?? [])]);
      setPageNo(data.nextPage ?? requestPage);
      setStats(data.stats ?? null);
      setMessage(data.nextPage
        ? `${data.stats?.scannedPages ?? 0}페이지를 확인해 ${data.restaurants?.length ?? 0}곳을 찾았습니다.`
        : `마지막 페이지까지 확인했습니다. ${data.restaurants?.length ?? 0}곳을 찾았습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "데이터 수집에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setRestaurants([]);
    setPageNo(1);
    setStats(null);
    setMessage("목록과 페이지 진행 상태를 초기화했습니다.");
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 24 }}>
        <div>
          <p className="eyebrow">PUBLIC DATA ADMIN</p>
          <h1 style={{ margin: "0 0 8px" }}>서울 음식관광 OPEN API</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>공식 공공데이터에서 식당 기본정보를 수집하고, 이후 한·영·일 메뉴를 연결합니다.</p>
        </div>
        <Link className="ghost-button" href="/admin">기존 Admin</Link>
      </div>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="section-heading"><div><span>STEP 1</span><h2>토큰 연결</h2></div></div>
        <div className="form-grid">
          <label className="field field-wide">
            <span>서울관광재단 OPEN API 토큰</span>
            <input type="password" value={token} onChange={(event) => saveToken(event.target.value)} placeholder="발급받은 토큰 붙여넣기" autoComplete="off" />
            <small>GitHub와 데이터베이스에는 저장하지 않습니다. 현재 브라우저 탭에서만 사용합니다.</small>
          </label>
          <label className="check-line"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> 이 탭에서 토큰 기억</label>
        </div>
        <button className="primary-button" disabled={loading} onClick={testConnection}>{loading ? "확인 중…" : "연결 테스트"}</button>
        {testResult?.samples?.length ? (
          <div style={{ marginTop: 18, display: "grid", gap: 8 }}>
            {testResult.samples.map((sample) => <div key={sample.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, background: "white" }}><strong>{sample.name}</strong><div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{sample.roadAddress || "주소 없음"}</div></div>)}
          </div>
        ) : null}
      </section>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="section-heading"><div><span>STEP 2</span><h2>식당 기본정보 수집</h2></div><button className="text-button" onClick={reset}>초기화</button></div>
        <div className="form-grid">
          <label className="field"><span>지역</span><select value={regionKey} onChange={(event) => { setRegionKey(event.target.value); reset(); }}><option value="seongsu">성수·성동구</option><option value="hongdae">홍대·마포구</option><option value="geondae">건대·광진구</option><option value="custom">직접 입력</option></select></label>
          {regionKey === "custom" && <label className="field"><span>주소 포함어</span><input value={customRegion} onChange={(event) => setCustomRegion(event.target.value)} placeholder="예: 종로구" /></label>}
          <label className="field"><span>업종·검색어</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="전체, 카페, 치킨 등" /><small>공식 업태·상호·소개 문구에서 검사합니다.</small></label>
          <label className="field"><span>다음 시작 페이지</span><input value={pageNo} readOnly /></label>
        </div>
        <div className="action-row">
          <button className="primary-button" disabled={loading} onClick={() => importBatch(true)}>처음부터 5페이지</button>
          <button className="secondary-button" disabled={loading} onClick={() => importBatch(false)}>다음 5페이지</button>
        </div>
        {message && <div className="notice">{message}</div>}
        {stats && <p className="fine-print">전체 {stats.totalCount.toLocaleString()}건 · 이번 원본 {stats.rawCount.toLocaleString()}건 · 조건 일치 {stats.matchedCount}건 · 확인 페이지 {stats.startPage}~{stats.lastPage}</p>}
      </section>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="section-heading"><div><span>RESULT</span><h2>수집된 식당 {uniqueRestaurants.length}곳</h2></div></div>
        {!uniqueRestaurants.length ? <div className="empty-state"><strong>아직 수집된 식당이 없습니다.</strong><span>연결 테스트 후 지역 데이터를 불러오세요.</span></div> : (
          <div className="table-wrap"><table><thead><tr><th>식당</th><th>업태</th><th>전화</th><th>공공 ID</th></tr></thead><tbody>{uniqueRestaurants.map((restaurant) => <tr key={restaurant.sourceId}><td><strong>{restaurant.name}</strong><small>{restaurant.roadAddress || restaurant.address}</small></td><td>{restaurant.category || restaurant.licenseType || "-"}</td><td>{restaurant.phone || "-"}</td><td>{restaurant.sourceId}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="card" style={{ padding: 24 }}>
        <div className="section-heading"><div><span>NEXT</span><h2>메뉴 연결 방식</h2></div></div>
        <p style={{ lineHeight: 1.7, color: "var(--muted)", margin: 0 }}>메뉴 API는 한·영·일 각각 수십만 건을 페이지 단위로 제공해서 매번 실시간 검색하면 느립니다. Supabase 연결 후 한 번에 적재하고, 식당 ID와 메뉴 ID로 연결하는 방식으로 붙입니다. 현재 화면은 토큰과 식당 기본정보 수집이 실제로 작동하는지 먼저 검증하는 단계입니다.</p>
      </section>
    </main>
  );
}
