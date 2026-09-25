# MapForYou

서울 음식점과 메뉴를 영어/일본어로 탐색하는 Next.js 서비스입니다. 공개 첫 화면은 성수와 홍대를 지원하며, 별도 관리자 화면에서 장소와 메뉴를 조사합니다.

## 공개 데이터 기준 (2026-09-25)

- 홍대 공개 탐색: 위치, 영문/일문 표기, 사진이 검증된 신규 음식점 40곳, 메뉴 1,454개, 연결된 메뉴 이미지 1,412개
- 기존 마포구 전역 데이터 160곳은 DB에서 삭제하지 않고 유지합니다. 이 중 90곳은 현재 홍대 지도 범위 밖이며, 기존 데이터 전부 영문/일문 상호명이 누락되어 공개 홍대 목록에서는 제외합니다. 기존 매장 상세 링크는 유지하면서 오래된 미검수 자료임을 표시합니다.
- 성수: 게시된 110곳
- 확장 시점의 이름, 네이버 장소 ID, 메뉴/이미지 수: `data/hongdae-2026-09-25.json`
- 새 음식점 40곳의 영문/일문 상호명과 핵심 메뉴 118개의 번역을 별도로 검수했습니다. 변경 기록: `data/hongdae-2026-09-25-name-curation.json`, `data/hongdae-2026-09-25-menu-curation.json`. 나머지 메뉴 번역은 자동 번역 기반이므로 전체 전문가 검수를 의미하지 않습니다.
- 최신 수치는 Supabase `public_data_restaurants`와 `public_data_menus`에서 확인합니다. 데이터는 이후 변경될 수 있습니다.

## 주요 화면과 API

- `/`: 영어/일본어 음식점 탐색, 홍대/성수 선택, 메뉴와 사진, 지도
- `/admin`: 내부 장소 및 메뉴 조사
- `/api/discovery?perRegion=150&offset=0`: 페이지네이션된 공개 장소와 메뉴

## 로컬 실행과 기본 검증

```bash
npm install
npm run dev
npm run lint
npm run build
```

프로덕션 빌드로 확인하려면 `npm run start -- -p 3020`을 실행합니다. 다른 터미널에서 아래 명령으로 DB 조회, 지역 필터, 모바일/데스크톱 렌더링, 일본어 전환을 검사합니다.

```bash
npm run qa:hongdae -- http://127.0.0.1:3020 --browser
```

현재 로컬 환경에 NAVER Maps 인증키가 없다면 지도 SDK는 로드되지 않습니다. 지도까지 검증할 때는 등록된 도메인과 유효한 키를 설정한 실제 환경에서 `--require-map`을 함께 사용합니다.

## 환경변수

`.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID`를 설정합니다. NAVER Maps에서 실제 서비스 도메인을 허용해야 지도가 로드됩니다. 개인용 비밀키를 `NEXT_PUBLIC_` 변수에 저장하거나 Git에 커밋하지 않습니다.

데이터를 추가하거나 갱신하는 작업에는 공개용 Supabase 키가 아닌 서버용 관리자 키를 사용합니다. 공개용 키로 신규 매장을 검색하면 비공개 초안과의 중복을 놓칠 수 있으며, 확장 스크립트는 관리자 키가 없는 게시 작업을 차단합니다.

## 홍대 확장 및 재현 가능한 QA

```bash
npm run expand:region -- --region hongdae --restaurants 40 --cafes 0
npm run expand:region -- --region hongdae --restaurants 40 --cafes 0 --candidate-run .expansion-runs/<previous-run>
node scripts/verify-expansion-images.mjs .expansion-runs/<run-id> 3
```

검색, 후보 검증, 번역 및 사전 검사를 통과한 작업물은 무시된 `.expansion-runs/`에 저장됩니다. 게시하려면 이미 존재하는 장소 ID와 정규화된 이름/주소를 다시 확인한 뒤 관리자 키로 `--publish-run <run-id>`을 사용합니다. 이미지가 없으면 `not_available`로 표시하며 임의 이미지나 추측한 가격을 채우지 않습니다. 기존 작업 파일과 수집 증빙은 별도 보존합니다.
