# Runloop Project Notes

## Product Direction

- Runloop should stay primarily a personal running app: planning, running, saving, and reviewing my own runs are the core experience.
- Social features are secondary. Shared local routes, likes, reviews, and hidden neighborhood paths should support the personal running flow, not replace it.
- Future Apple Watch integration is a product goal. Plan data structures so records can later come from web, iPhone HealthKit, or Apple Watch workouts.

## Future Apple Watch / HealthKit Readiness

- Keep run records source-aware: `web`, `web_gps`, `healthkit`, `apple_watch`.
- Leave room for watch-derived fields: heart rate, cadence, elevation, active energy, GPS route, HealthKit workout id, and device source.
- Web/PWA can validate the core UX, but real Apple Watch integration will require native iOS and watchOS apps.

## Recent Field Test Feedback

- Drag-to-draw routes interferes with screen gestures. Prefer tap/point-based route creation.
- Running screen controls should take less vertical space so the map is easier to see while moving.
- Indoor GPS can be noisy. The app should expose GPS accuracy and avoid counting low-accuracy jumps as real distance.
- Saved run records need a detail view, not only a list item.
- Main navigation should use a bottom tab bar because Runloop is primarily a mobile/PWA experience.
