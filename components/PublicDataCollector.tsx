"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Menu = { menuId: string; nameKo: string; nameEn: string; nameJa: string; price: number; isSpecialty: boolean };
type Restaurant = { sourceId: string; name: string; roadAddress: string; address: string; latitude: string; longitude: string; phone: string; category: string; licenseType: string; introduction: string };
type RestaurantSet = Restaurant & { imageUrl: string; menus: Menu[]; savedAt: string };
type CollectResponse = { restaurants?: Restaurant[]; menusByRestaurant?: Record<string, Menu[]>; imagesByRestaurant?: Record<string, string>; nextPage?: number | null; stats?: { scannedTo: number; totalCount: number }; error?: string };

const TOKEN_KEY = "mapforyou-redtable-token";
const LOCAL_KEY = "mapforyou-public-restaurant-sets";

function readLocal(): RestaurantSet[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") as RestaurantSet[]; } catch { return []; }
}

function priceLabel(price: number) { return price > 0 ? `${price.toLocaleString("ko-KR")}원` : "가격 확인 필요"; }
function mergeMenus(current: Menu[], incoming: Menu[]) {
  const map = new Map(current.map((menu) => [menu.menuId, menu]));
  incoming.forEach((menu) => map.set(menu.menuId, menu));
  return [...map.values()];
}

export default function PublicDataCollector() {
  const [token, setToken] = useState("");
  const [regionKey, setRegionKey] = useState("seongsu");
  const [customRegion, setCustomRegion] = useState("");
  const [keyword, setKeyword] = useState("전체");
  const [targetCount, setTargetCount] = useState(20);
  const [sets, setSets] = useState<RestaurantSet[]>([]);
  const [latestIds, setLatestIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("DB 연결 확인 중");
  const [message, setMessage] = useState("");
  const [dbConnected, setDbConnected] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
    void loadDatabase();
  }, []);

  async function loadDatabase() {
    try {
      const response = await fetch("/api/public-data/sets", { cache: "no-store" });
      const data = await response.json() as { connected?: boolean; restaurants?: RestaurantSet[]; error?: string };
      if (!response.ok) throw new Error(data.error || "DB 조회 실패");
      const databaseSets = data.restaurants ?? [];
      const localSets = readLocal();
      const merged = new Map(localSets.map((store) => [store.sourceId, store]));
      databaseSets.forEach((store) => merged.set(store.sourceId, store));
      const values = [...merged.values()];
      localStorage.setItem(LOCAL_KEY, JSON.stringify(values));
      setSets(values);
      setSelectedId(values[0]?.sourceId ?? "");
      setDbConnected(Boolean(data.connected));
      setStage(data.connected ? "Supabase 연결 정상" : "브라우저 저장 모드");
    } catch (error) {
      const local = readLocal();
      setSets(local);
      setSelectedId(local[0]?.sourceId ?? "");
      setDbConnected(false);
      setStage("Supabase 연결 오류");
      setMessage(error instanceof Error ? error.message : "DB 연결을 확인하지 못했습니다.");
    }
  }

  const visible = useMemo(() => {
    if (!latestIds.length) return sets;
    const latest = new Set(latestIds);
    return sets.filter((store) => latest.has(store.sourceId));
  }, [latestIds, sets]);
  const selected = sets.find((store) => store.sourceId === selectedId) ?? visible[0] ?? null;

  async function collect(payload: Record<string, unknown>) {
    const response = await fetch("/api/redtable/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim(), ...payload }),
    });
    const data = await response.json() as CollectResponse;
    if (!response.ok) throw new Error(data.error || "공공데이터 수집 실패");
    return data;
  }

  function persistLocal(map: Map<string, RestaurantSet>, latest: string[]) {
    const values = [...map.values()];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(values));
    setSets(values);
    setLatestIds(latest);
  }

  async function saveDatabase(restaurants: RestaurantSet[], status: "completed" | "cancelled" | "failed" = "completed", errorMessage = "") {
    if (!restaurants.length) return;
    const response = await fetch("/api/public-data/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurants, regionKey, keyword, targetCount, status, errorMessage }),
    });
    const data = await response.json() as { saved?: number; error?: string };
    if (!response.ok) throw new Error(data.error || "Supabase 저장 실패");
    setDbConnected(true);
  }

  async function collectAll() {
    if (!token.trim()) { setMessage("서울관광재단 API 토큰을 입력하세요."); return; }
    sessionStorage.setItem(TOKEN_KEY, token.trim());
    cancelRef.current = false;
    setRunning(true); setProgress(2); setMessage(""); setLatestIds([]);

    const savedMap = new Map(sets.map((store) => [store.sourceId, store]));
    const candidates = new Map<string, Restaurant>();
    const candidateGoal = targetCount * 3;
    let latestComplete: string[] = [];

    try {
      setStage("조건에 맞는 가게 찾는 중");
      let restaurantPage: number | null = 1;
      let runs = 0;
      while (restaurantPage && candidates.size < candidateGoal && runs < 20 && !cancelRef.current) {
        const data = await collect({ mode: "restaurants", pageNo: restaurantPage, pagesPerBatch: 10, regionKey, customRegion, keyword, excludeIds: [...savedMap.keys()] });
        (data.restaurants ?? []).forEach((restaurant) => candidates.set(restaurant.sourceId, restaurant));
        restaurantPage = data.nextPage ?? null;
        runs += 1;
        setProgress(Math.min(30, 5 + runs * 2));
        setStage(`가게 후보 ${candidates.size}곳 확보`);
      }
      if (cancelRef.current) throw new Error("수집을 중지했습니다.");
      if (!candidates.size) throw new Error("조건에 맞는 가게를 찾지 못했습니다.");

      setStage("한·영·일 메뉴 연결 중");
      const candidateList = [...candidates.values()];
      const candidateIds = candidateList.map((restaurant) => restaurant.sourceId);
      const menus = new Map<string, Menu[]>();
      let menuPage: number | null = 1;
      let menuRuns = 0;

      while (menuPage && latestComplete.length < targetCount && menuRuns < 120 && !cancelRef.current) {
        const data = await collect({ mode: "menus", pageNo: menuPage, pagesPerBatch: 5, restaurantIds: candidateIds });
        Object.entries(data.menusByRestaurant ?? {}).forEach(([id, incoming]) => menus.set(id, mergeMenus(menus.get(id) ?? [], incoming)));
        latestComplete = candidateList.filter((restaurant) => (menus.get(restaurant.sourceId)?.length ?? 0) > 0).slice(0, targetCount).map((restaurant) => restaurant.sourceId);

        for (const id of latestComplete) {
          const restaurant = candidates.get(id);
          if (!restaurant) continue;
          savedMap.set(id, { ...restaurant, imageUrl: savedMap.get(id)?.imageUrl ?? "", menus: menus.get(id) ?? [], savedAt: new Date().toISOString() });
        }
        persistLocal(savedMap, latestComplete);

        if (latestComplete.length && menuRuns % 4 === 0) {
          await saveDatabase(latestComplete.map((id) => savedMap.get(id)!).filter(Boolean));
        }

        menuPage = data.nextPage ?? null;
        menuRuns += 1;
        const totalPages = data.stats?.totalCount ? Math.ceil(data.stats.totalCount / 1000) : 575;
        setProgress(Math.min(87, 32 + Math.round(((data.stats?.scannedTo ?? menuRuns * 5) / totalPages) * 55)));
        setStage(`메뉴 확인 ${latestComplete.length}/${targetCount}곳 · DB 자동 저장`);
      }
      if (cancelRef.current) throw new Error("수집을 중지했습니다.");
      if (!latestComplete.length) throw new Error("후보 가게에서 연결 가능한 메뉴를 찾지 못했습니다.");

      setStage("외관 이미지 연결 중"); setProgress(90);
      const images: Record<string, string> = {};
      let imagePage: number | null = 1;
      let imageRuns = 0;
      while (imagePage && imageRuns < 6 && !cancelRef.current) {
        const data = await collect({ mode: "images", pageNo: imagePage, pagesPerBatch: 10, restaurantIds: latestComplete });
        Object.assign(images, data.imagesByRestaurant ?? {});
        imagePage = data.nextPage ?? null;
        imageRuns += 1;
      }
      for (const id of latestComplete) {
        const current = savedMap.get(id);
        if (current) savedMap.set(id, { ...current, imageUrl: images[id] || current.imageUrl });
      }
      const completed = latestComplete.map((id) => savedMap.get(id)!).filter(Boolean);
      persistLocal(savedMap, latestComplete);
      await saveDatabase(completed);

      setSelectedId(latestComplete[0] ?? ""); setProgress(100); setStage("수집·DB 저장 완료");
      setMessage(`${completed.length}곳의 가게 정보와 다국어 메뉴판을 Supabase에 저장했습니다.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "통합 수집에 실패했습니다.";
      setMessage(text); setStage(cancelRef.current ? "수집 중지" : "수집 오류");
      const partial = latestComplete.map((id) => savedMap.get(id)!).filter(Boolean);
      if (partial.length) { try { await saveDatabase(partial, cancelRef.current ? "cancelled" : "failed", text); } catch {} }
    } finally { setRunning(false); }
  }

  async function resetSaved() {
    if (running) return;
    localStorage.removeItem(LOCAL_KEY);
    setSets([]); setLatestIds([]); setSelectedId(""); setProgress(0); setStage(dbConnected ? "Supabase 연결 정상" : "브라우저 저장 모드");
    setMessage("브라우저 표시 목록만 초기화했습니다. Supabase 데이터는 유지됩니다.");
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 24 }}>
        <div><p className="eyebrow">PUBLIC DATA ADMIN</p><h1 style={{ margin: "0 0 8px" }}>가게와 메뉴판 한 번에 수집</h1><p style={{ margin: 0, color: "var(--muted)" }}>공공데이터를 묶어 찾고 Supabase에 자동 저장합니다.</p></div>
        <Link className="ghost-button" href="/admin">기존 Admin</Link>
      </div>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="section-heading"><div><span>ONE CLICK</span><h2>수집 조건</h2></div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className={`dot ${dbConnected ? "online" : ""}`} /><strong>{dbConnected ? "Supabase 정상" : "DB 확인 필요"}</strong></div></div>
        <div className="form-grid">
          <label className="field field-wide"><span>서울관광재단 OPEN API 토큰</span><input type="password" value={token} onChange={(event) => { setToken(event.target.value); sessionStorage.setItem(TOKEN_KEY, event.target.value); }} placeholder="발급받은 토큰 붙여넣기" autoComplete="off" /><small>GitHub와 Supabase에는 저장하지 않습니다.</small></label>
          <label className="field"><span>지역</span><select value={regionKey} onChange={(event) => setRegionKey(event.target.value)} disabled={running}><option value="seongsu">성수·성동구</option><option value="hongdae">홍대·마포구</option><option value="geondae">건대·광진구</option><option value="custom">직접 입력</option></select></label>
          {regionKey === "custom" && <label className="field"><span>주소 포함어</span><input value={customRegion} onChange={(event) => setCustomRegion(event.target.value)} disabled={running} /></label>}
          <label className="field"><span>업태</span><select value={keyword} onChange={(event) => setKeyword(event.target.value)} disabled={running}>{["전체", "카페", "치킨", "삼겹살", "한식", "일식", "중식"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>한 번에 수집</span><select value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} disabled={running}><option value={10}>10곳</option><option value={20}>20곳</option></select></label>
        </div>
        <div className="action-row"><button className="primary-button" disabled={running} onClick={collectAll}>{running ? "자동 수집 중…" : sets.length ? `중복 제외 다음 ${targetCount}곳 수집` : `${targetCount}곳 한 번에 수집`}</button>{running && <button className="secondary-button" onClick={() => { cancelRef.current = true; }}>수집 중지</button>}<button className="ghost-button" disabled={running} onClick={() => void loadDatabase()}>DB 다시 불러오기</button><button className="text-button" disabled={running} onClick={() => void resetSaved()}>화면 초기화</button></div>
        <div style={{ marginTop: 18 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}><strong>{stage}</strong><span>{progress}%</span></div><div style={{ height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}><div style={{ width: `${progress}%`, height: "100%", background: "var(--green)", transition: "width .25s ease" }} /></div><p className="fine-print">수집 결과는 브라우저와 Supabase에 함께 저장됩니다.</p></div>
        {message && <div className="notice">{message}</div>}
      </section>

      <section className="card" style={{ padding: 24 }}>
        <div className="section-heading"><div><span>RESULT</span><h2>{latestIds.length ? `이번 수집 ${visible.length}곳` : `DB 저장 가게 ${sets.length}곳`}</h2></div>{latestIds.length > 0 && <button className="text-button" onClick={() => setLatestIds([])}>전체 보기</button>}</div>
        {!visible.length ? <div className="empty-state"><strong>아직 저장된 가게가 없습니다.</strong><span>조건을 선택하고 수집 버튼을 누르세요.</span></div> : <div style={{ display: "grid", gridTemplateColumns: "minmax(250px,.75fr) minmax(0,1.25fr)", gap: 18 }}>
          <div style={{ display: "grid", gap: 8, alignContent: "start", maxHeight: 720, overflowY: "auto" }}>{visible.map((store) => <button key={store.sourceId} onClick={() => setSelectedId(store.sourceId)} style={{ textAlign: "left", border: selected?.sourceId === store.sourceId ? "2px solid var(--green)" : "1px solid var(--line)", borderRadius: 14, padding: 14, background: "white" }}><strong>{store.name}</strong><div style={{ marginTop: 5, fontSize: 13, color: "var(--muted)" }}>{store.category || store.licenseType || "업태 미확인"} · 메뉴 {store.menus.length}개</div></button>)}</div>
          {selected && <article style={{ border: "1px solid var(--line)", borderRadius: 18, overflow: "hidden", background: "white" }}>{selected.imageUrl && <img src={selected.imageUrl} alt={`${selected.name} 외관`} onError={(event) => { event.currentTarget.style.display = "none"; }} style={{ width: "100%", height: 260, objectFit: "cover" }} />}<div style={{ padding: 22 }}><p className="eyebrow">STORE & MULTILINGUAL MENU</p><h3 style={{ margin: "0 0 8px", fontSize: 28 }}>{selected.name}</h3><div style={{ display: "grid", gap: 5, color: "var(--muted)", fontSize: 14, marginBottom: 24 }}><span>{selected.category || selected.licenseType || "업태 미확인"}</span><span>{selected.roadAddress || selected.address || "주소 없음"}</span><span>{selected.phone || "전화번호 없음"}</span></div><div style={{ display: "grid", gap: 14 }}>{selected.menus.map((menu) => <div key={menu.menuId} style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "space-between", gap: 18 }}><div><strong style={{ fontSize: 17 }}>{menu.nameKo || "메뉴명 없음"}{menu.isSpecialty ? " · 대표" : ""}</strong><div style={{ marginTop: 5, fontSize: 14, color: "var(--muted)" }}>{menu.nameEn || "영문 없음"}</div><div style={{ marginTop: 3, fontSize: 14, color: "var(--muted)" }}>{menu.nameJa || "일문 없음"}</div></div><strong style={{ whiteSpace: "nowrap" }}>{priceLabel(menu.price)}</strong></div>)}</div></div></article>}
        </div>}
      </section>
    </main>
  );
}
