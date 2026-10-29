# Marathon Tracking

여러 마라톤 참가자의 기록을 한 화면에서 조회하고, 배번별 이름을 수정해 관리하는 정적 웹 앱입니다.

## 주요 기능

- MyResult 대회 검색 및 배번별 기록 조회
- Supabase 배번·수정 이름 자동 저장 및 토큰 공유 링크
- `Full`/`10K` 코스 구분에 따른 로컬 GPX 표시 및 Wari-gari 폴백
- Full과 10K 배번이 섞인 경우 코스별 맵 분리 표시
- 여러 주자의 위치를 코스 맵 핀으로 표시
- 모바일 반응형 레이아웃

## 데이터 흐름

- 기록 검색: MyResult via Supabase Edge Function `myresult-search-v5`
- 코스 데이터: 로컬 `GPX/` 파일, 실패 시 Supabase Edge Function `wari-jtbc-route` 폴백
- 지도/고도 렌더링: `gpx-viewer.html`
- 지도 렌더링에는 MapLibre GL JS와 OpenFreeMap을 사용합니다. 현재 테스트 스타일은 Bright이며, 지도별 전체화면과 코스 자동 맞춤을 지원합니다.
- 배번과 수정 이름은 Supabase에 저장되고, 공유 링크에는 조회 토큰만 포함됩니다. 브라우저에는 초안과 작성자의 편집 토큰을 보관합니다.
- 공유 링크는 30일간 유효하며, 공유받은 사람이 수정하면 별도 목록으로 저장합니다.
- 서버 스키마·접근 정책: [docs/share-schema-policy.md](docs/share-schema-policy.md)

## 로컬 실행

정적 파일 서버로 프로젝트 디렉터리를 제공하면 됩니다. `file://`로 직접 열어도 기본 화면은 확인할 수 있지만, iframe과 외부 요청 확인에는 HTTP 서버를 권장합니다.

## 배포

- GitHub: https://github.com/sudo-engr/MarathonTracking
- Production: https://marathontracking.sudoengr.workers.dev/
- Short URL: https://tinyurl.com/maratracking

## 코스의 GPX 데이터

- https://github.com/zohoda-ui/gpx-road
- https://wari-gari.com/
