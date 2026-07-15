"use client";

import { useEffect, useRef, useState } from "react";

type Candidate = {
  placeId?: string | null;
  placeUrl?: string | null;
  searchUrl?: string;
  officialWebsite?: string | null;
  instagramUrl?: string | null;
  instagramUsername?: string | null;
  confidence?: number;
  reasons?: string[];
};

type InstagramRow = {
  sourceId: string;
  name: string;
  address: string;
  category: string;
  regionKey: string;
  instagramUrl: string | null;
  instagramUsername: string | null;
  instagramStatus: string;
  instagramSource: string | null;
  confidence: number | null;
  candidates: Candidate[];
  checkedAt: string | null;
  naverPlaceUrl: string | null;
  officialWebsiteUrl: string | null;
};

type StatusResponse = {
  total?: number;
  unchecked?: number;
  candidate?: number;
  verified?: number;
  notFound?: number;
  rows?: InstagramRow[];
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

const TARGET_BATCH_SIZE = 10;
const SERVER_CHUNK_SIZE = 2;
const REQUEST_TIMEOUT_MS = 55_000;

function regionLabel(value: string) {
  if (value === "seongsu") return "성수";
  if (value === "hongdae") return "홍대";
  return value || "지역 미확인";
}

function statusLabel(row: InstagramRow) {
  if (row.instagramStatus === "verified") {
    if (row.instagramSource === "naver_place_direct") return "네이버 링크 확인";
    if (row.instagramSource === "naver_official_website") return "공식 홈페이지 확인";
    return "확정";
  }
  if (row.instagramStatus === "candidate") return "장소 확인 필요";
  if (row.instagramStatus === "not_found") {
    return row.instagramSource === "naver_place_no_instagram" ? "인스타 없음" : "매칭 실패";
  }
  return "미확인";
}

function statusClass(status: string) {
  if (status === "verified") return "status-found";
  if (status === "candidate") return "status-partial";
  if (status === "not_found") return "status-missing";
  return "";
}

function elapsedLabel(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export default function NaverPlaceInstagramFinderV3() {
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState<StatusResponse>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [stopped, setStopped] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [phase, setPhase] = useState("");
  const stopRequestedRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    void loadStatus(region, true);
  }, [region]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function loadStatus(nextRegion = region, showLoading = false) {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(`/api/public-data/instagram?region=${encodeURIComponent(nextRegion)}&t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "현황 조회 실패");
      setStatus(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "현황 조회 실패");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function scanChunk(retry: boolean, chunkSize: number) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/public-data/naver-place-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, limit: chunkSize, retry }),
        signal: controller.signal,
      });
      const data = (await response.json()) as ScanResponse;
      if (!response.ok) throw new Error(data.error || "네이버 장소 확인 실패");
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("한 묶음이 55초를 넘겨 중단했습니다. 저장된 결과는 유지됩니다.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function scan(retry = false) {
    setRunning(true);
    setStopped(false);
    setProgress(0);
    setElapsedSeconds(0);
    setPhase("첫 2곳을 불러오는 중");
    stopRequestedRef.current = false;
    startedAtRef.current = Date.now();

    let processed = 0;
    let placeResolved = 0;
    let found = 0;
    let wasStopped = false;

    try {
      while (processed < TARGET_BATCH_SIZE && !stopRequestedRef.current) {
        const remaining = TARGET_BATCH_SIZE - processed;
        const chunkSize = Math.min(SERVER_CHUNK_SIZE, remaining);
        setPhase(`${processed + 1}~${processed + chunkSize}번째 가게 확인 중`);

        const data = await scanChunk(retry, chunkSize);
        const chunkProcessed = Number(data.processed || 0);
        processed += chunkProcessed;
        placeResolved += Number(data.placeResolved || 0);
        found += Number(data.found || 0);
        wasStopped = Boolean(data.stopped);
        setProgress(processed);
        setPhase(`${processed}/${TARGET_BATCH_SIZE} 저장 완료 · 결과 갱신 중`);
        await loadStatus(region, false);

        if (wasStopped || chunkProcessed === 0) break;
      }

      setStopped(wasStopped);
      if (stopRequestedRef.current) {
        setMessage(`${processed}곳까지 저장하고 사용자가 중지했습니다.`);
      } else if (wasStopped) {
        setMessage(`${processed}곳 처리 후 네이버 접근 제한이 감지돼 중단했습니다.`);
      } else {
        setMessage(`${processed}곳 처리 완료 · 장소 ${placeResolved}곳 확인 · 인스타그램 ${found}곳 저장`);
      }
    } catch (error) {
      setMessage(`${processed}곳까지 저장했습니다. ${error instanceof Error ? error.message : "처리 실패"}`);
      await loadStatus(region, false);
    } finally {
      setPhase("");
      setRunning(false);
    }
  }

  function requestStop() {
    stopRequestedRef.current = true;
    setPhase("현재 2곳이 끝나면 중지합니다");
  }

  async function saveAction(row: InstagramRow, action: "manual" | "not_found", url?: string) {
    setSavingId(row.sourceId);
    try {
      const response = await fetch("/api/public-data/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sourceId: row.sourceId, url, region }),
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "저장 실패");
      setStatus(data);
      setMessage(`${row.name}: 저장했습니다.`);
      if (action === "manual") {
        setManualDrafts((current) => {
          const next = { ...current };
          delete next[row.sourceId];
          return next;
        });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setSavingId("");
    }
  }

  return (
    <main style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 80px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 22 }}>
        <div>
          <p className="eyebrow">NAVER PLACE BROWSER CHECK</p>
          <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.05em" }}>
            네이버 장소에서 인스타 자동 확인
          </h1>
          <p style={{ maxWidth: 800, margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.65 }}>
            네이버 API가 아니라 서버 브라우저가 실제 장소 페이지를 열어, 등록된 인스타그램과 공식 홈페이지 링크를 확인합니다.
          </p>
        </div>
        <button className="ghost-button" disabled={loading || running} onClick={() => void loadStatus(region, true)}>
          현황 새로고침
        </button>
      </header>

      <section className="card">
        <div className="section-heading" style={{ marginBottom: 12 }}>
          <div>
            <span>NO API KEY</span>
            <h2>별도 API 없이 저속 확인</h2>
          </div>
          <strong>2곳당 보통 15~30초</strong>
        </div>
        <div className="notice" style={{ marginTop: 0 }}>
          2곳씩 최대 5회 실행합니다. 같은 숫자가 잠시 유지돼도 아래 경과시간이 움직이면 정상 처리 중입니다.
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 }}>
        {[
          ["전체", status.total ?? 0],
          ["미확인", status.unchecked ?? 0],
          ["장소 확인 필요", status.candidate ?? 0],
          ["인스타 확정", status.verified ?? 0],
          ["없음·실패", status.notFound ?? 0],
        ].map(([label, value]) => (
          <article key={String(label)} className="card" style={{ marginBottom: 0, padding: 18 }}>
            <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 800 }}>{label}</span>
            <strong style={{ display: "block", marginTop: 9, fontSize: 28 }}>{Number(value).toLocaleString("ko-KR")}</strong>
          </article>
        ))}
      </section>

      <section className="card">
        <div className="section-heading" style={{ marginBottom: 14 }}>
          <div>
            <span>LOW-SPEED BATCH</span>
            <h2>네이버 장소 자동 확인</h2>
          </div>
          <p>2곳씩 나누어 최대 10곳</p>
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
          <button className="primary-button" disabled={running || !status.unchecked} onClick={() => void scan(false)}>
            {running ? `${progress}/10 · ${elapsedLabel(elapsedSeconds)}` : "다음 10곳 자동 확인"}
          </button>
          {running ? (
            <button className="ghost-button" onClick={requestStop}>현재 2곳 후 중지</button>
          ) : (
            <button className="ghost-button" disabled={!(status.notFound || status.candidate)} onClick={() => void scan(true)}>
              없음·실패 10곳 재확인
            </button>
          )}
        </div>

        {running && (
          <div className="progress-box" aria-live="polite">
            <div className="progress-row">
              <strong>{phase}</strong>
              <span>{elapsedLabel(elapsedSeconds)} 경과</span>
            </div>
            <div className="progress-track"><span style={{ width: `${Math.max(4, progress * 10)}%` }} /></div>
            <small>현재 2곳의 응답이 끝나면 숫자와 최근 결과가 자동 갱신됩니다.</small>
          </div>
        )}

        {message && (
          <div className="notice" style={stopped ? { color: "#8b4a42", background: "#f5dfdc" } : undefined}>{message}</div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div><span>RESULTS</span><h2>최근 처리 결과</h2></div>
          <p>네이버 장소·홈페이지·인스타 링크 확인</p>
        </div>

        {loading ? (
          <div className="empty-state compact">현황을 불러오는 중입니다.</div>
        ) : status.rows?.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            {status.rows.map((row) => {
              const candidate = row.candidates?.[0];
              const placeUrl = row.naverPlaceUrl || candidate?.placeUrl || candidate?.searchUrl;
              const website = row.officialWebsiteUrl || candidate?.officialWebsite;
              const draft = manualDrafts[row.sourceId] ?? "";
              const saving = savingId === row.sourceId;
              return (
                <article key={row.sourceId} style={{ padding: 18, border: "1px solid var(--line)", borderRadius: 16, background: "#fbfcf8" }}>
                  <div className="result-grid">
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <strong style={{ fontSize: 16 }}>{row.name}</strong>
                        <span className={`status-pill ${statusClass(row.instagramStatus)}`}>{statusLabel(row)}</span>
                        <span className="status-pill">{regionLabel(row.regionKey)}</span>
                      </div>
                      <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
                        {row.address || "주소 없음"}{row.category ? ` · ${row.category}` : ""}
                      </p>
                      {row.checkedAt && <small style={{ display: "block", marginTop: 7, color: "var(--muted)" }}>{new Date(row.checkedAt).toLocaleString("ko-KR")}</small>}
                    </div>
                    <div>
                      {row.instagramUrl ? (
                        <a className="text-link" href={row.instagramUrl} target="_blank" rel="noreferrer">@{row.instagramUsername || row.instagramUrl} ↗</a>
                      ) : (
                        <div style={{ display: "grid", gap: 5 }}>
                          {(candidate?.reasons || ["인스타그램 링크를 찾지 못했습니다."]).map((reason) => (
                            <span key={reason} style={{ color: "var(--muted)", fontSize: 11 }}>{reason}</span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        {placeUrl && <a className="status-pill" href={placeUrl} target="_blank" rel="noreferrer">네이버 장소 ↗</a>}
                        {website && <a className="status-pill" href={website} target="_blank" rel="noreferrer">공식 홈페이지 ↗</a>}
                      </div>
                    </div>
                  </div>

                  {!row.instagramUrl && (
                    <>
                      <div className="manual-grid">
                        <input
                          value={draft}
                          onChange={(event) => setManualDrafts((current) => ({ ...current, [row.sourceId]: event.target.value }))}
                          placeholder="추가로 확인한 https://www.instagram.com/사용자명/"
                          disabled={saving}
                          style={{ minWidth: 0, padding: "11px 12px", border: "1px solid #dde0d8", borderRadius: 11 }}
                        />
                        <button className="ghost-button" disabled={saving || !draft.trim()} onClick={() => void saveAction(row, "manual", draft)}>직접 URL 확정</button>
                      </div>
                      <div className="action-row" style={{ marginTop: 10 }}>
                        <button className="text-button" disabled={saving} onClick={() => void saveAction(row, "not_found")}>계정 없음 처리</button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><strong>아직 처리한 가게가 없습니다.</strong><span>지역을 선택하고 자동 확인을 실행해주세요.</span></div>
        )}
      </section>

      <style jsx>{`
        .progress-box { margin-top: 14px; padding: 15px; border-radius: 14px; background: #eef5df; }
        .progress-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
        .progress-row span, .progress-box small { color: var(--muted); }
        .progress-track { height: 8px; margin: 11px 0 8px; overflow: hidden; border-radius: 999px; background: rgba(80, 100, 55, .14); }
        .progress-track span { display: block; height: 100%; border-radius: inherit; background: #97b75d; transition: width .25s ease; }
        .result-grid { display: grid; grid-template-columns: minmax(180px, .8fr) minmax(260px, 1.2fr); gap: 18px; }
        .manual-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; margin-top: 14px; }
        @media (max-width: 760px) {
          .result-grid, .manual-grid { grid-template-columns: 1fr; }
          .progress-row { align-items: flex-start; flex-direction: column; gap: 4px; }
        }
      `}</style>
    </main>
  );
}
