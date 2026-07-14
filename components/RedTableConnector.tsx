"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Menu = {
  menuId: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  price: number;
  isSpecialty: boolean;
};

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

type RestaurantSet = Restaurant & {
  imageUrl: string;
  menus: Menu[];
  savedAt: string;
};

type CollectResponse = {
  restaurants?: Restaurant[];
  menusByRestaurant?: Record<string, Menu[]>;
  imagesByRestaurant?: Record<string, string>;
  nextPage?: number | null;
  stats?: { scannedFrom: number; scannedTo: number; totalCount: number };
  error?: string;
};

const TOKEN_KEY = "mapforyou-redtable-token";
const SAVED_KEY = "mapforyou-public-restaurant-sets";

function readSaved(): RestaurantSet[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]") as RestaurantSet[];
  } catch {
    return [];
  }
}

function priceLabel(price: number) {
  return price > 0 ? `${price.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function mergeMenus(current: Menu[], incoming: Menu[]) {
  const map = new Map(current.map((menu) => [menu.menuId, menu]));
  incoming.forEach((menu) => map.set(menu.menuId, menu));
  return [...map.values()];
}

export default function RedTableConnector() {
  const [token, setToken] = useState("");
  const [regionKey, setRegionKey] = useState("seongsu");
  const [customRegion, setCustomRegion] = useState("");
  const [keyword, setKeyword] = useState("전체");
  const [targetCount, setTargetCount] = useState(20);
  const [savedSets, setSavedSets] = useState<RestaurantSet[]>([]);
  const [latestIds, setLatestIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("수집 준비");
  const [message, setMessage] = useState("");
  const cancelRef = useRef(false);

  useEffect(() => {
    const initial = readSaved();
    setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
    setSavedSets(initial);
    setSelectedId(initial[0]?.sourceId ?? "");
  }, []);

  const visibleSets = useMemo(() => {
    if (!latestIds.length) return savedSets;
    const latest = new Set(latestIds);
    return savedSets.filter((store) => latest.has(store.sourceId));
  }, [latestIds, savedSets]);

  const selected = savedSets.find((store) => store.sourceId === selectedId) ?? visibleSets[0] ?? null;

  function saveToken(value: string) {
    setToken(value);
    sessionStorage.setItem(TOKEN_KEY, value);
  }

  async function callCollect(payload: Record<string, unknown>) {
    const response = await fetch("/api/redtable/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim(), ...payload }),
    });
    const data = (await response.json()) as CollectResponse;
    if (!response.ok) throw new Error(data.error || "데이터 수집에 실패했습니다.");
    return data;
  }

  function persist(map: Map<string, RestaurantSet>, latest: string[]) {
    const values = [...map.values()];
    localStorage.setItem(SAVED_KEY, JSON.stringify(values));
    setSavedSets(values);
    setLatestIds(latest);
  }

  async function collectAll() {
    if (!token.trim()) {
      setMessage("서울관광재단 API 토큰을 입력하세요.");
      return;
    }

    sessionStorage.setItem(TOKEN_KEY, token.trim());
    cancelRef.current = false;
    setRunning(true);
    setProgress(2);
    setMessage("");
    setLatestIds([]);

    const savedMap = new Map(readSaved().map((store) => [store.sourceId, store]));
    const excludeIds = [...savedMap.keys()];
    const candidates = new Map<string, Restaurant>();
    const candidateGoal = targetCount * 3;

    try {
      setStage("조건에 맞는 식당 찾는 중");
      let restaurantPage: number | null = 1;
      let restaurantRuns = 0;

      while (restaurantPage && candidates.size < candidateGoal && restaurantRuns < 20 && !cancelRef.current) {
        const data = await callCollect({
          mode: "restaurants",
          pageNo: restaurantPage,
          pagesPerBatch: 10,
          regionKey,
          customRegion,
          keyword,
          excludeIds,
        });
        (data.restaurants ?? []).forEach((restaurant) => candidates.set(restaurant.sourceId, restaurant));
        restaurantPage = data.nextPage ?? null;
        restaurantRuns += 1;
        setProgress(Math.min(30, 5 + restaurantRuns * 2));
        setStage(`식당 후보 ${candidates.size}곳 확보 · 계속 검색 중`);
      }

      if (cancelRef.current) throw new Error("수집을 중지했습니다.");
      if (!candidates.size) throw new Error("선택한 지역과 업태에 맞는 식당을 찾지 못했습니다.");

      setStage("식당별 한·영·일 메뉴 연결 중");
      setProgress(32);

      const candidateList = [...candidates.values()];
      const candidateIds = candidateList.map((restaurant) => restaurant.sourceId);
      const menus = new Map<string, Menu[]>();
      let menuPage: number | null = 1;
      let menuRuns = 0;
      let latestComplete: string[] = [];

      while (menuPage && latestComplete.length < targetCount && menuRuns < 120 && !cancelRef.current) {
        const data = await callCollect({
          mode: "menus",
          pageNo: menuPage,
          pagesPerBatch: 5,
          restaurantIds: candidateIds,
        });

        Object.entries(data.menusByRestaurant ?? {}).forEach(([restaurantId, incoming]) => {
          menus.set(restaurantId, mergeMenus(menus.get(restaurantId) ?? [], incoming));
        });

        latestComplete = candidateList
          .filter((restaurant) => (menus.get(restaurant.sourceId)?.length ?? 0) > 0)
          .slice(0, targetCount)
          .map((restaurant) => restaurant.sourceId);

        for (const restaurantId of latestComplete) {
          const restaurant = candidates.get(restaurantId);
          if (!restaurant) continue;
          const previous = savedMap.get(restaurantId);
          savedMap.set(restaurantId, {
            ...restaurant,
            imageUrl: previous?.imageUrl ?? "",
            menus: menus.get(restaurantId) ?? [],
            savedAt: new Date().toISOString(),
          });
        }
        persist(savedMap, latestComplete);

        menuPage = data.nextPage ?? null;
        menuRuns += 1;
        const totalPages = data.stats?.totalCount ? Math.ceil(data.stats.totalCount / 1000) : 575;
        const scannedTo = data.stats?.scannedTo ?? menuRuns * 5;
        setProgress(Math.min(87, 32 + Math.round((scannedTo / totalPages) * 55)));
        setStage(`메뉴가 확인된 식당 ${latestComplete.length}/${targetCount}곳 · 자동 저장됨`);
      }

      if (cancelRef.current) throw new Error("수집을 중지했습니다.");
      if (!latestComplete.length) throw new Error("후보 식당에서 연결 가능한 메뉴를 찾지 못했습니다.");

      setStage("외관 이미지 연결 중");
      setProgress(90);

      const images: Record<string, string> = {};
      let imagePage: number | null = 1;
      let imageRuns = 0;
      while (imagePage && imageRuns < 3 && !cancelRef.current) {
        const data = await callCollect({
          mode: "images",
          pageNo: imagePage,
          pagesPerBatch: 10,
          restaurantIds: latestComplete,
        });
        Object.assign(images, data.imagesByRestaurant ?? {});
        imagePage = data.nextPage ?? null;
        imageRuns += 1;
      }

      for (const restaurantId of latestComplete) {
        const current = savedMap.get(restaurantId);
        if (!current) continue;
        savedMap.set(restaurantId, { ...current, imageUrl: images[restaurantId] || current.imageUrl });
      }
      persist(savedMap, latestComplete);

      setSelectedId(latestComplete[0] ?? "");
      setProgress(100);
      setStage("수집 완료");
      setMessage(`${latestComplete.length}곳의 가게 정보와 다국어 메뉴판을 묶어 저장했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "통합 수집에 실패했습니다.");
      setStage("수집 중단");
    } finally {
      setRunning(false);
    }
  }

  function resetSaved() {
    if (running) return;
    localStorage.removeItem(SAVED_KEY);
    setSavedSets([]);
    setLatestIds([]);
    setSelectedId("");
    setProgress(0);
    setStage("수집 준비");
    setMessage("저장된 수집 결과를 초기화했습니다.");
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 24 }}>
        <div>
          <p className="eyebrow">PUBLIC DATA ADMIN</p>
          <h1 style={{ margin: "0 0 8px" }}>가게와 메뉴판 한 번에 수집</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>지역과 업태만 고르면 가게 정보·외관·한영일 메뉴를 하나로 묶습니다.</p>
        </div>
        <Link className="ghost-button" href="/admin">기존 Admin</Link>
      </div>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="section-heading">
          <div><span>ONE CLICK</span><h2>수집 조건</h2></div>
          <button className="text-button" disabled={running} onClick={resetSaved}>저장 결과 초기화</button>
        </div>

        <div className="form-grid">
          <label className="field field-wide">
            <span>서울관광재단 OPEN API 토큰</span>
            <input type="password" value={token} onChange={(event) => saveToken(event.target.value)} placeholder="발급받은 토큰 붙여넣기" autoComplete="off" />
            <small>GitHub에는 저장하지 않고 현재 브라우저 탭에서만 사용합니다.</small>
          </label>
          <label className="field">
            <span>지역</span>
            <select value={regionKey} onChange={(event) => setRegionKey(event.target.value)} disabled={running}>
              <option value="seongsu">성수·성동구</option>
              <option value="hongdae">홍대·마포구</option>
              <option value="geondae">건대·광진구</option>
              <option value="custom">직접 입력</option>
            </select>
          </label>
          {regionKey === "custom" && <label className="field"><span>주소 포함어</span><input value={customRegion} onChange={(event) => setCustomRegion(event.target.value)} placeholder="예: 종로구" disabled={running} /></label>}
          <label className="field">
            <span>업태</span>
            <select value={keyword} onChange={(event) => setKeyword(event.target.value)} disabled={running}>
              {["전체", "카페", "치킨", "삼겹살", "한식", "일식", "중식"].map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>한 번에 수집</span>
            <select value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} disabled={running}>
              <option value={10}>10곳</option>
              <option value={20}>20곳</option>
            </select>
          </label>
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={running} onClick={collectAll}>
            {running ? "자동 수집 중…" : savedSets.length ? `중복 제외 다음 ${targetCount}곳 수집` : `${targetCount}곳 한 번에 수집`}
          </button>
          {running && <button className="secondary-button" onClick={() => { cancelRef.current = true; }}>수집 중지</button>}
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, fontSize: 13 }}><strong>{stage}</strong><span>{progress}%</span></div>
          <div style={{ height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}><div style={{ width: `${progress}%`, height: "100%", background: "var(--green)", transition: "width .25s ease" }} /></div>
          <p className="fine-print">결과는 찾는 즉시 이 브라우저에 자동 저장됩니다. 화면을 닫아도 유지됩니다.</p>
        </div>
        {message && <div className="notice">{message}</div>}
      </section>

      <section className="card" style={{ padding: 24 }}>
        <div className="section-heading">
          <div><span>RESULT</span><h2>{latestIds.length ? `이번 수집 ${visibleSets.length}곳` : `저장된 가게 ${savedSets.length}곳`}</h2></div>
          {latestIds.length > 0 && <button className="text-button" onClick={() => setLatestIds([])}>전체 저장 목록 보기</button>}
        </div>

        {!visibleSets.length ? <div className="empty-state"><strong>아직 수집된 가게가 없습니다.</strong><span>조건을 고르고 한 번에 수집 버튼을 누르세요.</span></div> : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(250px, .75fr) minmax(0, 1.25fr)", gap: 18 }}>
            <div style={{ display: "grid", gap: 8, alignContent: "start", maxHeight: 720, overflowY: "auto", paddingRight: 4 }}>
              {visibleSets.map((store) => (
                <button key={store.sourceId} onClick={() => setSelectedId(store.sourceId)} style={{ textAlign: "left", border: selected?.sourceId === store.sourceId ? "2px solid var(--green)" : "1px solid var(--line)", borderRadius: 14, padding: 14, background: "white" }}>
                  <strong>{store.name}</strong>
                  <div style={{ marginTop: 5, fontSize: 13, color: "var(--muted)" }}>{store.category || store.licenseType || "업태 미확인"} · 메뉴 {store.menus.length}개</div>
                </button>
              ))}
            </div>

            {selected && (
              <article style={{ border: "1px solid var(--line)", borderRadius: 18, overflow: "hidden", background: "white" }}>
                {selected.imageUrl && <img src={selected.imageUrl} alt={`${selected.name} 외관`} onError={(event) => { event.currentTarget.style.display = "none"; }} style={{ display: "block", width: "100%", height: 260, objectFit: "cover" }} />}
                <div style={{ padding: 22 }}>
                  <p className="eyebrow">STORE & MULTILINGUAL MENU</p>
                  <h3 style={{ margin: "0 0 8px", fontSize: 28 }}>{selected.name}</h3>
                  <div style={{ display: "grid", gap: 5, color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
                    <span>{selected.category || selected.licenseType || "업태 미확인"}</span>
                    <span>{selected.roadAddress || selected.address || "주소 없음"}</span>
                    <span>{selected.phone || "전화번호 없음"}</span>
                  </div>

                  <div style={{ display: "grid", gap: 14 }}>
                    {selected.menus.map((menu) => (
                      <div key={menu.menuId} style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "space-between", gap: 18 }}>
                        <div>
                          <strong style={{ fontSize: 17 }}>{menu.nameKo || "메뉴명 없음"}{menu.isSpecialty ? " · 대표" : ""}</strong>
                          <div style={{ marginTop: 5, fontSize: 14, color: "var(--muted)" }}>{menu.nameEn || "영문 없음"}</div>
                          <div style={{ marginTop: 3, fontSize: 14, color: "var(--muted)" }}>{menu.nameJa || "일문 없음"}</div>
                        </div>
                        <strong style={{ whiteSpace: "nowrap" }}>{priceLabel(menu.price)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
