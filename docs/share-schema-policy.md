# Supabase 배번 저장 및 공유

배번과 사용자가 수정한 이름은 Supabase `private.tracking_lists`에 저장한다. MyResult 원본 기록은 저장하지 않고 기존 조회·캐시 흐름을 사용한다.

## 동작

- 배번 추가·삭제, 이름 수정 시 자동 저장한다. 브라우저 저장소는 네트워크 오류 시 초안과 작성자의 편집 토큰을 보관한다.
- 주소와 공유 링크는 `/?share=<256비트 임의 토큰>`이다. 대회 ID·배번·이름·편집 토큰은 URL에 넣지 않는다.
- 기존 `?event=...&bibs=...&names=...` 링크는 한 번 읽어 저장하고 새 주소로 교체한다. 이미 남은 과거 URL 기록까지 제거하지는 않는다.
- 작성자가 수정하면 같은 공유 링크의 목록이 갱신된다. 열려 있는 읽기 전용 공유 화면은 30초마다, 화면으로 돌아올 때, 기록 조회 시 최신 배번 목록을 다시 읽는다. 공유받은 사람은 읽을 수 있으며, 수정하면 별도 목록으로 저장한다.
- 링크는 생성 후 30일간 유효하다. 링크를 가진 사람은 만료 전에 목록을 조회할 수 있다.
- 작성자의 `전체 삭제`는 공유를 해제하고 DB의 배번·표시 이름을 비운다. 취소 시각과 토큰 해시는 남긴다. 공유받은 사람의 `전체 삭제`는 본인 브라우저의 목록만 비운다.
- 로그인과 계정 복구는 없다. 작성자 브라우저의 편집 토큰을 잃으면 기존 목록을 수정·해제할 수 없다. 공유 링크로 읽고 수정하면 별도 목록을 만들 수 있다.

## API와 접근 경계

브라우저 → Worker `/api/tracking-lists` → Supabase Edge Function `tracking-lists` → 서비스 역할 전용 RPC `public.tracking_list_access` → `private.tracking_lists`.

모든 요청은 POST JSON이며 응답은 `Cache-Control: no-store`다.

| action | 요청 | 응답 |
| --- | --- | --- |
| create | eventId, bibs, names | token, editToken, eventId, bibs, names, expiresAt |
| read | token | eventId, bibs, names, expiresAt |
| update | editToken, eventId, bibs, names | eventId, bibs, names, expiresAt |
| revoke | editToken | ok |

읽기·편집 토큰은 독립적인 32바이트 난수이며 DB에는 SHA-256 해시만 저장한다. Edge Function은 16KiB 요청 제한, 대회 ID, 최대 50개 배번, 배번별 60자 이름을 검증한다. RLS를 활성화하고 anon/authenticated의 테이블·RPC 접근을 차단한다. 서비스 역할 키는 Edge Function 환경변수에서만 읽으며 브라우저·Worker 소스에 포함하지 않는다. RPC는 `SECURITY INVOKER`다.

## 소스 및 검증

- `supabase/functions/tracking-lists/schema.sql`: 적용한 스키마와 RPC의 최종 정의. Supabase 마이그레이션 `tracking_lists_persistence`, `tracking_lists_revoke_clear_data`로 적용했다.
- `supabase/functions/tracking-lists/index.ts`: 외부 패키지 없는 Edge Function.
- `tests/share-backend.cjs`: 입력 제한, 토큰 해시, 읽기·수정·취소 계약 검증.
- `tests/share-frontend.cjs`: 연속 저장, 공유 링크, 작성자 복원, 읽기 방문자 복사·분기, 실패·재시도, 이전 링크 전환 검증.
- `.assetsignore`: DB·서버·테스트·문서를 정적 공개 파일에서 제외한다.

만료된 행의 자동 물리 삭제 작업, 계정 동기화, 로그인은 추가하지 않았다. 신규 생성 API에는 별도 사용자별 할당량이 없으며 공개 생성 요청이 많아지면 서버 측 제한이 필요하다.
