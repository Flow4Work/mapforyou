"use client";

import { useEffect, useRef, useState } from "react";

type StatusResponse = {
  total?: number;
  unchecked?: number;
  candidate?: number;
  verified?: number;
  notFound?: number;
  error?: string;
};

type ScanResponse = {
  processed?: number;
  placeResolved?: number;
  found?: number;
  stopped?: boolean;
  error?: string;
};

const REGIONS = [
  { value: "all", label: "성수 + 홍대" },
  { value: "seongsu", label: "성수" },
  { value: "hongdae", label: "홍대" },
];

const CHUNK_SIZE = 2;
const CHUNK_DELAY_MS = 1_500;
const REQUEST_TIMEOUT_MS = 55_000;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function elapsedLabel(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export default function NaverContinuousRunner() {
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState<StatusResponse>({});
  const [running, setRunning] = useState(false);
  const [sessionProcessed, setSessionProcessed] = useState(0);
  const [sessionFound, setSessionFound] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("");
  const stopRef = useRef(false);
  const startedAtRef = useRef(0);

  const total = Number(status.total || 0);
  const unchecked = Number(status.unchecked || 0);
  const completed = Math.max(0, total - unchecked);

  useEffect(() => {
    void loadStatus(region);
  }, [region]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function loadStatus(nextRegion = region) {
    const response = await fetch(`/api/public-data/instagram?region=${encodeURIComponent(nextRegion)}&t=${Date.now()}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as StatusResponse;
    if (!response.ok) throw new Error(data.error || "현황 조회 실패");
    setStatus(data);
    return data;
  }

  async function scanChunk() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/public-data/naver-place-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, limit: CHUNK_SIZE, retry: false }),
        signal: controller.signal,
      });
      const data = (await response.json()) as ScanResponse;
      if (!response.ok) throw new Error(data.error || "자동 확인 실패");
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("한 묶음이 55초를 넘겨 중단됐습니다. 이미 저장된 결과는 유지됩니다.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
      return await nav.wakeLock?.request("screen");
    } catch {
      return undefined;
    }
  }

  async function runAll() {
    setRunning(true);
    setSessionProcessed(0);
    setSessionFound(0);
    setElapsed(0);
    setMessage("남은 가게 전체 자동 확인을 시작합니다. 이 화면을 열어두세요.");
    stopRef.current = false;
    startedAtRef.current = Date.now();
    const wakeLock = await requestWakeLock();

    let processed = 0;
    let found = 0;

    try {
      let current = await loadStatus(region);
      while (Number(current.unchecked || 0) > 0 && !stopRef.current) {
        const data = await scanChunk();
        const chunkProcessed = Number(data.processed || 0);
        processed += chunkProcessed;
        found += Number(data.found || 0);
        setSessionProcessed(processed);
        setSessionFound(found);

        current = await loadStatus(region);
        const remaining = Number(current.unchecked || 0);
        setMessage(`${processed}곳 처리 · 인스타 ${found}곳 저장 · 남은 ${remaining}곳`);

        if (data.stopped) {
          setMessage(`${processed}곳 처리 후 네이버 접근 제한이 감지돼 중단했습니다.`);
          break;
        }
        if (chunkProcessed === 0) {
          setMessage("더 처리할 수 있는 미확인 가게가 없어 중단했습니다.");
          break;
        }
        if (remaining > 0 && !stopRef.current) await wait(CHUNK_DELAY_MS);
      }

      if (stopRef.current) setMessage(`${processed}곳 처리 후 사용자가 중지했습니다.`);
      else if (Number(current.unchecked || 0) === 0) setMessage(`전체 완료 · 이번 실행 ${processed}곳 · 인스타 ${found}곳 저장`);
    } catch (error) {
      setMessage(`${processed}곳까지 저장했습니다. ${error instanceof Error ? error.message : "자동 실행 실패"}`);
      try { await loadStatus(region); } catch { /* keep last status */ }
    } finally {
      try { await wakeLock?.release(); } catch { /* no-op */ }
      setRunning(false);
    }
  }

  function stop() {
    stopRef.current = true;
    setMessage("현재 2곳 처리가 끝나면 중지합니다.");
  }

  return (
    <section className="card" style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 18px" }}>
      <div className="section-heading" style={{ marginBottom: 14 }}>
        <div>
          <span>CONTINUOUS MODE</span>
          <h2>남은 전체 자동 실행</h2>
        </div>
        <strong style={{ fontSize: 13 }}>{completed.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")} 완료</strong>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div className="notice" style={{ margin: 0 }}><strong style={{ display: "block", fontSize: 22 }}>{unchecked.toLocaleString("ko-KR")}</strong>남은 미확인</div>
        <div className="notice" style={{ margin: 0 }}><strong style={{ display: "block", fontSize: 22 }}>{sessionProcessed.toLocaleString("ko-KR")}</strong>이번 실행 처리</div>
        <div className="notice" style={{ margin: 0 }}><strong style={{ display: "block", fontSize: 22 }}>{sessionFound.toLocaleString("ko-KR")}</strong>이번 실행 인스타</div>
        <div className="notice" style={{ margin: 0 }}><strong style={{ display: "block", fontSize: 22 }}>{elapsedLabel(elapsed)}</strong>경과시간</div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <select
          value={region}
          onChange={(event) => setRegion(event.target.value)}
          disabled={running}
          style={{ padding: "12px 13px", border: "1px solid #dde0d8", borderRadius: 11, background: "white" }}
        >
          {REGIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        {!running ? (
          <button className="primary-button" disabled={!unchecked} onClick={() => void runAll()}>남은 전체 자동 실행</button>
        ) : (
          <button className="ghost-button" onClick={stop}>현재 2곳 후 중지</button>
        )}
      </div>

      <div className="notice">
        {message || "버튼 한 번으로 남은 가게를 2곳씩 계속 처리합니다."}
        <br />
        <small>페이지를 닫거나 모바일 브라우저가 완전히 절전되면 멈춥니다. 수동 10곳 버튼과 동시에 실행하지 마세요.</small>
      </div>
    </section>
  );
}
