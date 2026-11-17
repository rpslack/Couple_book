# 부부 가계부 개발 환경

Cloudflare Workers와 D1을 사용하는 개발 초기 버전입니다. 로그인, 달력, 거래 등록·조회·수정·삭제의 기초를 구현했습니다. 비밀번호 변경과 수동 백업을 추가했습니다. 빈 가계부로 JSON 복원을 지원하며 운영 보안 검증은 미완성입니다. 공개 배포하지 마세요.

## 로컬 실행

```sh
npm install
npm run db:migrate:local
node scripts/create-local-household.mjs
npm run dev
```

초기화 스크립트는 대화형 터미널에서 8자 이상의 로컬 비밀번호를 입력받고 기본 카테고리를 생성합니다. 이미 로컬 가계부가 있으면 비밀번호를 덮어쓰지 않습니다. 비밀번호를 명령줄 인자나 파일에 넣지 마세요. 로컬 D1은 `.wrangler/`에 저장됩니다.

## API

변경 요청은 같은 출처의 `Origin`과 `Content-Type: application/json`이 필요합니다. 모든 거래·카테고리 API는 세션이 필요합니다.

- `POST /api/session`: `{"password":"..."}`로 로그인. 7일 세션 쿠키 발급.
- `GET /api/session`, `DELETE /api/session`: 로그인 상태 조회 및 로그아웃. DELETE에도 JSON 콘텐츠 타입과 Origin 필요.
- `GET /api/categories`: 활성 카테고리 조회.
- `POST /api/transactions`: `type` (`income`/`expense`), 정수 `amount`, `category_id`, `transaction_date` (`YYYY-MM-DD`), 선택 사항 `memo`, `subject`, `payment_method`.
- `GET /api/transactions?date=YYYY-MM-DD`: 해당 날짜의 거래 조회.

비밀번호는 PBKDF2-SHA256으로 저장하고, 세션 토큰은 해시만 DB에 보관합니다. 로그인 제한은 가계부 전체에 분당 10회이며 정상 로그인도 포함합니다. 운영 환경의 접속 제한, 데이터 보존·정리, 보안 검토와 초기 비밀번호 설정 절차는 추가 작업이 필요합니다.

## Cloudflare

원격 D1은 이미 생성되었으나 이후 스키마와 인증은 로컬에만 적용했습니다. 원격 마이그레이션은 `npm run db:migrate:remote`, 배포는 `npm run deploy`입니다. 기존 CSV는 자동으로 가져오지 않습니다.

- `GET /api/calendar?month=YYYY-MM`: 월별 날짜·유형 집계.
- `PATCH /api/transactions/:id`: 전체 거래 필드와 현재 `version`을 전달하여 수정.
- `DELETE /api/transactions/:id`: JSON 본문에 현재 `version`을 전달하여 삭제. 버전 충돌은 409를 반환합니다.


- `GET /api/categories?all=1`: 비활성 카테고리 포함 조회. `POST /api/categories`: 유형과 이름으로 추가. `PATCH /api/categories/:id`: 이름, 순서, 활성 상태 변경.


## 백업과 복구

로그인 후 설정에서 카테고리와 거래를 JSON으로 다운로드할 수 있습니다. 비밀번호와 세션은 포함되지 않습니다. 파일은 금융 정보를 포함하므로 안전한 곳에 보관하세요. 설정 화면에서 백업을 복원할 수 있으며 다운로드는 자동 백업이 아닙니다.

원격 D1이 production 백엔드인지 `npx wrangler d1 info couple-account-book`으로 확인합니다. 지원되는 D1의 Time Travel은 자동으로 복구 지점을 보관합니다. 보관 기간은 무료 플랜 7일, 유료 플랜 30일입니다. `npx wrangler d1 time-travel info couple-account-book`으로 현재 북마크를 확인하고, 특정 시각은 `--timestamp="2026-11-17T12:00:00+09:00"` 형식으로 조회할 수 있습니다. 복구 명령은 `npx wrangler d1 time-travel restore couple-account-book --bookmark=북마크`입니다. 복구는 원격 DB 전체를 해당 시점으로 덮어쓰며 그 이후 변경을 잃을 수 있으므로, 실행 전 현재 북마크와 별도 백업을 확보하고 복구 대상을 확인해야 합니다. 인증 정보도 해당 시점으로 되돌아갈 수 있습니다. 이 프로젝트에서는 복구를 아직 시험하지 않았습니다.

공식 문서: https://developers.cloudflare.com/d1/reference/time-travel/


복원 전에 `node scripts/validate-backup.mjs 경로/백업.json`으로 파일 형식, 카테고리 연결, 중복 ID, 날짜, 금액과 수입·지출 합계를 검사할 수 있습니다. 검증은 읽기 전용이며 복원하지 않습니다. 검증 도구의 현재 파일 크기 제한은 20MB입니다.

### JSON 복원

백업 파일은 1,500,000바이트 이하이며 카테고리와 거래가 모두 없는 가계부에서만 복원됩니다. 로컬의 새 데이터베이스를 준비할 때 `node scripts/create-local-household.mjs --empty`로 기본 카테고리 없이 가계부를 생성한 뒤 로그인하여 설정에서 파일을 선택합니다. 이미 카테고리나 거래가 있으면 복원을 거부하므로 기존 데이터 삭제 용도로 사용하지 마세요. 거래와 카테고리 ID는 새로 부여되지만 관계와 내용은 보존됩니다. 비밀번호·세션은 복원하지 않습니다. 로컬에서 복원 성공, 손상된 파일 거부, 기존 데이터 보호 및 강제 실패 시 전체 롤백을 검증했습니다. 원격 복원은 검증하지 않았습니다.

## 기존 CSV 변환

`python scripts/convert-legacy-csv.py 가계부_통합.csv 새백업.json`으로 현재 형식의 CSV를 복원용 JSON으로 변환합니다. 기존 출력 파일은 덮어쓰지 않습니다. 변환 후 `node scripts/validate-backup.mjs 새백업.json`으로 검증하세요. 변환기는 원본 파일이나 DB를 수정하지 않습니다. 원본 CSV에는 생성·수정 시각이 없어 두 필드를 거래 날짜의 UTC 자정으로 임시 기입합니다. 입력자·주체·지불 방식·출처와 거래 내용은 보존합니다. 실제 DB로 복원하기 전 결과를 확인하세요.

백업 검증 자동 테스트는 `npm test`로 실행합니다. 원격 초기화는 아래 별도 도구를 사용합니다. 기존 로컬 초기화 스크립트는 원격 DB를 변경하지 않습니다.

JSON 복원은 D1의 단일 문자열 크기 제한을 고려해 1,500,000바이트까지만 지원합니다. 더 큰 백업의 복원 방법은 아직 구현하지 않았습니다. 실제 Workers 환경의 CPU 제한과 복원 처리량은 배포 전 시험이 필요합니다.

## 원격 초기화 준비

원격 스키마 마이그레이션 후 대화형 터미널에서 `node scripts/initialize-household.mjs --remote`를 실행하면 비밀번호를 두 번 입력받아 빈 가계부를 생성합니다. 이미 가계부가 하나라도 있으면 변경하지 않습니다. 생성 직후 카테고리는 없으므로 직접 추가하거나 기존 백업을 복원할 수 있습니다. 이 도구의 원격 실행은 아직 시험하지 않았으며 실제 Workers 환경에서 암호 검증, 보안, 데이터 복구 검증이 끝나기 전에는 공개 배포하지 마세요.

동일 도구의 격리 로컬 실행: `node scripts/initialize-household.mjs --local --persist-to 경로` (해당 로컬 DB에 마이그레이션을 먼저 적용). 비밀번호 원문은 콘솔에 출력하거나 파일에 저장하지 않지만, 해시는 Wrangler 명령 인자로 전달됩니다.

화면 응답에는 콘텐츠 보안 정책, 프레임 차단, MIME 스니핑 방지 및 캐시 금지 헤더가 적용됩니다. Cloudflare 무료 Workers에는 요청당 CPU 제한이 있으므로 PBKDF2 로그인과 복원은 실제 배포 환경에서 검증해야 합니다. 로컬 검증만으로 운영 적합성을 보장할 수 없습니다.
