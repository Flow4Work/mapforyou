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
  stats?: { scannedFrom?: number; scannedTo?: number; totalCount?: number; excludedStoredCount?: number };
  error?: string;
};

type DatabaseResponse = {
  connected?: boolean;
  tokenConfigured?: boolean;
  totalCount?: number;
  restaurants?: RestaurantSet[];
  error?: string;
};

const LOCAL_KEY = "mapforyou-public-restaurant-sets";
const TOTAL_TARGET = 100;
const CHUNK_SIZE = 20;
const CHUNK_COUNT = TOTAL_TARGET / CHUNK_SIZE;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLocal(): RestaurantSet[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") as RestaurantSet[];
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

export default function PublicDataCollector() {
  const [regionKey, setRegionKey] = useState("seongsu");
  const [customRegion, setCustomRegion] = useState("");
  const [keyword, setKeyword] = useState("전체");
  const [sets, setSets] = useState<RestaurantSet[]>([]);
  const [latestIds, setLatestIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("DB 연결 확인 중");
  const [message, setMessage] = useState("");
  const [dbConnected, setDbConnected] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [dbTotalCount, setDbTotalCount] = useState(0);
  const cancelRef = useRef(false);

  useEffect(() => {
    void loadDatabase();
  }, []);

  async function loadDatabase(): Promise<RestaurantSet[]> {
    try {
      const response = await fetch("/api/public-data/sets", { cache: "no-store" });
      const data = (await response.json()) as DatabaseResponse;
      if (!response.ok) throw new Error(data.error || "DB 조회 실패");

      const databaseSets = data.restaurants ?? [];
      const merged = new Map(readLocal().map((store) => [store.sourceId, store]));
      databaseSets.forEach((store) => merged.set(store.sourceId, store));
      const values = [...merged.values()];

      localStorage.setItem(LOCAL_KEY, JSON.stringify(values));
      setSets(values);
      setSelectedId((current) => current || values[0]?.sourceId || "");
      setDbConnected(Boolean(data.connected));
      setTokenConfigured(Boolean(data.tokenConfigured));
      setDbTotalCount(Number(data.totalCount ?? databaseSets.length));
      setStage(data.connected ? "Supabase 연결 정상" : "브라우저 저장 모드");
      return values;
    } catch (error) {
      const local = readLocal();
      setSets(local);
      setSelectedId((current) => current || local[0]?.sourceId || "");
      setDbConnected(false);
      setStage("Supabase 연결 오류");
      setMessage(error instanceof Error ? error.message : "DB 연결을 확인하지 못했습니다.");
      return local;
    }
  }

  const visible = useMemo(() => {
    if (!latestIds.length) return sets;
    const latest = new Set(latestIds);
    return sets.filter((store) => latest.has(store.sourceId));
  }, [latestIds, sets]);

  const selected = sets.find((store) => store.sourceId === selectedId) ?? visible[0] ?? null;

  async function collect(payload: Record<string, unknown>) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch("/api/redtable/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as CollectResponse;

      if (response.status === 429 && attempt < 4) {
        const waitSeconds = [5, 10, 20, 30][attempt];
        setStage(`OPEN API 요청 제한 · ${waitSeconds}초 후 자동 재시도`);
        await sleep(waitSeconds * 1000);
        continue;
      }

      if (!response.ok) throw new Error(data.error || "공공데이터 수집 실패");
      return data;
    }
    throw new Error("OPEN API 요청 제한이 계속되고 있습니다.");
  }

  function persistLocal(map: Map<string, RestaurantSet>, latest: string[]) {
    const values = [...map.values()];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(values));
    setSets(values);
    setLatestIds(latest);
  }

  async function saveDatabase(
    restaurants: RestaurantSet[],
    status: "running" | "completed" | "cancelled" | "failed" = "running",
    errorMessage = "",
  ) {
    if (!restaurants.length) return;
    const response = await fetch("/api/public-data/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurants,
        regionKey,
        keyword,
        targetCount: TOTAL_TARGET,
        status,
        errorMessage,
      }),
    });
    const data = (await response.json()) as { saved?: number; error?: string };
    if (!response.ok) throw new Error(data.error || "Supabase 저장 실패");
    setDbConnected(true);
  }

  async function saveReadyChunk(
    ids: string[],
    candidates: Map<string, Restaurant>,
    menus: Map<string, Menu[]>,
    savedMap: Map<string, RestaurantSet>,
    collectedIds: Set<string>,
  ) {
    const now = new Date().toISOString();
    const chunk = ids.map((id) => {
      const restaurant = candidates.get(id)!;
      const store: RestaurantSet = {
        ...restaurant,
        imageUrl: savedMap.get(id)?.imageUrl ?? "",
        menus: menus.get(id) ?? [],
        savedAt: now,
      };
      savedMap.set(id, store);
      collectedIds.add(id);
      return store;
    });

    const latest = [...collectedIds];
    persistLocal(savedMap, latest);
    await saveDatabase(chunk, collectedIds.size >= TOTAL_TARGET ? "completed" : "running");
    setDbTotalCount((count) => count + chunk.length);
    setSelectedId((current) => current || ids[0] || "");
    setProgress(Math.min(92, 12 + Math.round((collectedIds.size / TOTAL_TARGET) * 80)));

    const batchNumber = Math.ceil(collectedIds.size / CHUNK_SIZE);
    setStage(`${batchNumber}/${CHUNK_COUNT} 묶음 저장 완료 · ${collectedIds.size}/${TOTAL_TARGET}곳`);

    if (collectedIds.size < TOTAL_TARGET) {
      const pause = 1500 + Math.floor(Math.random() * 501);
      await sleep(pause);
    }
  }

  async function enrichImages(
    targetIds: string[],
    savedMap: Map<string, RestaurantSet>,
  ) {
    if (!targetIds.length) return;
    setStage("저장된 가게의 외관 이미지 보강 중");
    setProgress(94);

    const found = new Map<string, string>();
    let imagePage: number | null = 1;
    let runs = 0;

    while (imagePage && found.size < targetIds.length && runs < 30 && !cancelRef.current) {
      const data = await collect({
        mode: "images",
        pageNo: imagePage,
        pagesPerBatch: 2,
        restaurantIds: targetIds,
      });
      for (const [id, url] of Object.entries(data.imagesByRestaurant ?? {})) {
        if (url) found.set(id, url);
      }
      imagePage = data.nextPage ?? null;
      runs += 1;
      await sleep(500);
    }

    const changed: RestaurantSet[] = [];
    for (const [id, imageUrl] of found) {
      const current = savedMap.get(id);
      if (!current || current.imageUrl === imageUrl) continue;
      const updated = { ...current, imageUrl, savedAt: new Date().toISOString() };
      savedMap.set(id, updated);
      changed.push(updated);
    }

    persistLocal(savedMap, targetIds);
    for (let index = 0; index < changed.length; index += CHUNK_SIZE) {
      await saveDatabase(changed.slice(index, index + CHUNK_SIZE), "running");
    }
  }

  async function collectAll() {
    cancelRef.current = false;
    setRunning(true);
    setProgress(1);
    setMessage("");
    setLatestIds([]);

    const fresh = await loadDatabase();
    const savedMap = new Map(fresh.map((store) => [store.sourceId, store]));
    const candidates = new Map<string, Restaurant>();
    const menus = new Map<string, Menu[]>();
    const collectedIds = new Set<string>();
    const candidateGoal = TOTAL_TARGET * 3;

    try {
      if (!dbConnected && !fresh.length) {
        setStage("Supabase 연결 확인 중");
      }

      setStage(`기존 DB ${dbTotalCount.toLocaleString()}곳 제외 · 새 가게 후보 검색 중`);
      let restaurantPage: number | null = 1;
      let restaurantRuns = 0;

      while (restaurantPage && candidates.size < candidateGoal && restaurantRuns < 100 && !cancelRef.current) {
        const data = await collect({
          mode: "restaurants",
          pageNo: restaurantPage,
          pagesPerBatch: 2,
          regionKey,
          customRegion,
          keyword,
          excludeIds: [...savedMap.keys()],
        });
        for (const restaurant of data.restaurants ?? []) {
          if (!savedMap.has(restaurant.sourceId)) candidates.set(restaurant.sourceId, restaurant);
        }
        restaurantPage = data.nextPage ?? null;
        restaurantRuns += 1;
        setProgress(Math.min(12, 2 + Math.round((candidates.size / candidateGoal) * 10)));
        setStage(`중복 제외 새 가게 후보 ${candidates.size}/${candidateGoal}곳`);
        await sleep(550);
      }

      if (cancelRef.current) throw new Error("수집을 중지했습니다.");
      if (!candidates.size) throw new Error("조건에 맞는 새로운 가게를 찾지 못했습니다.");

      const candidateList = [...candidates.values()];
      const candidateIds = candidateList.map((restaurant) => restaurant.sourceId);
      setStage(`후보 ${candidateIds.length}곳의 한·영·일 메뉴 연결 중`);

      let menuPage: number | null = 1;
      let menuRuns = 0;
      let tailPages = 0;

      while (menuPage && menuRuns < 700 && !cancelRef.current) {
        const data = await collect({
          mode: "menus",
          pageNo: menuPage,
          pagesPerBatch: 1,
          restaurantIds: candidateIds,
        });

        for (const [id, incoming] of Object.entries(data.menusByRestaurant ?? {})) {
          menus.set(id, mergeMenus(menus.get(id) ?? [], incoming));
          if (collectedIds.has(id)) {
            const current = savedMap.get(id);
            if (current) savedMap.set(id, { ...current, menus: menus.get(id) ?? current.menus });
          }
        }

        while (collectedIds.size < TOTAL_TARGET) {
          const readyIds = candidateList
            .filter((restaurant) => !collectedIds.has(restaurant.sourceId) && (menus.get(restaurant.sourceId)?.length ?? 0) > 0)
            .slice(0, Math.min(CHUNK_SIZE, TOTAL_TARGET - collectedIds.size))
            .map((restaurant) => restaurant.sourceId);

          if (readyIds.length < Math.min(CHUNK_SIZE, TOTAL_TARGET - collectedIds.size)) break;
          await saveReadyChunk(readyIds, candidates, menus, savedMap, collectedIds);
        }

        menuPage = data.nextPage ?? null;
        menuRuns += 1;
        setStage(`메뉴 탐색 중 · 완료 ${collectedIds.size}/${TOTAL_TARGET}곳 · API ${data.stats?.scannedTo ?? menuRuns}페이지`);
        await sleep(650);

        if (collectedIds.size >= TOTAL_TARGET) {
          tailPages += 1;
          if (tailPages >= 2) break;
        }
      }

      if (cancelRef.current) throw new Error("수집을 중지했습니다.");

      if (collectedIds.size < TOTAL_TARGET) {
        const partialIds = candidateList
          .filter((restaurant) => !collectedIds.has(restaurant.sourceId) && (menus.get(restaurant.sourceId)?.length ?? 0) > 0)
          .slice(0, TOTAL_TARGET - collectedIds.size)
          .map((restaurant) => restaurant.sourceId);
        if (partialIds.length) await saveReadyChunk(partialIds, candidates, menus, savedMap, collectedIds);
      }

      if (!collectedIds.size) throw new Error("후보 가게에서 연결 가능한 메뉴를 찾지 못했습니다.");

      const completedIds = [...collectedIds];
      const finalSets = completedIds.map((id) => {
        const current = savedMap.get(id)!;
        const updated = { ...current, menus: menus.get(id) ?? current.menus, savedAt: new Date().toISOString() };
        savedMap.set(id, updated);
        return updated;
      });
      await saveDatabase(finalSets, collectedIds.size >= TOTAL_TARGET ? "completed" : "failed");
      persistLocal(savedMap, completedIds);

      await enrichImages(completedIds, savedMap);
      await loadDatabase();

      setLatestIds(completedIds);
      setSelectedId(completedIds[0] ?? "");
      setProgress(100);
      setStage("100곳 자동 수집 완료");
      setMessage(
        collectedIds.size >= TOTAL_TARGET
          ? `새 가게 ${collectedIds.size}곳을 20곳씩 저장해 Supabase에 누적했습니다.`
          : `연결 가능한 새 가게 ${collectedIds.size}곳을 Supabase에 저장했습니다.`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : "통합 수집에 실패했습니다.";
      setMessage(text);
      setStage(cancelRef.current ? "수집 중지" : "수집 오류");

      const partial = [...collectedIds].map((id) => savedMap.get(id)!).filter(Boolean);
      if (partial.length) {
        try {
          await saveDatabase(partial, cancelRef.current ? "cancelled" : "failed", text);
        } catch {
          // 이미 저장된 묶음은 Supabase에 유지됩니다.
        }
      }
    } finally {
      setRunning(false);
    }
  }

  function resetDisplay() {
    if (running) return;
    localStorage.removeItem(LOCAL_KEY);
    setSets([]);
    setLatestIds([]);
    setSelectedId("");
    setProgress(0);
    setStage(dbConnected ? "Supabase 연결 정상" : "DB 확인 필요");
    setMessage("화면 표시만 초기화했습니다. Supabase 데이터는 유지됩니다.");
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 20px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 24 }}>
        <div>
          <p className="eyebrow">PUBLIC DATA ADMIN</p>
          <h1 style={{ margin: "0 0 8px" }}>새 가게 100곳 자동 수집</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>20곳씩 완성되는 즉시 Supabase에 저장하고, 잠깐 쉰 뒤 다음 묶음을 자동 진행합니다.</p>
        </div>
        <Link className="ghost-button" href="/admin">기존 Admin</Link>
      </div>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="section-heading">
          <div><span>ONE CLICK</span><h2>수집 조건</h2></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`dot ${dbConnected && tokenConfigured ? "online" : ""}`} />
            <strong>{dbConnected && tokenConfigured ? "DB·API 토큰 정상" : "연결 확인 필요"}</strong>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>지역</span>
            <select value={regionKey} onChange={(event) => setRegionKey(event.target.value)} disabled={running}>
              <option value="seongsu">성수·성동구</option>
              <option value="hongdae">홍대·마포구</option>
              <option value="geondae">건대·광진구</option>
              <option value="custom">직접 입력</option>
            </select>
          </label>
          {regionKey === "custom" && (
            <label className="field"><span>주소 포함어</span><input value={customRegion} onChange={(event) => setCustomRegion(event.target.value)} disabled={running} /></label>
          )}
          <label className="field">
            <span>업태</span>
            <select value={keyword} onChange={(event) => setKeyword(event.target.value)} disabled={running}>
              {["전체", "카페", "치킨", "삼겹살", "한식", "일식", "중식"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>자동 수집 단위</span>
            <input readOnly value="총 100곳 · 20곳 × 5회" />
            <small>이미 Supabase에 저장된 가게는 자동 제외합니다.</small>
          </label>
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={running || !dbConnected || !tokenConfigured} onClick={collectAll}>
            {running ? "100곳 자동 수집 중…" : "중복 제외 새 가게 100곳 수집"}
          </button>
          {running && <button className="secondary-button" onClick={() => { cancelRef.current = true; }}>안전하게 중지</button>}
          <button className="ghost-button" disabled={running} onClick={() => void loadDatabase()}>DB 다시 불러오기</button>
          <button className="text-button" disabled={running} onClick={resetDisplay}>화면 초기화</button>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
            <strong>{stage}</strong><span>{progress}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "var(--green)", transition: "width .25s ease" }} />
          </div>
          <p className="fine-print">현재 Supabase 누적 {dbTotalCount.toLocaleString()}곳 · 새 정보는 20곳 단위로 즉시 저장됩니다.</p>
        </div>
        {message && <div className="notice">{message}</div>}
      </section>

      <section className="card" style={{ padding: 24 }}>
        <div className="section-heading">
          <div><span>RESULT</span><h2>{latestIds.length ? `이번 수집 ${visible.length}곳` : `DB 표시 가게 ${sets.length}곳`}</h2></div>
          {latestIds.length > 0 && <button className="text-button" onClick={() => setLatestIds([])}>전체 DB 목록 보기</button>}
        </div>

        {!visible.length ? (
          <div className="empty-state"><strong>아직 표시할 가게가 없습니다.</strong><span>자동 수집 버튼을 누르면 20곳씩 나타납니다.</span></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(250px, .75fr) minmax(0, 1.25fr)", gap: 18 }}>
            <div style={{ display: "grid", gap: 8, alignContent: "start", maxHeight: 720, overflowY: "auto", paddingRight: 4 }}>
              {visible.map((store) => (
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
