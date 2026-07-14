"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORY_PRESETS, REGION_PRESETS, STORAGE_KEYS } from "@/lib/config";
import type { MenuItem, SearchResponse, StoreRecord } from "@/lib/types";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function statusLabel(status: StoreRecord["menuCheckStatus"]) {
  return {
    unchecked: "검사 전",
    checking: "검사 중",
    found: "텍스트 메뉴 있음",
    partial: "일부 확인",
    "image-only": "메뉴판 사진만",
    missing: "메뉴 없음",
    failed: "검사 실패",
  }[status];
}

function isMenuUsable(store: StoreRecord) {
  return ["found", "partial", "image-only"].includes(store.menuCheckStatus);
}

function newMenu(index: number): MenuItem {
  return {
    id: `manual-${Date.now()}-${index}`,
    category: "메뉴",
    nameKo: "",
    descriptionKo: "",
    price: "",
    isRepresentative: false,
    nameEn: "",
    descriptionEn: "",
    nameJa: "",
    descriptionJa: "",
  };
}

export default function AdminApp() {
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [regionKey, setRegionKey] = useState("seongsu");
  const [keyword, setKeyword] = useState("치킨");
  const [targetCount, setTargetCount] = useState(30);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<SearchResponse["stats"] | null>(null);
  const [supabaseConnected, setSupabaseConnected] = useState(false);

  useEffect(() => {
    const savedKey = sessionStorage.getItem(STORAGE_KEYS.kakaoKey) ?? "";
    setApiKey(savedKey);
    const savedStores = readJson<StoreRecord[]>(STORAGE_KEYS.stores, []);
    setStores(savedStores);
    setSupabaseConnected(Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL));
  }, []);

  useEffect(() => {
    if (stores.length) localStorage.setItem(STORAGE_KEYS.stores, JSON.stringify(stores));
  }, [stores]);

  const selected = useMemo(
    () => stores.find((store) => store.kakaoPlaceId === selectedId) ?? null,
    [selectedId, stores],
  );
  const usableCount = stores.filter(isMenuUsable).length;
  const checkedCount = stores.filter((store) => store.menuCheckStatus !== "unchecked").length;

  function persistKey(value: string) {
    setApiKey(value);
    if (rememberKey) sessionStorage.setItem(STORAGE_KEYS.kakaoKey, value);
  }

  async function search(nextBatch = false) {
    if (!apiKey.trim()) {
      setMessage("카카오 REST API 키를 먼저 입력하세요.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      if (rememberKey) sessionStorage.setItem(STORAGE_KEYS.kakaoKey, apiKey.trim());
      const inspected = new Set(readJson<string[]>(STORAGE_KEYS.inspectedIds, []));
      if (nextBatch) stores.forEach((store) => inspected.add(store.kakaoPlaceId));
      const response = await fetch("/api/kakao/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          regionKey,
          keyword,
          targetCount,
          excludeIds: [...inspected],
        }),
      });
      const data = (await response.json()) as SearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "매장 후보 수집에 실패했습니다.");
      setStores(data.candidates);
      setStats(data.stats);
      setSelectedId(data.candidates[0]?.kakaoPlaceId ?? null);
      setMessage(`${data.regionName} ${data.keyword} 후보 ${data.candidates.length}곳을 불러왔습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function inspectOne(store: StoreRecord): Promise<StoreRecord> {
    setStores((current) => current.map((item) => item.kakaoPlaceId === store.kakaoPlaceId ? { ...item, menuCheckStatus: "checking" } : item));
    try {
      const response = await fetch("/api/kakao/menu-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeUrl: store.kakaoUrl }),
      });
      const data = await response.json() as { status?: StoreRecord["menuCheckStatus"]; evidence?: string; menus?: MenuItem[]; error?: string };
      const updated: StoreRecord = {
        ...store,
        menuCheckStatus: response.ok && data.status ? data.status : "failed",
        menuEvidence: data.evidence || data.error || "검사 결과 없음",
        menus: data.menus?.length ? data.menus : store.menus,
        checkedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setStores((current) => current.map((item) => item.kakaoPlaceId === store.kakaoPlaceId ? updated : item));
      const inspected = new Set(readJson<string[]>(STORAGE_KEYS.inspectedIds, []));
      inspected.add(store.kakaoPlaceId);
      localStorage.setItem(STORAGE_KEYS.inspectedIds, JSON.stringify([...inspected]));
      return updated;
    } catch (error) {
      const updated = { ...store, menuCheckStatus: "failed" as const, menuEvidence: error instanceof Error ? error.message : "검사 실패", checkedAt: new Date().toISOString() };
      setStores((current) => current.map((item) => item.kakaoPlaceId === store.kakaoPlaceId ? updated : item));
      return updated;
    }
  }

  async function inspectUntilTarget() {
    if (!stores.length) return;
    setChecking(true);
    setMessage("메뉴가 있는 매장을 목표 수량까지 순서대로 검사합니다.");
    let found = stores.filter(isMenuUsable).length;
    for (const store of stores) {
      if (found >= targetCount) break;
      if (store.menuCheckStatus !== "unchecked") continue;
      const updated = await inspectOne(store);
      if (isMenuUsable(updated)) found += 1;
    }
    setChecking(false);
    setMessage(found >= targetCount ? `메뉴 보유 매장 ${found}곳을 확보했습니다.` : `현재 후보에서 메뉴 보유 매장 ${found}곳을 확인했습니다. 다음 목록을 불러오세요.`);
  }

  function updateStore(patch: Partial<StoreRecord>) {
    if (!selected) return;
    setStores((current) => current.map((store) => store.kakaoPlaceId === selected.kakaoPlaceId ? { ...store, ...patch, updatedAt: new Date().toISOString() } : store));
  }

  function updateMenu(menuId: string, patch: Partial<MenuItem>) {
    if (!selected) return;
    const menus = selected.menus.map((menu) => menu.id === menuId ? { ...menu, ...patch } : menu);
    updateStore({ menus, translationStatus: "draft" });
  }

  function addMenu() {
    if (!selected) return;
    updateStore({ menus: [...selected.menus, newMenu(selected.menus.length)] });
  }

  function removeMenu(menuId: string) {
    if (!selected) return;
    updateStore({ menus: selected.menus.filter((menu) => menu.id !== menuId) });
  }

  async function publishStore() {
    if (!selected) return;
    if (!selected.menus.length) {
      setMessage("공개 전에 메뉴를 최소 1개 입력하세요.");
      return;
    }
    const hasMissingTranslation = selected.menus.some((menu) => !menu.nameEn.trim() || !menu.nameJa.trim());
    if (hasMissingTranslation) {
      setMessage("영어와 일본어 메뉴명을 모두 입력한 뒤 공개하세요.");
      return;
    }
    const published: StoreRecord = { ...selected, publishStatus: "published", translationStatus: "reviewed", updatedAt: new Date().toISOString() };
    setStores((current) => current.map((store) => store.kakaoPlaceId === published.kakaoPlaceId ? published : store));
    const allPublished = readJson<Record<string, StoreRecord>>(STORAGE_KEYS.published, {});
    allPublished[published.slug] = published;
    localStorage.setItem(STORAGE_KEYS.published, JSON.stringify(allPublished));

    try {
      const response = await fetch("/api/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(published) });
      const data = await response.json() as { mode?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "저장 실패");
      setMessage(data.mode === "supabase" ? "Supabase에 저장하고 공개했습니다." : "브라우저 데모 저장으로 공개했습니다. Supabase 연결 후 외부 사용자에게도 보입니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "공개 저장에 실패했습니다.");
    }
  }

  function resetHistory() {
    localStorage.removeItem(STORAGE_KEYS.inspectedIds);
    localStorage.removeItem(STORAGE_KEYS.stores);
    setStores([]);
    setSelectedId(null);
    setMessage("검사 기록과 임시 목록을 초기화했습니다.");
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark">M</span><span>MapForYou<small>Menu Studio</small></span></Link>
        <nav>
          <a className="nav-active" href="#collect">매장 수집</a>
          <a href="#results">수집 목록</a>
          <a href="#editor">메뉴 편집</a>
          <Link href="/store/standard-bread-seongsu">B 샘플 보기</Link>
        </nav>
        <div className="sidebar-bottom">
          <span className={`dot ${supabaseConnected ? "online" : ""}`} />
          <div><strong>{supabaseConnected ? "Supabase 연결됨" : "데모 저장 모드"}</strong><small>{supabaseConnected ? "공용 DB 사용" : "브라우저에만 저장"}</small></div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div><p className="eyebrow">INTERNAL ADMIN</p><h1>다국어 메뉴 데이터 만들기</h1><p>매장 수집 → 메뉴 확인 → 영어·일본어 검수 → 공개</p></div>
          <Link className="ghost-button" href="/store/standard-bread-seongsu">B 화면 미리보기</Link>
        </header>

        <section className="status-strip">
          <div><span>후보 매장</span><strong>{stores.length}</strong></div>
          <div><span>검사 완료</span><strong>{checkedCount}</strong></div>
          <div><span>메뉴 확인</span><strong>{usableCount}</strong></div>
          <div><span>공개 완료</span><strong>{stores.filter((store) => store.publishStatus === "published").length}</strong></div>
        </section>

        <section id="collect" className="card collect-card">
          <div className="section-heading"><div><span>STEP 1</span><h2>매장 후보 수집</h2></div><button className="text-button" onClick={resetHistory}>기록 초기화</button></div>
          <div className="form-grid">
            <label className="field field-wide"><span>카카오 REST API 키</span><input type="password" value={apiKey} onChange={(event) => persistKey(event.target.value)} placeholder="여기에 붙여넣기" autoComplete="off" /><small>GitHub에는 저장되지 않습니다. 선택 시 현재 브라우저 탭에만 기억합니다.</small></label>
            <label className="check-line"><input type="checkbox" checked={rememberKey} onChange={(event) => setRememberKey(event.target.checked)} /> 이 탭에서 API 키 기억</label>
            <label className="field"><span>지역</span><select value={regionKey} onChange={(event) => setRegionKey(event.target.value)}>{Object.entries(REGION_PRESETS).map(([key, region]) => <option value={key} key={key}>{region.name}</option>)}</select></label>
            <label className="field"><span>업종·검색어</span><input list="category-presets" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><datalist id="category-presets">{CATEGORY_PRESETS.map((category) => <option value={category} key={category} />)}</datalist></label>
            <label className="field"><span>목표 매장 수</span><select value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))}><option value={10}>10곳</option><option value={20}>20곳</option><option value={30}>30곳</option><option value={50}>50곳</option></select></label>
          </div>
          <div className="action-row">
            <button className="primary-button" disabled={loading || checking} onClick={() => search(false)}>{loading ? "후보 수집 중…" : "새 후보 수집"}</button>
            <button className="secondary-button" disabled={loading || checking} onClick={() => search(true)}>중복 제외 다음 목록</button>
            <button className="dark-button" disabled={!stores.length || checking} onClick={inspectUntilTarget}>{checking ? "메뉴 검사 중…" : `메뉴 있는 곳 ${targetCount}개 찾기`}</button>
          </div>
          {message && <div className="notice">{message}</div>}
          {stats && <p className="fine-print">카카오 요청 {stats.requests}회 · 원본 결과 {stats.rawResults}개 · 이전 검사 제외 {stats.excluded}개</p>}
        </section>

        <section id="results" className="card results-card">
          <div className="section-heading"><div><span>STEP 2</span><h2>수집·검사 목록</h2></div><p>행을 눌러 메뉴를 편집하세요.</p></div>
          {!stores.length ? <div className="empty-state"><strong>아직 수집된 매장이 없습니다.</strong><span>API 키를 넣고 지역과 업종을 선택해 시작하세요.</span></div> : (
            <div className="table-wrap"><table><thead><tr><th>매장</th><th>분류</th><th>메뉴 상태</th><th>메뉴 수</th><th>공개</th><th /></tr></thead><tbody>{stores.map((store) => <tr key={store.kakaoPlaceId} className={selectedId === store.kakaoPlaceId ? "selected-row" : ""} onClick={() => setSelectedId(store.kakaoPlaceId)}><td><strong>{store.name}</strong><small>{store.roadAddress || store.address}</small></td><td>{store.searchKeyword}</td><td><span className={`status-pill status-${store.menuCheckStatus}`}>{statusLabel(store.menuCheckStatus)}</span></td><td>{store.menus.length}</td><td>{store.publishStatus === "published" ? "공개" : "초안"}</td><td><button className="mini-button" disabled={store.menuCheckStatus === "checking"} onClick={(event) => { event.stopPropagation(); void inspectOne(store); }}>검사</button></td></tr>)}</tbody></table></div>
          )}
        </section>

        <section id="editor" className="card editor-card">
          <div className="section-heading"><div><span>STEP 3</span><h2>메뉴·번역 편집</h2></div>{selected && <a className="text-link" href={selected.kakaoUrl} target="_blank" rel="noreferrer">카카오 원본 열기 ↗</a>}</div>
          {!selected ? <div className="empty-state"><strong>편집할 매장을 선택하세요.</strong></div> : <>
            <div className="store-summary"><div><p>{selected.category}</p><h3>{selected.name}</h3><span>{selected.roadAddress || selected.address}</span></div><div className="evidence"><strong>{statusLabel(selected.menuCheckStatus)}</strong><span>{selected.menuEvidence || "메뉴 검사를 실행하세요."}</span></div></div>
            <div className="editor-fields"><label className="field"><span>공개 주소</span><input value={selected.slug} onChange={(event) => updateStore({ slug: event.target.value.replace(/\s+/g, "-") })} /></label><label className="field"><span>인스타그램</span><input value={selected.instagramUrl ?? ""} onChange={(event) => updateStore({ instagramUrl: event.target.value })} placeholder="https://instagram.com/..." /></label></div>
            <div className="menu-editor-head"><div><h3>메뉴 {selected.menus.length}개</h3><p>한국어 원본을 확인하고 영어·일본어 메뉴명을 입력합니다.</p></div><button className="secondary-button" onClick={addMenu}>+ 메뉴 추가</button></div>
            <div className="menu-list">{selected.menus.map((menu, index) => <article className="menu-edit-card" key={menu.id}><div className="menu-card-top"><strong>메뉴 {index + 1}</strong><button onClick={() => removeMenu(menu.id)}>삭제</button></div><div className="menu-grid"><label><span>한국어 메뉴명</span><input value={menu.nameKo} onChange={(e) => updateMenu(menu.id, { nameKo: e.target.value })} /></label><label><span>가격</span><input value={menu.price} onChange={(e) => updateMenu(menu.id, { price: e.target.value })} /></label><label className="full"><span>한국어 설명</span><textarea value={menu.descriptionKo} onChange={(e) => updateMenu(menu.id, { descriptionKo: e.target.value })} /></label><label><span>English</span><input value={menu.nameEn} onChange={(e) => updateMenu(menu.id, { nameEn: e.target.value })} placeholder="English menu name" /></label><label><span>日本語</span><input value={menu.nameJa} onChange={(e) => updateMenu(menu.id, { nameJa: e.target.value })} placeholder="日本語のメニュー名" /></label><label className="full"><span>English description</span><textarea value={menu.descriptionEn} onChange={(e) => updateMenu(menu.id, { descriptionEn: e.target.value })} /></label><label className="full"><span>日本語の説明</span><textarea value={menu.descriptionJa} onChange={(e) => updateMenu(menu.id, { descriptionJa: e.target.value })} /></label></div></article>)}</div>
            {!selected.menus.length && <div className="empty-state compact"><strong>자동 추출된 메뉴가 없습니다.</strong><span>카카오 원본을 확인한 뒤 메뉴를 직접 추가할 수 있습니다.</span></div>}
            <div className="publish-bar"><div><strong>B 공개 메뉴판으로 보내기</strong><span>영어·일본어 메뉴명을 모두 입력해야 공개할 수 있습니다.</span></div><button className="primary-button" onClick={publishStore}>저장 후 공개</button>{selected.publishStatus === "published" && <Link className="secondary-button link-button" href={`/store/${selected.slug}`}>공개 화면 보기</Link>}</div>
          </>}
        </section>
      </main>
    </div>
  );
}
