"use client";

import { useEffect, useRef, useState } from "react";
import TourApiImageBackfill from "@/components/TourApiImageBackfill";

const CURSOR_SCOPE = "images_all_v2";

type MissingStore = {
  sourceId: string;
  name: string;
  address: string;
  category: string;
  regionKey: string;
};

type ImageCandidate = {
  url: string;
  source: string;
  attribution?: string;
  sourceUrl?: string;
};

type ImageStatus = {
  total?: number;
  withImage?: number;
  withoutImage?: number;
  missingIds?: string[];
  missingStores?: MissingStore[];
  sourceCounts?: Record<string, number>;
  error?: string;
};

type CollectResponse = {
  imagesByRestaurant?: Record<string, ImageCandidate>;
  nextPage?: number | null;
  stats?: {
    scannedTo?: number;
    totalCount?: number;
    totalPages?: number;
    restaurantImageCount?: number;
    foodImageCount?: number;
  };
  error?: string;
};

type ManualDraft = {
  imageUrl: string;
  sourceUrl: string;
  attribution: string;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function delay(ms: number, signal: AbortSignal) {
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

function searchQuery(store: MissingStore) {
  return `${store.name} ${store.address}`.trim();
}

function googleMapsUrl(store: MissingStore) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery(store))}`;
}

function googleImageUrl(store: MissingStore) {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${searchQuery(store)} 음식 사진`)}`;
}

function officialSearchUrl(store: MissingStore) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${searchQuery(store)} 공식 인스타그램`)}`;
}

export default function PublicDataImageBackfill() {
  const [status, setStatus] = useState<ImageStatus>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("사진 현황 확인 중");
  const [message, setMessage] = useState("");
  const [manualDrafts, setManualDrafts] = useState<Record<string, ManualDraft>>({});
  const [savingId, setSavingId] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadStatus();
    const refresh = () => void loadStatus();
    window.addEventListener("mapforyou:images-updated", refresh);
    return () => {
      controllerRef.current?.abort();
      window.removeEventListener("mapforyou:images-updated", refresh);
    };
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch("/api/public-data/images", { cache: "no-store" });
      const data = (await response.json()) as ImageStatus;
      if (!response.ok) throw new Error(data.error || "사진 현황 조회 실패");
      setStatus(data);
      setStage(data.withoutImage ? `사진 없는 가게 ${data.withoutImage}곳` : "모든 가게 사진 확인 완료");
      return data;
    } catch (error) {
      setStage("사진 현황 조회 오류");
      setMessage(error instanceof Error ? error.message : "사진 현황 조회 실패");
      return null;
    }
  }

  async function loadCursor() {
    try {
      const response = await fetch(`/api/redtable/scan-state?scope=${CURSOR_SCOPE}`, { cache: "no-store" });
      const data = (await response.json()) as { page?: number };
      return response.ok ? Math.max(Number(data.page) || 1, 1) : 1;
    } catch {
      return 1;
    }
  }

  async function saveCursor(page: number) {
    try {
      await fetch("/api/redtable/scan-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: CURSOR_SCOPE, page: Math.max(page, 1) }),
      });
    } catch {
      // 사진 수집은 계속 진행합니다.
    }
  }

  async function saveImages(imagesByRestaurant: Record<string, ImageCandidate>) {
    const response = await fetch("/api/public-data/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagesByRestaurant }),
    });
    const data = (await response.json()) as ImageStatus & { updated?: number };
    if (!response.ok) throw new Error(data.error || "사진 저장 실패");
    setStatus(data);
    return Number(data.updated ?? 0);
  }

  async function collectImages(pageNo: number, restaurantIds: string[], signal: AbortSignal) {
    const response = await fetch("/api/redtable/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "images", pageNo, pagesPerBatch: 1, restaurantIds }),
      signal,
    });
    const data = (await response.json()) as CollectResponse;
    if (response.status === 429) {
      throw new Error("OPEN API 한도가 초과됐습니다. 위에서 다른 API KEY로 교체한 뒤 다시 실행해주세요.");
    }
    if (!response.ok) throw new Error(data.error || "식당·음식 사진 조회 실패");
    return data;
  }

  async function startBackfill() {
    const latest = await loadStatus();
    const targetIds = latest?.missingIds ?? [];
    if (!targetIds.length) {
      setProgress(100);
      setMessage("현재 저장된 모든 가게의 사진 확인이 끝났습니다.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setProgress(1);
    setMessage("");

    const remaining = new Set(targetIds);
    let foundTotal = 0;
    let page = await loadCursor();
    let startPage = page;
    let totalPages = 1;
    let visited = 0;
    let wrapped = false;

    try {
      setStage(`사진 없는 가게 ${remaining.size}곳 · 식당사진+음식사진 검색 시작`);

      while (remaining.size > 0) {
        const currentPage = page;
        const data = await collectImages(currentPage, [...remaining], controller.signal);
        totalPages = Math.max(Number(data.stats?.totalPages ?? 1), 1);

        if (startPage > totalPages) {
          startPage = 1;
          page = 1;
          continue;
        }

        const found = Object.fromEntries(
          Object.entries(data.imagesByRestaurant ?? {}).filter(([id, image]) =>
            remaining.has(id) && /^https?:\/\//i.test(String(image?.url ?? "")),
          ),
        );

        if (Object.keys(found).length) {
          const updated = await saveImages(found);
          foundTotal += updated;
          for (const id of Object.keys(found)) remaining.delete(id);
        }

        visited += 1;
        const next = data.nextPage ?? null;
        if (next) {
          page = next;
        } else if (!wrapped && startPage > 1) {
          wrapped = true;
          page = 1;
        } else {
          break;
        }

        if (wrapped && page >= startPage) break;
        if (visited % 3 === 0) await saveCursor(page);

        const scanRatio = Math.min(visited / Math.max(totalPages, 1), 1);
        const foundRatio = targetIds.length ? foundTotal / targetIds.length : 1;
        setProgress(Math.min(98, Math.round(scanRatio * 55 + foundRatio * 43)));
        setStage(`사진 연결 ${foundTotal}/${targetIds.length}곳 · 통합 이미지 API ${currentPage}/${totalPages}페이지`);
        await delay(750, controller.signal);
      }

      await saveCursor(page > totalPages ? 1 : page);
      const finalStatus = await loadStatus();
      setProgress(100);
      setStage("자동 사진 보강 완료");
      setMessage(
        `이번 실행에서 ${foundTotal}곳을 연결했습니다. 남은 ${finalStatus?.withoutImage ?? remaining.size}곳은 TourAPI에서 이어서 확인합니다.`,
      );
      window.dispatchEvent(new CustomEvent("mapforyou:images-updated"));
    } catch (error) {
      if (isAbortError(error)) {
        setStage("사진 보강 중지 완료");
        setMessage("중지했습니다. 이미 연결된 사진은 그대로 유지됩니다.");
      } else {
        setStage("사진 보강 일시 중단");
        setMessage(error instanceof Error ? error.message : "사진 보강 실패");
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  }

  function stopBackfill() {
    setStage("현재 사진 요청 중지 중");
    controllerRef.current?.abort();
  }

  function updateDraft(sourceId: string, field: keyof ManualDraft, value: string) {
    setManualDrafts((current) => ({
      ...current,
      [sourceId]: {
        imageUrl: current[sourceId]?.imageUrl ?? "",
        sourceUrl: current[sourceId]?.sourceUrl ?? "",
        attribution: current[sourceId]?.attribution ?? "",
        [field]: value,
      },
    }));
  }

  async function saveManualImage(store: MissingStore) {
    const draft = manualDrafts[store.sourceId];
    if (!draft?.imageUrl.trim()) {
      setMessage(`${store.name}: 이미지 URL을 먼저 입력해주세요.`);
      return;
    }

    setSavingId(store.sourceId);
    setMessage("");
    try {
      const updated = await saveImages({
        [store.sourceId]: {
          url: draft.imageUrl.trim(),
          source: "manual_authorized",
          attribution: draft.attribution.trim(),
          sourceUrl: draft.sourceUrl.trim(),
        },
      });
      if (!updated) throw new Error("이미지 저장 대상 가게를 찾지 못했습니다.");
      setManualDrafts((current) => {
        const next = { ...current };
        delete next[store.sourceId];
        return next;
      });
      setMessage(`${store.name} 사진을 Supabase에 저장했습니다.`);
      window.dispatchEvent(new CustomEvent("mapforyou:images-updated"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지 저장 실패");
    } finally {
      setSavingId("");
    }
  }

  const missingStores = status.missingStores ?? [];

  return (
    <>
      <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 20px" }}>
        <section className="card" style={{ padding: 20 }}>
          <div className="section-heading" style={{ marginBottom: 14 }}>
            <div>
              <span>STEP 1 · REDTABLE</span>
              <h2 style={{ marginBottom: 4 }}>서울관광재단 사진 우선 보강</h2>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                식당 사진을 먼저 찾고, 없으면 같은 식당의 음식 사진을 대표 이미지로 연결합니다.
              </p>
            </div>
            <strong>{status.withImage ?? 0}/{status.total ?? 0}곳 연결</strong>
          </div>

          <div className="action-row">
            <button
              className="secondary-button"
              disabled={running || !status.withoutImage}
              onClick={() => void startBackfill()}
            >
              {running ? "식당·음식 사진 검색 중…" : `사진 없는 ${status.withoutImage ?? 0}곳 REDTABLE 보강`}
            </button>
            {running && <button className="text-button" onClick={stopBackfill}>즉시 중지</button>}
            <button className="ghost-button" disabled={running} onClick={() => void loadStatus()}>현황 새로고침</button>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
              <strong>{stage}</strong><span>{progress}%</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "var(--green)", transition: "width .25s ease" }} />
            </div>
            <p className="fine-print">
              총 {status.total ?? 0}곳 · 사진 있음 {status.withImage ?? 0}곳 · 사진 없음 {status.withoutImage ?? 0}곳
            </p>
          </div>
          {message && <div className="notice">{message}</div>}
        </section>
      </div>

      <TourApiImageBackfill />

      <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 20px" }}>
        <section className="card" style={{ padding: 20 }}>
          <div className="section-heading" style={{ marginBottom: 14 }}>
            <div>
              <span>STEP 3 · MANUAL RESEARCH</span>
              <h2 style={{ marginBottom: 4 }}>남은 가게 직접 확인</h2>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                두 API에 사진이 없는 가게만 공식 계정·사장 제공·직접 촬영 자료로 등록합니다.
              </p>
            </div>
            <strong>최대 30곳 표시</strong>
          </div>

          {!missingStores.length ? (
            <div className="empty-state compact"><strong>직접 확인할 가게가 없습니다.</strong></div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {missingStores.map((store) => {
                const draft = manualDrafts[store.sourceId] ?? { imageUrl: "", sourceUrl: "", attribution: "" };
                return (
                  <article key={store.sourceId} style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div>
                        <strong style={{ display: "block", marginBottom: 5 }}>{store.name}</strong>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{store.address}</span>
                      </div>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                        <a className="mini-button" href={googleMapsUrl(store)} target="_blank" rel="noreferrer">Google Maps</a>
                        <a className="mini-button" href={googleImageUrl(store)} target="_blank" rel="noreferrer">이미지 검색</a>
                        <a className="mini-button" href={officialSearchUrl(store)} target="_blank" rel="noreferrer">공식 계정 검색</a>
                      </div>
                    </div>

                    <div className="form-grid" style={{ marginTop: 14 }}>
                      <label className="field field-wide">
                        <span>사용 가능한 이미지 직접 URL</span>
                        <input
                          value={draft.imageUrl}
                          onChange={(event) => updateDraft(store.sourceId, "imageUrl", event.target.value)}
                          placeholder="https://...jpg"
                        />
                      </label>
                      <label className="field">
                        <span>원본 페이지 URL</span>
                        <input
                          value={draft.sourceUrl}
                          onChange={(event) => updateDraft(store.sourceId, "sourceUrl", event.target.value)}
                          placeholder="공식 홈페이지·인스타 게시물"
                        />
                      </label>
                      <label className="field">
                        <span>출처 표시</span>
                        <input
                          value={draft.attribution}
                          onChange={(event) => updateDraft(store.sourceId, "attribution", event.target.value)}
                          placeholder="매장 제공 / 직접 촬영 / 출처명"
                        />
                      </label>
                    </div>

                    <div className="action-row" style={{ marginTop: 12 }}>
                      <button
                        className="primary-button"
                        disabled={savingId === store.sourceId || !draft.imageUrl.trim()}
                        onClick={() => void saveManualImage(store)}
                      >
                        {savingId === store.sourceId ? "저장 중…" : "이 사진 저장"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
