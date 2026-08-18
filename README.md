# 오롯길 (Orotgil)

> 걷기와 문화유산을 잇는 코스 탐색 앱 — 목적지까지 걸어가는 길에 어떤 문화스팟이 있는지 함께 보여줍니다.

한국의 문화유산·축제 데이터를 걷기 코스와 결합한 모바일 앱입니다. 웹으로 만든 화면을 Capacitor로 감싸 iOS·Android 앱으로 배포합니다.

**배포**: https://runloop-jet.vercel.app
**개발 기간**: 2026년 5월 ~ 7월 (커밋 183개)

---

## 무엇을 하는 앱인가

출발지와 목적지를 정하면 보행자 도로 기준으로 길을 잡아주고, 그 주변의 문화유산·축제·체육 일정을 함께 보여줍니다. 사진을 찍어 문화재 이름을 찾는 기능도 있습니다.

| 탭 | 하는 일 |
|---|---|
| 홈 | 현재 위치 날씨·미세먼지, AI가 고른 주변 문화스팟, 가까운 축제·체육 일정 |
| 관심 | 저장한 문화스팟·일정, 방문 기록 |
| 지도 | 지도에서 지점을 찍어 코스 구성, 보행자 경로로 자동 보정, 거리·예상 시간 계산 |
| MY | 레벨·경험치, 목표 달성률, 월간 활동 기록 |

이 밖에 홈에서 들어가는 **사진으로 문화재 찾기**, **전국 날씨**, **전체 일정** 화면이 있습니다.

---

## 기술 구성

### 프론트엔드
- **단일 HTML 파일** (약 11,700줄) — 빌드 도구 없이 순수 JavaScript로 구현
- **카카오맵 JS SDK** — 지도, 마커, 경로 오버레이
- **한국어 / 영어** 이중 언어 지원
- **PWA** — 서비스 워커로 오프라인 캐싱, 홈 화면 설치 지원

### 백엔드 (Vercel Serverless Functions)
API 키를 앱 번들에 넣지 않기 위해 외부 API 호출을 모두 서버 함수로 감쌌습니다.

| 엔드포인트 | 역할 |
|---|---|
| `api/tour-spots.js` | 한국관광공사(KTO) + 국가유산청(CHA) 문화유산 검색 |
| `api/tour-events.js` | 축제·행사 일정 |
| `api/tour-weather.js` | 기상청 날씨·미세먼지 |
| `api/tmap-pedestrian.js` | TMAP 보행자 경로 탐색 |
| `api/heritage-identify.js` | 사진 → Gemini 비전 분석 → 문화재 후보 매칭 |
| `api/generate-course.js` | AI 코스 추천 |

### 모바일
- **Capacitor 8** — iOS / Android 네이티브 래핑
- **HealthKit 플러그인 직접 구현** — Swift로 Capacitor 네이티브 플러그인을 만들어(`ios/App/App/HealthActivityPlugin.swift`) 애플 건강 앱의 걸음 수·걷기 거리를 앱 기록으로 가져옵니다
- Geolocation, SplashScreen, StatusBar 플러그인

---

## 직접 해결한 문제들

### 1. iOS WebView에서 카카오맵이 안 뜨는 문제
Capacitor는 `capacitor://localhost` 스킴으로 앱을 띄우는데, 카카오맵 JS SDK는 등록된 도메인이 아니면 로딩을 거부합니다. 원격 URL을 iOS 빌드에 주입하는 스크립트(`scripts/use-ios-remote-url.mjs`)를 만들어 해결했습니다.

### 2. API 키 노출
초기에는 TMAP·KTO 키가 클라이언트 코드에 있었습니다. 모든 외부 호출을 Vercel 서버 함수 뒤로 옮기고, 앱에는 키를 남기지 않도록 정리했습니다.

### 3. AI 호출 비용 제어
AI 기능에 분당 3회 / 하루 20~30회 제한(rate limit)을 직접 구현하고, 허용 출처(CORS allowlist)를 지정해 외부에서 함부로 호출하지 못하도록 막았습니다.

### 4. 문화재 사진 인식 정확도
처음엔 OpenAI 비전 모델로 사진을 설명 텍스트로 바꾼 뒤 그 텍스트로 문화재 DB를 검색했는데, 두 단계를 거치며 정확도가 떨어졌습니다. 한국 문화 지식이 더 나은 **Google Gemini Flash**로 교체했습니다.

### 5. 실내 GPS 오차
실내에서 GPS가 튀어 거리가 잘못 쌓이는 문제가 있었습니다. 정확도가 낮은 좌표는 이동 거리에 반영하지 않도록 처리했습니다.

### 6. 대규모 코드 정리
기능 방향이 바뀌면서 안 쓰는 코드가 쌓였습니다. GPS 러닝 화면, 소셜 기능, Leaflet 대체 지도 어댑터 등 **약 1,500줄**을 제거했습니다. 단순 삭제로 끝나지 않고, 지워진 함수를 아직 참조하던 곳들(예: 사진 압축 함수가 문화재 찾기에서도 쓰이고 있던 부분)을 추적해 함께 고쳤습니다.

---

## 프로젝트 히스토리

원래 **Runloop**이라는 러닝 기록 앱으로 시작했습니다. 개발 도중 "코스를 따라 걸으며 문화유산을 만나는" 방향이 더 낫다고 판단해 **오롯길**로 방향을 바꿨고, 러닝 트래커와 소셜 기능을 걷어내고 문화 데이터 중심으로 재구성했습니다.

공모전 제출을 위해 AI 기능 2가지(사진 문화재 찾기, AI 문화스팟 추천)를 추가했습니다.

---

## 로컬 실행

```bash
npm install

# 웹: index.html을 로컬 서버로 열기 (예: VS Code Live Server, 포트 5500)

# iOS
npm run cap:sync:ios
npm run cap:open:ios

# Android
npm run cap:sync:android
npm run cap:open:android
```

### 필요한 환경변수 (Vercel)

```
KTO_SERVICE_KEY               한국관광공사 API
CHA_HERITAGE_SERVICE_KEY      국가유산청 API
KMA_TOUR_WEATHER_SERVICE_KEY  기상청 API
SPORTS_SERVICE_KEY            체육 일정 API
TMAP_APP_KEY                  TMAP 보행자 경로
GEMINI_API_KEY                Google Gemini (사진 문화재 인식)
OPENAI_API_KEY                AI 코스 추천
```

---

## 폴더 구조

```
├── index.html              # 앱 전체 (화면 + 로직)
├── sw.js                   # 서비스 워커 (캐싱)
├── manifest.json           # PWA 설정
├── api/                    # Vercel 서버리스 함수
├── scripts/                # Capacitor 빌드 보조 스크립트
├── ios/  android/          # Capacitor 네이티브 프로젝트
└── www/                    # 빌드 산출물
```
