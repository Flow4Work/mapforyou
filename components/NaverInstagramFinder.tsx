"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Candidate = {
  url: string;
  username: string;
  title: string;
  description: string;
  score: number;
  query: string;
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
  searchQuery: string | null;
  checkedAt: string | null;
};

type StatusResponse = {
  total?: number;
  unchecked?: number;
  candidate?: number;
  verified?: number;
  notFound?: number;
  rejected?: number;
  rows?: InstagramRow[];
  processed?: number;
  found?: number;
  message?: string;
  error?: string;
};

type CredentialStatus = {
  configured?: boolean;
  source?: "environment" | "admin";
  updatedAt?: string | null;
  error?: string;
};

const REGION_OPTIONS = [
  { value: "all", label: "성수 + 홍대" },
  { value: "seongsu", label: "성수" },
  { value: "hongdae", label: "홍대" },
];

function regionLabel(regionKey: string) {
  if (regionKey === "seongsu") return "성수";
  if (regionKey === "hongdae") return "홍대";
  return regionKey || "지역 미확인";
}

function statusLabel(status: string) {
  if (status === "verified") return "확정";
  if (status === "candidate") return "후보 발견";
  if (status === "not_found") return "결과 없음";
  if (status === "rejected") return "후보 제외";
  return "미확인";
}

function statusClass(status: string) {
  if (status === "verified") return "status-found";
  if (status === "candidate") return "status-partial";
  if (status === "not_found" || status === "rejected") return "status-missing";
  return "";
}

export default function NaverInstagramFinder() {
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState<StatusResponse>({});
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>({});
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([loadStatus(region), loadCredentialStatus()]);
  }, [region]);

  async function loadStatus(nextRegion = region) {
    setLoading(true);
    try {
      const response = await fetch(`/api/public-data/instagram?region=${encodeURIComponent(nextRegion)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "인스타그램 현황 조회 실패");
      setStatus(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인스타그램 현황 조회 실패");
    } finally {
      setLoading(false);
    }
  }

  async function loadCredentialStatus() {
    try {
      const response = await fetch("/api/naver/search-credentials", { cache: "no-store" });
      const data = (await response.json()) as CredentialStatus;
      setCredentialStatus(data);
    } catch {
      setCredentialStatus({ configured: false });
    }
  }

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) {
      setMessage("Client ID와 Client Secret을 모두 입력해주세요.");
      return;
    }

    setSavingCredentials(true);
    setMessage("");
    try {
      const response = await fetch("/api/naver/search-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      const data = (await response.json()) as CredentialStatus & { saved?: boolean };
      if (!response.ok) throw new Error(data.error || "네이버 검색 키 저장 실패");

      setClientId("");
      setClientSecret("");
      setCredentialStatus({ configured: true, source: "admin", updatedAt: data.updatedAt ?? null });
      setMessage("네이버 검색 API 연결을 확인하고 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "네이버 검색 키 저장 실패");
    } finally {
      setSavingCredentials(false);
    }
  }

  async function scanBatch(retry = false) {
    setRunning(true);
    setMessage(retry ? "결과가 없었던 가게 10곳을 다시 찾는 중입니다." : "다음 가게 10곳을 찾는 중입니다.");

    try {
      const response = await fetch("/api/public-data/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", region, limit: 10, retry }),
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "인스타그램 검색 실패");
      setStatus(data);
      setMessage(data.message || "10곳 검색을 완료했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인스타그램 검색 실패");
    } finally {
      setRunning(false);
    }
  }

  async function saveStoreAction(
    row: InstagramRow,
    action: "verify" | "manual" | "not_found" | "reject",
    url?: string,
  ) {
    setSavingId(row.sourceId);
    setMessage("");
    try {
      const response = await fetch("/api/public-data/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sourceId: row.sourceId, url, region }),
      });
      const data = (await response.json()) as StatusResponse;
      if (!response.ok) throw new Error(data.error || "저장 실패");
      setStatus(data);
      setMessage(`${row.name}: ${action === "verify" || action === "manual" ? "공식 계정으로 확정했습니다." : "후보 상태를 변경했습니다."}`);
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

  const rows = status.rows ?? [];
  const recentRows = useMemo(
    () => [...rows].sort((a, b) => String(b.checkedAt ?? "").localeCompare(String(a.checkedAt ?? ""))),
    [rows],
  );

  return (
    <main style={{ width: "min(1180px, calc(100% - 40px))", margin: "24px auto 80px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          marginBottom: 22,
        }}
      >
        <div>
          <p className="eyebrow">NAVER WEB SEARCH</p>
          <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.05em" }}>
            가게 인스타그램 찾기
          </h1>
          <p style={{ maxWidth: 760, margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.65 }}>
            저장된 성수·홍대 가게를 10곳씩 검색합니다. 후보는 자동 확정하지 않으며, 직접 확인한 계정만 공식 URL로 저장됩니다.
          </p>
        </div>
        <button className="ghost-button" disabled={loading || running} onClick={() => void loadStatus()}>
          현황 새로고침
        </button>
      </header>

      <section className="card">
        <div className="section-heading" style={{ marginBottom: 16 }}>
          <div>
            <span>SEARCH API KEY</span>
            <h2>네이버 검색 API 연결</h2>
          </div>
          <strong>{credentialStatus.configured ? "연결됨" : "키 필요"}</strong>
        </div>

        <div className="notice" style={{ marginTop: 0, marginBottom: 14 }}>
          현재 지도에 쓰는 NAVER Cloud Maps 키와는 별개입니다. 네이버 개발자센터 애플리케이션에서 ‘검색’ API를 추가한 뒤 Client ID와 Client Secret을 넣어야 합니다.
        </div>

        <form
          onSubmit={saveCredentials}
          style={{ display: "grid", gridTemplateColumns: "minmax(180px, .8fr) minmax(240px, 1.2fr) auto", gap: 10 }}
        >
          <input
            type="password"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="X-Naver-Client-Id"
            autoComplete="off"
            spellCheck={false}
            disabled={savingCredentials}
            style={{ minWidth: 0, padding: "12px 13px", border: "1px solid #dde0d8", borderRadius: 11 }}
          />
          <input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder="X-Naver-Client-Secret"
            autoComplete="off"
            spellCheck={false}
            disabled={savingCredentials}
            style={{ minWidth: 0, padding: "12px 13px", border: "1px solid #dde0d8", borderRadius: 11 }}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={savingCredentials || !clientId.trim() || !clientSecret.trim()}
          >
            {savingCredentials ? "연결 확인 중…" : "확인 후 저장"}
          </button>
        </form>
        <div style={{ marginTop: 9, color: "var(--muted)", fontSize: 12 }}>
          {credentialStatus.configured
            ? credentialStatus.source === "environment"
              ? "Vercel 환경변수에 저장된 키를 사용 중입니다."
              : `관리자에서 저장한 키 사용 중${credentialStatus.updatedAt ? ` · ${new Date(credentialStatus.updatedAt).toLocaleString("ko-KR")}` : ""}`
            : "네이버 검색 키가 아직 없습니다."}
        </div>
      </section>

      <section
        aria-label="인스타그램 수집 현황"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {[
          ["전체 가게", status.total ?? 0],
          ["미확인", status.unchecked ?? 0],
          ["후보 발견", status.candidate ?? 0],
          ["확정", status.verified ?? 0],
          ["결과 없음", status.notFound ?? 0],
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
            <span>BATCH SEARCH</span>
            <h2>10곳씩 후보 찾기</h2>
          </div>
          <p>가게당 웹문서 결과 최대 10개 확인</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            disabled={running}
            style={{ padding: "12px 13px", border: "1px solid #dde0d8", borderRadius: 11, background: "white" }}
          >
            {REGION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            className="primary-button"
            disabled={running || !credentialStatus.configured || !status.unchecked}
            onClick={() => void scanBatch(false)}
          >
            {running ? "네이버에서 찾는 중…" : "다음 10곳 찾기"}
          </button>
          <button
            className="ghost-button"
            disabled={running || !credentialStatus.configured || !status.notFound}
            onClick={() => void scanBatch(true)}
          >
            결과 없음 10곳 다시 찾기
          </button>
        </div>

        <p className="fine-print" style={{ fontSize: 12 }}>
          지역검색 API로 10곳을 가져오는 기능이 아닙니다. DB에 이미 저장된 가게 10곳을 골라 웹문서 검색 API로 각각 공식 인스타 후보를 찾습니다.
        </p>
        {message && <div className="notice">{message}</div>}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span>REVIEW QUEUE</span>
            <h2>최근 검색 결과</h2>
          </div>
          <p>후보 링크를 열어 실제 가게 계정인지 확인</p>
        </div>

        {loading ? (
          <div className="empty-state compact">검색 현황을 불러오는 중입니다.</div>
        ) : recentRows.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            {recentRows.map((row) => {
              const best = row.candidates[0] ?? null;
              const manualValue = manualDrafts[row.sourceId] ?? "";
              const saving = savingId === row.sourceId;

              return (
                <article
                  key={row.sourceId}
                  style={{ padding: 18, border: "1px solid var(--line)", borderRadius: 16, background: "#fbfcf8" }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(180px, .8fr) minmax(240px, 1.2fr)",
                      gap: 18,
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <strong style={{ fontSize: 16 }}>{row.name}</strong>
                        <span className={`status-pill ${statusClass(row.instagramStatus)}`}>
                          {statusLabel(row.instagramStatus)}
                        </span>
                        <span className="status-pill">{regionLabel(row.regionKey)}</span>
                      </div>
                      <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
                        {row.address || "주소 없음"}{row.category ? ` · ${row.category}` : ""}
                      </p>
                      {row.checkedAt && (
                        <small style={{ display: "block", marginTop: 7, color: "var(--muted)" }}>
                          검색: {new Date(row.checkedAt).toLocaleString("ko-KR")}
                        </small>
                      )}
                    </div>

                    <div>
                      {row.instagramStatus === "verified" && row.instagramUrl ? (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9 }}>
                          <a className="text-link" href={row.instagramUrl} target="_blank" rel="noreferrer">
                            @{row.instagramUsername || row.instagramUrl} ↗
                          </a>
                          <span className="status-pill status-found">공식 URL 저장됨</span>
                        </div>
                      ) : best ? (
                        <>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9 }}>
                            <a className="text-link" href={best.url} target="_blank" rel="noreferrer">
                              @{best.username} ↗
                            </a>
                            <span className={`status-pill ${best.score >= 75 ? "status-found" : "status-partial"}`}>
                              신뢰도 {best.score}
                            </span>
                          </div>
                          <p style={{ margin: "7px 0 0", fontSize: 12, lineHeight: 1.55 }}>
                            {best.title || "제목 없음"}
                          </p>
                          {best.description && (
                            <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}>
                              {best.description.slice(0, 180)}
                            </p>
                          )}
                          {row.candidates.length > 1 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 9 }}>
                              {row.candidates.slice(1, 5).map((candidate) => (
                                <a
                                  key={candidate.username}
                                  className="status-pill"
                                  href={candidate.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  @{candidate.username} · {candidate.score}
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                          네이버 웹문서 검색에서 인스타그램 프로필 후보를 찾지 못했습니다.
                        </p>
                      )}
                    </div>
                  </div>

                  {row.instagramStatus !== "verified" && (
                    <>
                      <div className="action-row" style={{ marginTop: 14 }}>
                        {best && (
                          <button
                            className="secondary-button"
                            disabled={saving}
                            onClick={() => void saveStoreAction(row, "verify", best.url)}
                          >
                            이 계정 확정
                          </button>
                        )}
                        {best && (
                          <button
                            className="ghost-button"
                            disabled={saving}
                            onClick={() => void saveStoreAction(row, "reject")}
                          >
                            후보 아님
                          </button>
                        )}
                        <button
                          className="text-button"
                          disabled={saving}
                          onClick={() => void saveStoreAction(row, "not_found")}
                        >
                          계정 없음 처리
                        </button>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 9,
                          marginTop: 13,
                        }}
                      >
                        <input
                          value={manualValue}
                          onChange={(event) =>
                            setManualDrafts((current) => ({ ...current, [row.sourceId]: event.target.value }))
                          }
                          placeholder="직접 확인한 https://www.instagram.com/사용자명/"
                          disabled={saving}
                          style={{ minWidth: 0, padding: "11px 12px", border: "1px solid #dde0d8", borderRadius: 11 }}
                        />
                        <button
                          className="ghost-button"
                          disabled={saving || !manualValue.trim()}
                          onClick={() => void saveStoreAction(row, "manual", manualValue)}
                        >
                          직접 URL 확정
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <strong>아직 검색한 가게가 없습니다.</strong>
            <span>네이버 검색 키를 연결하고 ‘다음 10곳 찾기’를 실행해주세요.</span>
          </div>
        )}
      </section>

      <style jsx>{`
        @media (max-width: 760px) {
          form,
          article > div,
          article > div + div {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
