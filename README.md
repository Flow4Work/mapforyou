# MapForYou

하나의 Next.js 프로젝트 안에 두 화면을 둔 MVP입니다.

- `/admin` — A: 내부 매장·메뉴 조사 앱
- `/store/[slug]` — B: 영어·일본어 공개 메뉴판
- `/store/standard-bread-seongsu` — 기본 샘플

## 현재 가능한 것

1. Admin 화면에 카카오 REST API 키 직접 입력
2. 성수·홍대·건대/자양에서 치킨·카페·삼겹살 등 후보 검색
3. 검사 이력이 있는 장소 ID를 제외하고 다음 목록 수집
4. 카카오 장소 상세페이지에서 메뉴 존재 여부를 best-effort 검사
5. 메뉴 직접 추가·수정, 영어·일본어 번역 입력
6. 공개 후 같은 브라우저에서 B 화면 확인
7. Supabase 연결 시 공용 DB에 저장하고 외부 사용자에게 공개

> 카카오 공식 Local API는 메뉴 데이터를 제공하지 않습니다. 메뉴 검사는 공개 상세페이지 구조를 분석하는 보조 기능이므로 카카오 페이지 변경이나 차단에 따라 일부 매장은 수동 검수가 필요합니다.

## Vercel 배포

GitHub 저장소를 Vercel에서 Import하면 Next.js로 자동 인식됩니다. Kakao 키는 환경변수가 아니라 `/admin` 화면에 직접 입력합니다.

## Supabase 연결

1. Supabase에서 프로젝트 생성
2. SQL Editor에서 `supabase/schema.sql` 실행
3. Vercel 환경변수에 아래 3개 추가

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

4. Vercel에서 Redeploy

`SUPABASE_SERVICE_ROLE_KEY`는 GitHub나 브라우저에 절대 노출하지 않습니다.

## 로컬 실행

```bash
npm install
npm run dev
```
