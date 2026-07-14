import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav"><div className="brand"><span className="brand-mark">M</span><span>MapForYou<small>Multilingual Menu</small></span></div><div><Link href="/admin">Admin</Link><Link className="nav-cta" href="/store/standard-bread-seongsu">View sample</Link></div></nav>
      <section className="landing-hero"><div className="landing-copy"><p className="eyebrow">SEOUL MENU DISCOVERY</p><h1>한국의 메뉴를<br />영어와 일본어로.</h1><p>카카오맵의 매장 후보를 조사하고, 검수한 메뉴만 여행자에게 깔끔하게 보여주는 다국어 메뉴 서비스입니다.</p><div className="landing-actions"><Link className="primary-button link-button" href="/admin">관리자 앱 시작</Link><Link className="secondary-button link-button" href="/store/standard-bread-seongsu">공개 메뉴판 샘플</Link></div></div><div className="phone-mock"><div className="phone-top" /><div className="phone-image"><span>SEONGSU</span><strong>Standard Bread</strong></div><div className="phone-body"><div className="phone-tabs"><b>English</b><span>日本語</span></div><article><div><strong>Crème Brûlée French Toast</strong><small>크림브륄레 프렌치 토스트</small></div><b>₩13,000</b></article><article><div><strong>Maple Bacon Pistachio Toast</strong><small>메이플 베이컨 피스타치오 토스트</small></div><b>₩14,900</b></article></div></div></section>
      <section className="flow-section"><p className="eyebrow">ONE REPOSITORY, TWO EXPERIENCES</p><h2>A에서 조사하고, B에서 바로 공개</h2><div className="flow-grid"><article><span>A</span><h3>내부 관리자</h3><p>지역·업종별 매장을 수집하고 메뉴를 검수한 뒤 영어와 일본어를 입력합니다.</p></article><div className="flow-arrow">→</div><article><span>DB</span><h3>Supabase</h3><p>매장, 메뉴, 번역, 공개 상태를 한곳에 저장합니다.</p></article><div className="flow-arrow">→</div><article><span>B</span><h3>공개 메뉴판</h3><p>모바일에서 언어를 전환하고 지도와 매장 정보를 바로 확인합니다.</p></article></div></section>
    </main>
  );
}
