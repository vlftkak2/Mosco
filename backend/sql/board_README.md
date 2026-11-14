# 상담게시판 설치

운영 DB 변경은 자동 수행하지 않습니다. PostgreSQL에 `board_create.sql`을 먼저 실행한 뒤 백엔드를 재시작하고 프론트를 배포합니다. 신규 테이블은 **board01t 한 개**이며, 게시글과 최신 관리자 답변을 함께 저장합니다. 첨부파일과 답변 이력은 이번 범위에 포함하지 않습니다.

## 권한

| 탭 | 001 운영사 | 다른 회사 |
| --- | --- | --- |
| 공지사항 | 조회·등록·수정·삭제·상단 고정 (답글 없음) | 탭 안 보임 |
| AI ERP문의 | 조회·답글 (홈페이지 문의가 들어올 탭, 지금은 시험 등록 가능) | 탭 안 보임 |
| 재고문의 / 시스템문의 | 전체 조회·답글, 시험 등록 가능 | 자사 글 조회·등록·수정·삭제·답글 |

활성 로그인 계정 모두 상담 메뉴에 접근합니다. 문의는 작성 개인이 아닌 작성 회사 단위로 관리하며, 회사코드·회사명·작성자는 인증 계정에서 결정합니다. 다른 회사가 운영사 전용 글 번호로 직접 열어도 404(없음)입니다.

## 테이블

- `id`: 자동 생성 PK
- `category`: notice / stock / ai / system / etc
- `companyid`, `companyname`, `author_name`: 작성 회사 및 작성자 스냅샷
- `title`, `content`, `phone`: 제목(200자), 내용(20,000자), 선택 연락처(50자)
- `reply`, `replied_by`, `replied_at`: 최신 답변 및 처리자·처리시각
- `created_by`, `updated_by`, `created_at`, `updated_at`: 생성·수정 감사 정보
- `author_name`, `updated_name`: 등록자·최종 수정자 이름. 인증 계정에서 자동 저장하며 목록·상세에 표시합니다. 등록 시 수정자도 등록자로 초기화하고, 게시글 수정 또는 관리자 답변 저장 시 최종 수정자를 갱신합니다. 상세에서는 계정 이메일도 함께 표시합니다.
- 이미 테이블을 생성한 환경은 `board_audit_migration.sql`을 추가 적용합니다. 신규 환경은 갱신된 `board_create.sql`만 실행합니다. 과거 수정자 이름이 없으면 계정 이메일을 표시합니다.
- 답변이 비어 있으면 답변대기, 있으면 답변완료. 안내 탭은 안내로 표시합니다.
- 날짜는 timestamptz로 저장하고 화면에서는 한국 시간으로 표시합니다.
- 분류/최근순 및 회사/분류/최근순 인덱스를 제공합니다.

## 설치 순서

1. `board_create.sql` (신규 환경) — 기존 설치는 `board_audit_migration.sql`
2. `board_replies_migration.sql` — 답글 테이블 `boardreply01t` (예전 단일 답변을 답글로 옮김)
3. `board_saas_migration.sql` — 공지 상단 고정(`pinned`), 답글 수정 기록(`updated_at`, `updated_by`)
4. `board_access_migration.sql` — 탭 권한 변경(공지 · AI ERP문의 운영사 전용, 운영사 재고 · 시스템문의 시험 등록, 기타문의 삭제)
5. 백엔드 재시작

## 처리상태 (문의 탭)

| 상태 | 조건 |
| --- | --- |
| 답변대기 | 답글 없음 |
| 답변완료 | 마지막 답글이 운영사(001) |
| 추가문의 | 마지막 답글이 문의한 회사 |

공지사항은 '안내'로 표시합니다(답글 없음). AI ERP문의는 문의 탭과 같은 처리상태를 씁니다. 탭의 빨간 숫자는 답변대기 + 추가문의 건수입니다.

## 답글 권한

- 등록: 운영사 전체, 문의한 회사(자기 문의). 공지사항에는 운영사도 답글을 달 수 없습니다.
- 수정: 본인이 쓴 답글만 (수정 시각을 남김)
- 삭제: 본인 답글, 운영사는 모든 답글

## 연결

- 화면: `/CustomerSupport` (기존 주소 유지), `/Board` — 왼쪽 목록 · 오른쪽 상세 + 대화형 답글
- API
  - `GET /api/board` (category · status · keyword · page · page_size), `GET /api/board/summary` (탭별 건수)
  - `POST /api/board`, `GET/PUT/DELETE /api/board/{id}`, `PUT /api/board/{id}/pin` (운영사 공지 고정)
  - `POST /api/board/{id}/replies`, `PUT/DELETE /api/board/{id}/replies/{reply_id}`
- `menu_catalog_seed.sql`의 CUSTOMER_SUPPORT는 COMPANY / assignable FALSE로 정의합니다. 상담은 별도 메뉴 권한 부여 없이 인증 계정에게 제공하는 공통 메뉴입니다.

## 검증

테스트 의존성 설치: `venv/Scripts/python.exe -m pip install -r requirements-test.txt`

실행: backend 폴더에서 `venv/Scripts/python.exe -m unittest discover -s tests -p test_board.py`

권한 및 API 입력 테스트는 DB 연결을 대체하여 운영 데이터에 영향을 주지 않습니다.
