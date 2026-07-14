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
  matchedPages?: number[];
  nextPage?: number | null;
  stats?: {
    scannedFrom?: number;
    scannedTo?: number;
    totalCount?: number;
    excludedStoredCount?: number;
  };
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
const API_PAGE_SIZE = 1000;

function readLocal(): RestaurantSet[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") as RestaurantSet[];
  } catch {
    return [];
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function priceLabel(price: number) {
  return price > 0 ? `${price.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function mergeMenus(current: Menu[], incoming: Menu[]) {
  const map = new Map(current.map((menu) => [menu.menuId, menu]));
  for (const menu of incoming) {
    const previous = map.get(menu.menuId);
    map.set(menu.menuId, {
      ...previous,
      ...menu,
      nameKo: menu.nameKo || previous?.nameKo || "",
      nameEn: menu.nameEn || previous?.nameEn || "",
      nameJa: menu.nameJa || previous?.nameJa || "",
      price: menu.price || previous?.price || 0,
      isSpecialty: menu.isSpecialty || previous?.isSpecialty || false,
    });
  }
  return [...map.values()];
}

function buildScope(regionKey: string, customRegion: string, keyword: string) {
  const region = regionKey === "custom" ? customRegion.trim() || "custom" : regionKey;
  return `${region}:${keyword}`.toLowerCase().replace(/\s+/g, "_");
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
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadDatabase();
    return () => controllerRef.current?.abort();
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

  async function collect(payload: Record<string, unknown>, signal: AbortSignal): Promise<CollectResponse> {
    const response = await fetch("/api/redtable/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const data = (await response.json()) as CollectResponse;

    if (response.status === 429) {
      throw new Error("OPEN API 한도가 초과됐습니다. 위에서 다른 API KEY로 교체한 뒤 다시 실행해주세요.");
    }
    if (!response.ok) throw new Error(data.error || "공공데이터 수집 실패");
    return data;
  }

  async function loadScanPage(scope: string) {
    try {
      const response = await fetch(`/api/redtable/scan-state?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
      const data = (await response.json()) as { page?: number };
      return response.ok ? Math.max(Number(data.page) || 1, 1) : 1;
    } catch {
      return 1;
    }
  }

  async function saveScanPage(scope: string, page: number) {
    try {
      await fetch("/api/redtable/scan-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, page: Math.max(page, 1) }),
      });
    } catch {
      // 검색은 계속 진행하고 다음 실행에서만 1페이지부터 재개합니다.
    }
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

  async function saveMatchedChunk(
    ids: string[],
    candidates: Map<string, Restaurant>,
    menuMap: Map<string, Menu[]>,
    savedMap: Map<string, RestaurantSet>,
    collectedIds: Set<string>,
  ) {
    const now = new Date().toISOString();
    const stores = ids.flatMap((id) => {
      const restaurant = candidates.get(id);
      const menus = menuMap.get(id) ?? [];
      if (!restaurant || !menus.length) return [];

      const store: RestaurantSet = {
        ...restaurant,
        imageUrl: savedMap.get(id)?.imageUrl ?? "",
        menus,
        savedAt: now,
      };
      savedMap.set(id, store);
      collectedIds.add(id);
      return [store];
    });

    if (!stores.length) return;
    persistLocal(savedMap, [...collectedIds]);
    await saveDatabase(stores, collectedIds.size >= TOTAL_TARGET ? "completed" : "running");
    setDbTotalCount((count) => count + stores.length);
    setSelectedId((current) => current || stores[0]?.sourceId || "");
    setStage(`메뉴 확인 가게 ${collectedIds.size}/${TOTAL_TARGET}곳 · ${stores.length}곳 Supabase 저장 완료`);
  }

  async function saveMenuChanges(
    ids: string[],
    menuMap: Map<string, Menu[]>,
    savedMap: Map<string, RestaurantSet>,
    latest: string[],
  ) {
    const now = new Date().toISOString();
    const changed: RestaurantSet[] = [];
    for (const id of ids) {
      const current = savedMap.get(id);
      if (!current) continue;
      const updated = { ...current, menus: menuMap.get(id) ?? current.menus, savedAt: now };
      savedMap.set(id, updated);
      changed.push(updated);
    }
    if (!changed.length) return;
    persistLocal(savedMap, latest);
    await saveDatabase(changed, "running");
  }

  async function collectAll() {
    const controller = new AbortController();
    controllerRef.current = controller;
    cancelRef.current = false;
    setRunning(true);
    setProgress(1);
    setMessage("");
    setLatestIds([]);

    const fresh = await loadDatabase();
    const savedMap = new Map(fresh.map((store) => [store.sourceId, store]));
    const candidates = new Map<string, Restaurant>();
    const menuMap = new Map<string, Menu[]>();
    const collectedIds = new Set<string>();
    const pendingIds: string[] = [];
    const pendingSet = new Set<string>();
    const matchedPages = new Set<number>();
    const scope = buildScope(regionKey, customRegion, keyword);

    try {
      setStage(`기존 DB ${fresh.length.toLocaleString()}곳 제외 · 지역 후보 전체 확인 중`);
      let restaurantPage: number | null = 1;
      let restaurantRuns = 0;
      let restaurantTotalPages = 1;

      while (restaurantPage && restaurantRuns < 200) {
        const data = await collect({
          mode: "restaurants",
          pageNo: restaurantPage,
          pagesPerBatch: 1,
          regionKey,
          customRegion,
          keyword,
        }, controller.signal);

        for (const restaurant of data.restaurants ?? []) {
          if (!savedMap.has(restaurant.sourceId)) candidates.set(restaurant.sourceId, restaurant);
        }

        const totalCount = Number(data.stats?.totalCount ?? 0);
        if (totalCount > 0) restaurantTotalPages = Math.max(Math.ceil(totalCount / API_PAGE_SIZE), 1);
        restaurantRuns += 1;
        restaurantPage = data.nextPage ?? null;
        setProgress(Math.min(20, 2 + Math.round((restaurantRuns / restaurantTotalPages) * 18)));
        setStage(`지역 후보 ${candidates.size.toLocaleString()}곳 · 식당 API ${restaurantRuns}/${restaurantTotalPages}페이지`);
        await abortableDelay(300, controller.signal);
      }

      if (!candidates.size) throw new Error("조건에 맞고 아직 저장되지 않은 가게가 없습니다.");

      let menuPage = await loadScanPage(scope);
      let startPage = menuPage;
      let menuTotalPages = 1;
      let pagesVisited = 0;
      let wrapped = false;

      setProgress(21);
      setStage(`후보 ${candidates.size.toLocaleString()}곳 중 실제 메뉴가 있는 가게를 찾는 중`);

      while (collectedIds.size < TOTAL_TARGET) {
        const currentPage = menuPage;
        const data = await collect({
          mode: "menus-ko",
          pageNo: currentPage,
          pagesPerBatch: 1,
          restaurantIds: [...candidates.keys()],
        }, controller.signal);

        const totalCount = Number(data.stats?.totalCount ?? 0);
        if (totalCount > 0) menuTotalPages = Math.max(Math.ceil(totalCount / API_PAGE_SIZE), 1);
        if (startPage > menuTotalPages) {
          startPage = 1;
          menuPage = 1;
        }

        const matchedIds: string[] = [];
        for (const [id, incoming] of Object.entries(data.menusByRestaurant ?? {})) {
          if (!candidates.has(id) || collectedIds.has(id)) continue;
          menuMap.set(id, mergeMenus(menuMap.get(id) ?? [], incoming));
          if (!pendingSet.has(id)) {
            pendingSet.add(id);
            pendingIds.push(id);
            matchedIds.push(id);
          }
        }
        if (matchedIds.length) matchedPages.add(currentPage);

        while (pendingIds.length >= CHUNK_SIZE && collectedIds.size < TOTAL_TARGET) {
          const chunk = pendingIds.splice(0, Math.min(CHUNK_SIZE, TOTAL_TARGET - collectedIds.size));
          chunk.forEach((id) => pendingSet.delete(id));
          await saveMatchedChunk(chunk, candidates, menuMap, savedMap, collectedIds);
          if (collectedIds.size < TOTAL_TARGET) await abortableDelay(1200, controller.signal);
        }

        pagesVisited += 1;
        const next = data.nextPage ?? null;
        if (next) {
          menuPage = next;
        } else if (!wrapped && startPage > 1) {
          wrapped = true;
          menuPage = 1;
        } else {
          break;
        }

        if (wrapped && menuPage >= startPage) break;
        if (pagesVisited % 3 === 0) await saveScanPage(scope, menuPage);

        const matchProgress = (collectedIds.size / TOTAL_TARGET) * 52;
        const scanProgress = Math.min(pagesVisited / Math.max(menuTotalPages, 1), 1) * 12;
        setProgress(Math.min(84, 21 + Math.round(matchProgress + scanProgress)));
        setStage(
          `메뉴 있는 가게 ${collectedIds.size}/${TOTAL_TARGET}곳 · 대기 ${pendingIds.length}곳 · 메뉴 API ${currentPage}/${menuTotalPages}페이지`,
        );
        await abortableDelay(650, controller.signal);
      }

      if (pendingIds.length && collectedIds.size < TOTAL_TARGET) {
        const chunk = pendingIds.splice(0, TOTAL_TARGET - collectedIds.size);
        chunk.forEach((id) => pendingSet.delete(id));
        await saveMatchedChunk(chunk, candidates, menuMap, savedMap, collectedIds);
      }

      await saveScanPage(scope, menuPage > menuTotalPages ? 1 : menuPage);
      if (!collectedIds.size) {
        throw new Error("이 지역의 후보 가게에서 연결 가능한 한국어 메뉴를 찾지 못했습니다.");
      }

      const pagesToTranslate = [...matchedPages].sort((a, b) => a - b);
      let translatedStores = 0;
      let translationLimited = false;
      setProgress(86);

      for (let index = 0; index < pagesToTranslate.length; index += 1) {
        try {
          const data = await collect({
            mode: "menu-translations",
            pageNo: pagesToTranslate[index],
            pagesPerBatch: 1,
            restaurantIds: [...collectedIds],
          }, controller.signal);

          const changedIds: string[] = [];
          for (const [id, incoming] of Object.entries(data.menusByRestaurant ?? {})) {
            if (!collectedIds.has(id)) continue;
            menuMap.set(id, mergeMenus(menuMap.get(id) ?? [], incoming));
            changedIds.push(id);
          }
          if (changedIds.length) {
            translatedStores += changedIds.length;
            await saveMenuChanges(changedIds, menuMap, savedMap, [...collectedIds]);
          }

          setProgress(Math.min(99, 86 + Math.round(((index + 1) / Math.max(pagesToTranslate.length, 1)) * 13)));
          setStage(`영어·일본어 메뉴 보강 ${index + 1}/${pagesToTranslate.length}페이지`);
          await abortableDelay(1000, controller.signal);
        } catch (error) {
          if (cancelRef.current || isAbortError(error)) throw error;
          translationLimited = true;
          break;
        }
      }

      await loadDatabase();
      setLatestIds([...collectedIds]);
      setSelectedId([...collectedIds][0] ?? "");
      setProgress(100);
      setStage(translationLimited ? "가게·한국어 메뉴 저장 완료" : "자동 수집 완료");
      setMessage(
        translationLimited
          ? `메뉴가 확인된 새 가게 ${collectedIds.size}곳을 저장했습니다. 영·일 메뉴는 다음 실행에서 이어서 보강됩니다.`
          : `메뉴가 확인된 새 가게 ${collectedIds.size}곳과 영·일 메뉴 ${translatedStores}건을 Supabase에 반영했습니다.`,
      );
    } catch (error) {
      if (cancelRef.current || isAbortError(error)) {
        setStage("수집 중지 완료");
        setMessage("중지했습니다. 이미 Supabase에 저장된 가게와 메뉴는 그대로 유지됩니다.");
      } else {
        setStage("수집 일시 중단");
        setMessage(error instanceof Error ? error.message : "통합 수집에 실패했습니다.");
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  }

  function stopRun() {
    if (!running) return;
    cancelRef.current = true;
    setStage("현재 요청과 대기 타이머 중지 중");
    controllerRef.current?.abort();
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
          <h1 style={{ margin: "0 0 8px" }}>메뉴가 확인된 새 가게 100곳</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>지역 후보 전체를 확인한 뒤 실제 한국어 메뉴가 있는 가게만 20곳씩 Supabase에 저장합니다.</p>
        </div>
        <Link className="ghost-button" href="/admin">기존 Admin</Link>
      </div>

      <section className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="section-heading">
          <div><span>ONE CLICK</span><h2>수집 조건</h2></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`dot ${dbConnected && tokenConfigured ? "online" : ""}`} />
            <strong>{dbConnected && tokenConfigured ? "DB·API 토큰 등록됨" : "연결 확인 필요"}</strong>
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
              {["전체", "카페", "치킨", "삼겹살", "한식", "일식", "중식"].map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>자동 실행</span>
            <input readOnly value="후보 전체 → 메뉴 확인 → 20곳씩 저장" />
            <small>지난 메뉴 검색 페이지부터 이어서 진행하며 기존 가게는 제외합니다.</small>
          </label>
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={running || !dbConnected || !tokenConfigured} onClick={() => void collectAll()}>
            {running ? "자동 수집 진행 중…" : "메뉴 있는 새 가게 100곳 자동 수집"}
          </button>
          {running && <button className="secondary-button" onClick={stopRun}>즉시 중지</button>}
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
          <p className="fine-print">현재 Supabase 누적 {dbTotalCount.toLocaleString()}곳 · 메뉴가 확인된 가게만 20곳 단위로 즉시 저장됩니다.</p>
        </div>
        {message && <div className="notice">{message}</div>}
      </section>

      <section className="card" style={{ padding: 24 }}>
        <div className="section-heading">
          <div><span>RESULT</span><h2>{latestIds.length ? `이번 실행 ${visible.length}곳` : `DB 표시 가게 ${sets.length}곳`}</h2></div>
          {latestIds.length > 0 && <button className="text-button" onClick={() => setLatestIds([])}>전체 DB 목록 보기</button>}
        </div>

        {!visible.length ? (
          <div className="empty-state"><strong>아직 표시할 가게가 없습니다.</strong><span>메뉴가 확인된 첫 20곳이 저장되는 순간 이곳에 나타납니다.</span></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(250px, .75fr) minmax(0, 1.25fr)", gap: 18 }}>
            <div style={{ display: "grid", gap: 8, alignContent: "start", maxHeight: 720, overflowY: "auto", paddingRight: 4 }}>
              {visible.map((store) => (
                <button key={store.sourceId} onClick={() => setSelectedId(store.sourceId)} style={{ textAlign: "left", border: selected?.sourceId === store.sourceId ? "2px solid var(--green)" : "1px solid var(--line)", borderRadius: 14, padding: 14, background: "white" }}>
                  <strong>{store.name}</strong>
                  <div style={{ marginTop: 5, fontSize: 13, color: "var(--muted)" }}>
                    {store.category || store.licenseType || "업태 미확인"} · 메뉴 {store.menus.length}개
                  </div>
                </button>
              ))}
            </div>

            {selected && (
              <article style={{ border: "1px solid var(--line)", borderRadius: 18, overflow: "hidden", background: "white" }}>
                {selected.imageUrl && <img src={selected.imageUrl} alt={`${selected.name} 외관`} onError={(event) => { event.currentTarget.style.display = "none"; }} style={{ display: "block", width: "100%", height: 260, objectFit: "cover" }} />}
                <div style={{ padding: 22 }}>
                  <p className="eyebrow">STORE & MULTILINGUAL MENU</p>
                  <h3 style={{ margin: "0 0 8px", fontSize: 26 }}>{selected.name}</h3>
                  <p style={{ margin: "0 0 4px", color: "var(--muted)" }}>{selected.roadAddress || selected.address || "주소 없음"}</p>
                  <p style={{ margin: "0 0 18px", color: "var(--muted)" }}>{selected.phone || "전화번호 없음"}</p>

                  <div style={{ display: "grid", gap: 10 }}>
                    {selected.menus.map((menu) => (
                      <div key={menu.menuId} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                          <strong>{menu.nameKo || menu.nameEn || menu.nameJa || "메뉴명 확인 필요"}</strong>
                          <strong>{priceLabel(menu.price)}</strong>
                        </div>
                        <div style={{ marginTop: 7, color: "var(--muted)", fontSize: 13 }}>{menu.nameEn || "영문 보강 대기"}</div>
                        <div style={{ marginTop: 3, color: "var(--muted)", fontSize: 13 }}>{menu.nameJa || "일문 보강 대기"}</div>
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
