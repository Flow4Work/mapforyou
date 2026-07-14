"use client";

import { useEffect, useRef, useState } from "react";

type Status = {
  configured?: boolean;
  missing?: number;
  checked?: number;
  remainingUnchecked?: number;
  error?: string;
};

type BatchResult = Status & {
  processed?: number;
  matched?: number;
  saved?: number;
  noMatch?: number;
  noImage?: number;
  samples?: Array<{ name: string; result: string }>;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function TourApiImageBackfill() {
  const [status, setStatus] = useState<Status>({});
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState("TourAPI 연결 확인 중");
  const [stats, setStats] = useState({ processed: 0, matched: 0, saved: 0, noMatch: 0, noImage: 0 });
  const [samples, setSamples] = useState<Array<{ name: string; result: string }>>([]);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadStatus();
    return () => controllerRef.current?.abort();
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch("/api/tourapi/images", { cache: "no-store" });
      const data = (await response.json()) as Status;
      if (!response.ok) throw new Error(data.error || "TourAPI 현황 조회 실패");
      setStatus(data);
      setStage(data.configured
        ? `TourAPI 확인 대기 ${data.remainingUnchecked ?? 0}곳`
        : "한국관광공사 API 키 등록 필요");
      return data;
    } catch (error) {
      setStage("TourAPI 연결 오류");
      setMessage(error instanceof Error ? error.message : "TourAPI 현황 조회 실패");
      return null;
    }
  }

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) return;

    setSavingKey(true);
    setMessage("");
    try {
      const response = await fetch("/api/tourapi/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = (await response.json()) as { configured?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "TourAPI 키 저장 실패");
      setApiKey("");
      setMessage("한국관광공사 TourAPI 키를 Supabase에 별도로 저장했습니다.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TourAPI 키 저장 실패");
    } finally {
      setSavingKey(false);
    }
  }

  async function runBatch(signal: AbortSignal) {
    const response = await fetch("/api/tourapi/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 4 }),
      signal,
    });
    const data = (await response.json()) as BatchResult;
    if (!response.ok) throw new Error(data.error || "TourAPI 이미지 보강 실패");
    return data;
  }

  async function start() {
    const latest = await loadStatus();
    if (!latest?.configured) {
      setMessage("먼저 한국관광공사 TourAPI 키를 등록해주세요.");
      return;
    }
    if (!latest.remainingUnchecked) {
      setMessage("TourAPI로 확인할 사진 없는 가게가 남아 있지 않습니다.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setMessage("");
    setSamples([]);
    setStats({ processed: 0, matched: 0, saved: 0, noMatch: 0, noImage: 0 });

    let stoppedForNoProgress = false;
    try {
      let remaining = latest.remainingUnchecked;
      let stagnantRuns = 0;
      while (remaining > 0) {
        setStage(`TourAPI에서 ${remaining}곳의 음식·대표 이미지를 확인 중`);
        const data = await runBatch(controller.signal);

        setStatus(data);
        setStats((current) => ({
          processed: current.processed + Number(data.processed ?? 0),
          matched: current.matched + Number(data.matched ?? 0),
          saved: current.saved + Number(data.saved ?? 0),
          noMatch: current.noMatch + Number(data.noMatch ?? 0),
          noImage: current.noImage + Number(data.noImage ?? 0),
        }));
        setSamples((current) => [...(data.samples ?? []), ...current].slice(0, 12));

        const nextRemaining = Number(data.remainingUnchecked ?? 0);
        if (nextRemaining >= remaining) stagnantRuns += 1;
        else stagnantRuns = 0;
        remaining = nextRemaining;

        if (stagnantRuns >= 2) {
          stoppedForNoProgress = true;
          break;
        }
      }

      const finalStatus = await loadStatus();
      setStage(stoppedForNoProgress ? "TourAPI 일부 가게 처리 중단" : "TourAPI 이미지 보강 완료");
      setMessage(stoppedForNoProgress
        ? `같은 가게에서 API 오류가 반복돼 자동 실행을 멈췄습니다. 현재 대기 ${finalStatus?.remainingUnchecked ?? 0}곳입니다.`
        : `TourAPI 확인을 마쳤습니다. 현재 사진 없는 가게는 ${finalStatus?.missing ?? 0}곳입니다.`);
      window.dispatchEvent(new CustomEvent("mapforyou:images-updated"));
    } catch (error) {
      if (isAbortError(error)) {
        setStage("TourAPI 이미지 보강 중지");
        setMessage("중지했습니다. 이미 연결된 사진은 유지됩니다.");
      } else {
        setStage("TourAPI 이미지 보강 오류");
        setMessage(error instanceof Error ? error.message : "TourAPI 이미지 보강 실패");
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  }

  async function resetChecks() {
    if (running) return;
    setMessage("");
    try {
      const response = await fetch("/api/tourapi/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = (await response.json()) as Status;
      if (!response.ok) throw new Error(data.error || "TourAPI 확인 기록 초기화 실패");
      setStatus(data);
      setStage(`TourAPI 재확인 대기 ${data.remainingUnchecked ?? 0}곳`);
      setMessage("이미지가 없었던 가게도 TourAPI에서 다시 확인할 수 있게 초기화했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "초기화 실패");
    }
  }

  const total = Number(status.missing ?? 0);
  const checked = Number(status.checked ?? 0);
  const progress = total ? Math.min(100, Math.round((checked / total) * 100)) : 100;

  return (
    <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 20px" }}>
      <section className="card" style={{ padding: 20 }}>
        <div className="section-heading" style={{ marginBottom: 14 }}>
          <div>
            <span>STEP 2 · TOUR API</span>
            <h2 style={{ marginBottom: 4 }}>한국관광공사 이미지 보강</h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
              REDTABLE에 사진이 없는 성수·홍대 가게만 음식메뉴 이미지 → 대표 이미지 → 일반 이미지 순으로 확인합니다.
            </p>
          </div>
          <strong>{status.configured ? "키 등록됨" : "키 없음"}</strong>
        </div>

        {!status.configured && (
          <form onSubmit={(event) => void saveKey(event)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, marginBottom: 16 }}>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="한국관광공사 KorService2 인증키"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="secondary-button" disabled={savingKey || !apiKey.trim()}>
              {savingKey ? "저장 중…" : "TourAPI 키 저장"}
            </button>
          </form>
        )}

        <div className="action-row">
          <button
            className="primary-button"
            disabled={running || !status.configured || !status.remainingUnchecked}
            onClick={() => void start()}
          >
            {running ? "TourAPI 이미지 확인 중…" : `남은 ${status.remainingUnchecked ?? 0}곳 TourAPI 보강`}
          </button>
          {running && <button className="secondary-button" onClick={() => controllerRef.current?.abort()}>즉시 중지</button>}
          <button className="ghost-button" disabled={running} onClick={() => void loadStatus()}>현황 새로고침</button>
          <button className="text-button" disabled={running || !status.configured} onClick={() => void resetChecks()}>확인 기록 초기화</button>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
            <strong>{stage}</strong><span>{progress}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "var(--green)", transition: "width .25s ease" }} />
          </div>
          <p className="fine-print">
            사진 없음 {status.missing ?? 0}곳 · TourAPI 확인 {status.checked ?? 0}곳 · 대기 {status.remainingUnchecked ?? 0}곳
          </p>
        </div>

        {(stats.processed > 0 || samples.length > 0) && (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 14, background: "#f5f7f0", fontSize: 12 }}>
            <strong>처리 {stats.processed} · 매칭 {stats.matched} · 사진 연결 {stats.saved} · 매칭 없음 {stats.noMatch} · 이미지 없음 {stats.noImage}</strong>
            {samples.length > 0 && (
              <div style={{ display: "grid", gap: 5, marginTop: 10, color: "var(--muted)" }}>
                {samples.map((sample, index) => <span key={`${sample.name}-${index}`}>{sample.name} — {sample.result}</span>)}
              </div>
            )}
          </div>
        )}

        {message && <div className="notice">{message}</div>}
        <p className="fine-print">이미지 출처와 저작권 유형(Type1·Type3·unknown)을 Supabase에 함께 기록합니다.</p>
      </section>
    </div>
  );
}
