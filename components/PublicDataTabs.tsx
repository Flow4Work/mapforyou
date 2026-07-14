import Link from "next/link";

export default function PublicDataTabs({ active }: { active: "collect" | "images" }) {
  return (
    <nav
      aria-label="공공데이터 관리자 메뉴"
      style={{
        display: "flex",
        gap: 8,
        maxWidth: 1180,
        margin: "24px auto 0",
        padding: "0 20px",
        overflowX: "auto",
      }}
    >
      <Link
        href="/admin/public-data"
        className={active === "collect" ? "primary-button" : "ghost-button"}
        aria-current={active === "collect" ? "page" : undefined}
        style={{ whiteSpace: "nowrap" }}
      >
        가게·메뉴 수집
      </Link>
      <Link
        href="/admin/public-data/images"
        className={active === "images" ? "primary-button" : "ghost-button"}
        aria-current={active === "images" ? "page" : undefined}
        style={{ whiteSpace: "nowrap" }}
      >
        사진 보강·직접 확인
      </Link>
    </nav>
  );
}
