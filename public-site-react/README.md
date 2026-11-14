# 스틸119 홈페이지 (React)

`public-site/`(정적 HTML 시안)를 React + Vite로 옮긴 버전입니다. 화면과 동작은 같습니다. ERP(`frontend/`)와는 별개의 앱입니다.

## 실행 (개발)

```cmd
cd /d C:\Mosco\public-site-react
npm install        (처음 한 번)
npm run dev
```

http://localhost:5174 에서 볼 수 있습니다. ERP 개발 서버(`frontend`, 5173)와 포트가 달라 둘을 동시에 띄워도 됩니다.

## 빌드 · 배포

```cmd
npm run build      → dist/ 에 정적 파일 생성
npm run preview    → 빌드 결과 확인 (http://localhost:4174)
```

서버에는 `Dockerfile`(빌드 후 nginx로 서빙)을 씁니다. `default.conf`는 `/company`, `/erp`처럼 주소로 바로 들어오거나 새로고침해도 페이지가 열리도록 설정되어 있습니다.

## 페이지 (주소)

| 주소 | 파일 | 내용 |
|---|---|---|
| `/` | `src/pages/Home.jsx` | 메인 |
| `/company` | `src/pages/Company.jsx` | 회사소개 |
| `/erp` | `src/pages/Erp.jsx` | AI ERP · 요금 |
| `/inquiry` | `src/pages/Inquiry.jsx` | 발주 문의 (`#erp`, `#ad`로 들어오면 해당 유형 선택) |

예전 주소(`company.html` 등)로 들어와도 같은 페이지로 이동합니다.

## 구성

- `src/components/Layout.jsx`: 상단 띠, 머리말 메뉴(모바일 메뉴 포함), 꼬리말, 상담/TOP 버튼
- `src/components/Toast.jsx`: 안내 메시지, 연결 전 링크(`PendingLink`), 접수 폼(`DemoForm`)
- `src/components/Panels.jsx`: ERP 화면 예시 패널(대시보드, AI 주문서, 가공최적화, 매출이익, 잔액, 현재고)
- `src/components/Showcase.jsx`: ERP 기능 5초 자동 전환 (홈, AI ERP 페이지 공용)
- `src/components/KoreaMap.jsx`: 메인 한반도 도트맵
- `src/styles/site.css`, `site2.css`: 기존 CSS를 그대로 사용 (이미지 경로만 `/assets/`로 변경)
- `public/assets/`: 이미지 (페이지에서 쓰는 4개만)

## 연결 전 상태 (자리 표시)

`public-site/README.md`와 같습니다. 폼은 서버로 전송하지 않고, 환율·뉴스·피드·재고 카드는 예시입니다.
