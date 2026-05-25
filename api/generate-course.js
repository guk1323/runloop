const DEFAULT_MODEL = 'gpt-5-mini';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 3;
const RATE_LIMIT_DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_DAY = 30;
const ALLOWED_ORIGINS = new Set([
  'https://runloop-jet.vercel.app',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'capacitor://localhost',
  'ionic://localhost'
]);
const rateBuckets = globalThis.__runloopAiRateBuckets || (globalThis.__runloopAiRateBuckets = new Map());
const TAG_CLASS = {
  safe: 'tg',
  flat: 'tb',
  park: 'tg',
  river: 'tb',
  night: 'tg',
  quiet: 'tg',
  slope: 'ta',
  busy: 'ta',
  view: 'tb'
};

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  const rateLimit = checkRateLimit(req);
  if (!rateLimit.ok) {
    res.setHeader('Retry-After', String(rateLimit.retryAfterSec));
    setRateLimitHeaders(res, rateLimit);
    return res.status(429).json({
      error: 'AI rate limit exceeded',
      retryAfterSec: rateLimit.retryAfterSec
    });
  }
  setRateLimitHeaders(res, rateLimit);

  try {
    const body = parseRequestBody(req.body);
    const km = clampNumber(body.km, 1, 20, 5);
    const lat = clampNumber(body.lat, -90, 90, 37.5503);
    const lng = clampNumber(body.lng, -180, 180, 126.92);
    const weather = cleanText(body.weather, 120) || '날씨 정보 없음';
    const preference = cleanText(body.preference, 80) || '조용하고 안전한 길';
    const place = cleanText(body.place, 80) || '현재 위치 주변';
    const savedCourseNames = Array.isArray(body.savedCourseNames)
      ? body.savedCourseNames.map(name => cleanText(name, 30)).filter(Boolean).slice(0, 6)
      : [];

    const result = await createOpenAiResponse(apiKey, {
      km,
      lat,
      lng,
      weather,
      preference,
      place,
      savedCourseNames
    });

    if (!result.ok) {
      console.error('OpenAI course generation failed', result.status, result.error);
      return res.status(502).json({
        error: 'AI course generation failed',
        detail: sanitizeOpenAiError(result.error)
      });
    }

    const text = extractOpenAiText(result.data);
    const parsed = parseJsonText(text);
    const rawCourses = Array.isArray(parsed.courses) ? parsed.courses : [];
    const courses = rawCourses.slice(0, 2).map((course, index) => normalizeCourse(course, index, km));

    if (courses.length === 0) {
      return res.status(502).json({ error: 'AI returned no usable courses' });
    }

    return res.status(200).json({ courses });
  } catch (error) {
    console.error('Runloop AI route error', error);
    return res.status(500).json({ error: 'Failed to generate courses' });
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function isAllowedCorsOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch (_) {
    return false;
  }
}

async function createOpenAiResponse(apiKey, context) {
  const models = getModelCandidates();
  let lastError = null;

  for (const model of models) {
    const aiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        instructions: [
          'You create concise Korean running course recommendation cards for Runloop.',
          'Do not invent exact coordinates, turn-by-turn routes, businesses, safety guarantees, or live map data.',
          'Return valid JSON only. Keep names short, cute, and minimal. Include a local area hint when possible.'
        ].join(' '),
        input: [
          `위치: ${context.place} (${context.lat.toFixed(5)}, ${context.lng.toFixed(5)})`,
          `목표 거리: ${context.km.toFixed(1)}km`,
          `날씨/상황: ${context.weather}`,
          `사용자 선호: ${context.preference}`,
          `이미 저장한 코스 이름: ${context.savedCourseNames.length ? context.savedCourseNames.join(', ') : '없음'}`,
          'JSON 형식: {"courses":[{"name":"이름","concept":"한 문장 컨셉","distanceKm":5.0,"paceMinPerKm":6.5,"tags":["안전","평지"],"safetyNote":"짧은 참고","routeLabel":"경로 힌트","mapStyle":"river|urban|park","waypoints":[{"lat":37.123,"lng":127.456}]}]}',
          'courses는 정확히 2개. 두 코스는 서로 다른 방향의 왕복 코스여야 함.',
          'distanceKm는 목표 거리에서 ±0.5km 이내.',
          '핵심 원칙: 모든 코스는 왕복형(out-and-back)으로만 추천한다. 루프형(블록 돌기) 절대 금지.',
          'waypoints는 정확히 1개. 출발지에서 distanceKm/2 거리에 있는 환점 GPS 좌표. 한강변·하천 산책로·공원 같이 횡단보도 없이 뛸 수 있는 지점을 우선. 교차로나 도로변은 피할 것.',
          '길 우선순위: ① 한강 또는 하천 산책로 ② 공원 내 경로 ③ 차도 없는 직선 보행로. 횡단보도가 많은 블록 길은 절대 금지.',
          'routeLabel은 "○○ 방향 왕복" 형태. 역 출구·교차로 이름 언급 금지.',
          'tags는 2~3개. 왕복 코스면 "왕복" 태그 포함.'
        ].join('\n')
      })
    });

    const data = await aiRes.json().catch(() => ({}));
    if (aiRes.ok) return { ok: true, data, model };

    lastError = { model, status: aiRes.status, error: data && data.error };
    console.error('OpenAI model attempt failed', lastError);
    if (!shouldTryNextModel(aiRes.status, data && data.error)) break;
  }

  return { ok: false, status: lastError && lastError.status, error: lastError };
}

function sanitizeOpenAiError(error) {
  if (!error) return null;
  const source = error.error || error;
  return {
    model: error.model || null,
    status: error.status || null,
    code: source.code || null,
    type: source.type || null,
    message: String(source.message || '').slice(0, 180)
  };
}

function getModelCandidates() {
  return [process.env.OPENAI_MODEL, DEFAULT_MODEL, 'gpt-4.1-mini']
    .map(model => String(model || '').trim())
    .filter(Boolean)
    .filter((model, index, arr) => arr.indexOf(model) === index);
}

function shouldTryNextModel(status, error) {
  const message = String((error && (error.message || error.code || error.type)) || '');
  return status === 400 || status === 404 || /model|not found|does not exist|access/i.test(message);
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = getClientKey(req);
  const bucket = rateBuckets.get(key) || {
    minuteStart: now,
    minuteCount: 0,
    dayStart: now,
    dayCount: 0,
    lastSeen: now
  };

  if (now - bucket.minuteStart >= RATE_LIMIT_WINDOW_MS) {
    bucket.minuteStart = now;
    bucket.minuteCount = 0;
  }

  if (now - bucket.dayStart >= RATE_LIMIT_DAY_MS) {
    bucket.dayStart = now;
    bucket.dayCount = 0;
  }

  bucket.lastSeen = now;

  if (bucket.minuteCount >= RATE_LIMIT_MAX_PER_WINDOW) {
    rateBuckets.set(key, bucket);
    return buildRateLimitResult(false, bucket, bucket.minuteStart + RATE_LIMIT_WINDOW_MS - now);
  }

  if (bucket.dayCount >= RATE_LIMIT_MAX_PER_DAY) {
    rateBuckets.set(key, bucket);
    return buildRateLimitResult(false, bucket, bucket.dayStart + RATE_LIMIT_DAY_MS - now);
  }

  bucket.minuteCount += 1;
  bucket.dayCount += 1;
  rateBuckets.set(key, bucket);
  pruneRateBuckets(now);
  return buildRateLimitResult(true, bucket, 0);
}

function buildRateLimitResult(ok, bucket, retryAfterMs) {
  return {
    ok,
    retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    remainingMinute: Math.max(0, RATE_LIMIT_MAX_PER_WINDOW - bucket.minuteCount),
    remainingDay: Math.max(0, RATE_LIMIT_MAX_PER_DAY - bucket.dayCount)
  };
}

function setRateLimitHeaders(res, rateLimit) {
  res.setHeader('X-RateLimit-Limit-Minute', String(RATE_LIMIT_MAX_PER_WINDOW));
  res.setHeader('X-RateLimit-Remaining-Minute', String(rateLimit.remainingMinute));
  res.setHeader('X-RateLimit-Limit-Day', String(RATE_LIMIT_MAX_PER_DAY));
  res.setHeader('X-RateLimit-Remaining-Day', String(rateLimit.remainingDay));
}

function getClientKey(req) {
  const forwarded = getHeader(req, 'x-forwarded-for');
  const rawIp = forwarded || getHeader(req, 'x-real-ip') || (req.socket && req.socket.remoteAddress) || 'unknown';
  const ip = String(rawIp).split(',')[0].trim();
  return ip.replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, 80) || 'unknown';
}

function getHeader(req, name) {
  const value = req.headers && req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function pruneRateBuckets(now) {
  if (rateBuckets.size <= 500) return;
  for (const [key, bucket] of rateBuckets.entries()) {
    if (!bucket || now - bucket.lastSeen > RATE_LIMIT_DAY_MS) {
      rateBuckets.delete(key);
    }
  }
}

function parseRequestBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (_) { return {}; }
  }
  return body;
}

function extractOpenAiText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  if (!Array.isArray(data.output)) return '';
  return data.output
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .map(part => part && (part.text || part.output_text || ''))
    .filter(Boolean)
    .join('\n');
}

function parseJsonText(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!cleaned) return {};
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try { return JSON.parse(match[0]); } catch (error) { return {}; }
  }
}

function normalizeCourse(course, index, targetKm) {
  if (!course || typeof course !== 'object') course = {};
  const styles = ['river', 'urban', 'park'];
  const colors = ['#F27A5E', '#D9654D', '#639922'];
  const distance = clampNumber(course.distanceKm, getMinRecommendedKm(targetKm), getMaxRecommendedKm(targetKm), targetKm);
  const pace = clampNumber(course.paceMinPerKm, 5.5, 8.5, 6.5 + index * 0.2);
  const rawTags = Array.isArray(course.tags) ? course.tags : [];
  const tags = rawTags
    .map(normalizeTagLabel)
    .filter(Boolean)
    .slice(0, 3)
    .map(label => ({ l: label, c: getTagClass(label) }));
  while (tags.length < 2) {
    tags.push(index === 2 ? { l: '공원', c: 'tg' } : { l: '안전', c: 'tg' });
  }

  const mapStyle = styles.includes(course.mapStyle) ? course.mapStyle : inferMapStyle(tags, index);
  const concept = cleanText(course.concept, 45);
  const safetyNote = cleanText(course.safetyNote, 45);
  const routeLabel = cleanText(course.routeLabel, 34);

  const rawWaypoints = Array.isArray(course.waypoints) ? course.waypoints : [];
  const waypoints = rawWaypoints
    .filter(wp => wp && Number.isFinite(Number(wp.lat)) && Number.isFinite(Number(wp.lng)))
    .filter(wp => Math.abs(Number(wp.lat)) <= 90 && Math.abs(Number(wp.lng)) <= 180)
    .map(wp => ({ lat: Number(wp.lat), lng: Number(wp.lng) }))
    .slice(0, 2);

  return {
    name: cleanText(course.name, 18) || `추천 코스 ${index + 1}`,
    km: distance.toFixed(1),
    pace,
    tags,
    meta: [concept, safetyNote].filter(Boolean).join(' · ') || '현재 조건에 맞춘 추천 코스',
    routeLabel,
    pt: mapStyle,
    color: colors[index] || colors[0],
    fromAi: true,
    waypoints
  };
}

function getMinRecommendedKm(targetKm) {
  return Math.max(0.8, targetKm - 0.5);
}

function getMaxRecommendedKm(targetKm) {
  return Math.min(22, targetKm + 0.5);
}

function normalizeTagLabel(tag) {
  if (typeof tag === 'string') return cleanText(tag, 8);
  if (tag && typeof tag === 'object') return cleanText(tag.l || tag.label || tag.name, 8);
  return '';
}

function getTagClass(label) {
  const value = String(label || '');
  if (/경사|언덕|혼잡|주의|차도/.test(value)) return TAG_CLASS.slope;
  if (/평지|강변|뷰|한강/.test(value)) return TAG_CLASS.flat;
  if (/공원|안전|야간|조용|산책/.test(value)) return TAG_CLASS.safe;
  return TAG_CLASS.safe;
}

function inferMapStyle(tags, index) {
  const text = tags.map(tag => tag.l).join(' ');
  if (/강변|한강|물/.test(text)) return 'river';
  if (/공원|산책/.test(text)) return 'park';
  return ['river', 'urban', 'park'][index] || 'urban';
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
