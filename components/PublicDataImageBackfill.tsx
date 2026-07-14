"use client";

import { useEffect, useRef, useState } from "react";

const API_PAGE_SIZE = 1000;
const CURSOR_SCOPE = "images_all";

type ImageStatus = {
  total?: number;
  withImage?: number;
  withoutImage?: number;
  missingIds?: string[];
  error?: string;
};

type CollectResponse = {
  imagesByRestaurant?: Record<string, string>;
  nextPage?: number | null;
  stats?: { scannedTo?: number; totalCount?: number };
  error?: string;
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

export default function PublicDataImageBackfill() {
  const [status, setStatus] = useState<ImageStatus>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("사진 현황 확인 중");
  const [message, setMessage] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadStatus();
    return () => controllerRef.current?.abort();
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

  async function saveImages(imagesByRestaurant: Record<string, string>) {
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
    if (!response.ok) throw new Error(data.error || "식당 사진 조회 실패");
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
      setStage(`사진 없는 가게 ${remaining.size}곳 · 이미지 API 검색 시작`);

      while (remaining.size > 0) {
        const currentPage = page;
        const data = await collectImages(currentPage, [...remaining], controller.signal);
        const totalCount = Number(data.stats?.totalCount ?? 0);
        if (totalCount > 0) totalPages = Math.max(Math.ceil(totalCount / API_PAGE_SIZE), 1);

        if (startPage > totalPages) {
          startPage = 1;
          page = 1;
          continue;
        }

        const found = Object.fromEntries(
          Object.entries(data.imagesByRestaurant ?? {}).filter(([id, url]) => remaining.has(id) && Boolean(url)),
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
        setStage(
          `사진 연결 ${foundTotal}/${targetIds.length}곳 · 이미지 API ${currentPage}/${totalPages}페이지`,
        );
        await delay(750, controller.signal);
      }

      await saveCursor(page > totalPages ? 1 : page);
      const finalStatus = await loadStatus();
      setProgress(100);
      setStage("사진 보강 실행 완료");
      setMessage(
        `이번 실행에서 ${foundTotal}곳의 사진을 연결했습니다. API에 사진이 없는 가게 ${finalStatus?.withoutImage ?? remaining.size}곳은 기본 이미지로 표시하면 됩니다.`,
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

  return (
    <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 20px" }}>
      <section className="card" style={{ padding: 20 }}>
        <div className="section-heading" style={{ marginBottom: 14 }}>
          <div>
            <span>STORE PHOTOS</span>
            <h2 style={{ marginBottom: 4 }}>기존·신규 가게 사진 보강</h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
              저장된 식당 ID로 공식 이미지 API를 조회해 사진 URL만 추가합니다. 메뉴와 주소는 변경하지 않습니다.
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
            {running ? "사진 자동 보강 중…" : `사진 없는 ${status.withoutImage ?? 0}곳 자동 보강`}
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
  );
}
