# Runloop Project Notes

## Product Direction

- Runloop should stay primarily a personal running app: planning, running, saving, and reviewing my own runs are the core experience.
- Social features are secondary. Shared local routes, likes, reviews, and hidden neighborhood paths should support the personal running flow, not replace it.
- Future Apple Watch integration is a product goal. Plan data structures so records can later come from web, iPhone HealthKit, or Apple Watch workouts.

## Future Apple Watch / HealthKit Readiness

- Keep run records source-aware: `web`, `web_gps`, `healthkit`, `apple_watch`.
- Leave room for watch-derived fields: heart rate, cadence, elevation, active energy, GPS route, HealthKit workout id, and device source.
- Web/PWA can validate the core UX, but real Apple Watch integration will require native iOS and watchOS apps.

## iOS Release Path

- Use Capacitor for the first App Store version and defer Apple Watch/native rewrite.
- Release market is Korea-first. Do not trade away Korean map legibility for global map coverage in v1.
- Web/PWA map quality target is Kakao Maps JS.
- Kakao Maps JS inside iOS WebView on `capacitor://localhost` is blocked by domain mismatch, so the App Store build needs a native Korean map bridge.
- First native map candidate: KakaoMapsSDK v2 for iOS to match the web map provider. Backup candidate: Naver Maps SDK for iOS if Kakao native integration is slower or route overlay controls are weaker.
- Leaflet/Mapbox are temporary fallback/spike options only, not the intended release map for Korea.
- Keep TMAP as the pedestrian route correction engine; the Korean map SDK should primarily render the base map, markers, and route overlays.
- TMAP route/POI calls should move behind Vercel API routes before submission so the TMAP key is not shipped in the app bundle.
- Current local setup has Node, npm, Xcode, iOS Simulator, and Capacitor iOS running. Next blocker is a native Korean map SDK key/setup for the iOS bridge.

## Recent Field Test Feedback

- Drag-to-draw routes interferes with screen gestures. Prefer tap/point-based route creation.
- Running screen controls should take less vertical space so the map is easier to see while moving.
- Indoor GPS can be noisy. The app should expose GPS accuracy and avoid counting low-accuracy jumps as real distance.
- Saved run records need a detail view, not only a list item.
- Main navigation should use a bottom tab bar because Runloop is primarily a mobile/PWA experience.
