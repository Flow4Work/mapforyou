import Link from "next/link";

type AdminTab = "collect" | "images" | "analytics";

const tabs: Array<{ key: AdminTab; href: string; label: string }> = [
  { key: "collect", href: "/admin/public-data", label: "가게·메뉴 수집" },
  { key: "images", href: "/admin/public-data/images", label: "사진 보강·직접 확인" },
  { key: "analytics", href: "/admin/public-data/analytics", label: "이용 현황" },
];

export default function PublicDataTabs({ active }: { active: AdminTab }) {
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
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={active === tab.key ? "primary-button" : "ghost-button"}
          aria-current={active === tab.key ? "page" : undefined}
          style={{ whiteSpace: "nowrap" }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
