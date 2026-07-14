"use client";

import { useEffect, useMemo, useState } from "react";

type Menu = {
  menuId: string;
  restaurantId: string;
  restaurantNameKo: string;
  restaurantNameEn: string;
  restaurantNameJa: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  price: number;
  isSpecialty: boolean;
};

type RestaurantMenu = {
  restaurantId: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  menus: Menu[];
};

type MenuResponse = {
  pageNo?: number;
  nextPage?: number | null;
  restaurants?: RestaurantMenu[];
  stats?: {
    menuCount: number;
    restaurantCount: number;
    englishMatched: number;
    japaneseMatched: number;
  };
  error?: string;
};

const TOKEN_KEY = "mapforyou-redtable-token";

function priceLabel(price: number) {
  return price > 0 ? `${price.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

export default function RedTableMenuBrowser() {
  const [token, setToken] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [restaurants, setRestaurants] = useState<RestaurantMenu[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<MenuResponse["stats"] | null>(null);

  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return restaurants;
    return restaurants.filter((restaurant) => {
      const text = [restaurant.nameKo, restaurant.nameEn, restaurant.nameJa, ...restaurant.menus.flatMap((menu) => [menu.nameKo, menu.nameEn, menu.nameJa])].join(" ").toLowerCase();
      return text.includes(keyword);
    });
  }, [query, restaurants]);

  const selected = restaurants.find((restaurant) => restaurant.restaurantId === selectedId) ?? filtered[0] ?? null;

  async function loadMenus(next = false) {
    const savedToken = token.trim() || sessionStorage.getItem(TOKEN_KEY)?.trim() || "";
    if (!savedToken) {
      setMessage("위의 토큰 연결 단계에서 토큰을 먼저 입력하세요.");
      return;
    }

    const requestPage = next ? pageNo + 1 : pageNo;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/redtable/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: savedToken, pageNo: requestPage }),
      });
      const data = (await response.json()) as MenuResponse;
      if (!response.ok) throw new Error(data.error || "메뉴 데이터를 불러오지 못했습니다.");

      const incoming = data.restaurants ?? [];
      setRestaurants(incoming);
      setPageNo(data.pageNo ?? requestPage);
      setStats(data.stats ?? null);
      setSelectedId(incoming[0]?.restaurantId ?? "");
      setMessage(`메뉴 ${data.stats?.menuCount ?? 0}개를 식당 ${data.stats?.restaurantCount ?? 0}곳으로 묶었습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메뉴 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card" style={{ padding: 24, marginTop: 20 }}>
      <div className="section-heading">
        <div><span>STEP 3</span><h2>한·영·일 메뉴판 가져오기</h2></div>
        <strong>API 페이지 {pageNo}</strong>
      </div>

      <p style={{ color: "var(--muted)", lineHeight: 1.65, marginTop: 0 }}>
        같은 메뉴 ID를 기준으로 한국어·영어·일본어를 합쳐 실제 메뉴판 형태로 보여줍니다. 한 번에 최대 1,000개 메뉴가 들어옵니다.
      </p>

      <div className="action-row">
        <button className="primary-button" disabled={loading} onClick={() => loadMenus(false)}>{loading ? "메뉴 불러오는 중…" : `${pageNo}페이지 메뉴 가져오기`}</button>
        <button className="secondary-button" disabled={loading} onClick={() => loadMenus(true)}>다음 1,000개</button>
      </div>

      {message && <div className="notice">{message}</div>}
      {stats && <p className="fine-print">식당 {stats.restaurantCount}곳 · 메뉴 {stats.menuCount}개 · 영어 연결 {stats.englishMatched}개 · 일본어 연결 {stats.japaneseMatched}개</p>}

      {restaurants.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, .7fr) minmax(0, 1.3fr)", gap: 18, marginTop: 22 }}>
          <div>
            <label className="field" style={{ marginBottom: 12 }}>
              <span>식당·메뉴 검색</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="식당명 또는 메뉴명" />
            </label>
            <div style={{ display: "grid", gap: 8, maxHeight: 620, overflowY: "auto", paddingRight: 4 }}>
              {filtered.map((restaurant) => (
                <button
                  key={restaurant.restaurantId}
                  onClick={() => setSelectedId(restaurant.restaurantId)}
                  style={{ textAlign: "left", border: selected?.restaurantId === restaurant.restaurantId ? "2px solid var(--green)" : "1px solid var(--line)", borderRadius: 12, padding: 12, background: "white" }}
                >
                  <strong>{restaurant.nameKo || restaurant.nameEn || restaurant.nameJa}</strong>
                  <div style={{ marginTop: 5, fontSize: 12, color: "var(--muted)" }}>메뉴 {restaurant.menus.length}개 · ID {restaurant.restaurantId}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            {selected ? (
              <div style={{ border: "1px solid var(--line)", borderRadius: 18, padding: 22, background: "white" }}>
                <p className="eyebrow">MULTILINGUAL MENU</p>
                <h3 style={{ fontSize: 28, margin: "0 0 4px" }}>{selected.nameKo || selected.nameEn}</h3>
                <p style={{ margin: "0 0 22px", color: "var(--muted)" }}>{selected.nameEn}{selected.nameJa ? ` · ${selected.nameJa}` : ""}</p>

                <div style={{ display: "grid", gap: 12 }}>
                  {selected.menus.map((menu) => (
                    <article key={menu.menuId} style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                        <div>
                          <strong style={{ fontSize: 17 }}>{menu.nameKo || "이름 없음"}</strong>
                          {menu.isSpecialty && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: "var(--green)" }}>대표</span>}
                          <div style={{ marginTop: 5, color: "var(--muted)", fontSize: 14 }}>{menu.nameEn || "영문 없음"}</div>
                          <div style={{ marginTop: 3, color: "var(--muted)", fontSize: 14 }}>{menu.nameJa || "일문 없음"}</div>
                        </div>
                        <strong style={{ whiteSpace: "nowrap" }}>{priceLabel(menu.price)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : <div className="empty-state"><strong>식당을 선택하세요.</strong></div>}
          </div>
        </div>
      )}
    </section>
  );
}
