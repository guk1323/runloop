const KMA_APIHUB_BASE_URL = 'https://apihub.kma.go.kr/api/typ02/openApi/TourStnInfoService/getTourStnVilageFcst';
const KMA_DATA_GO_BASE_URL = 'https://apis.data.go.kr/1360000/TourStnInfoService/getTourStnVilageFcst';
const KMA_TOUR_COURSES = [
  { name: '서울시립미술관', en: 'Seoul Museum of Art', courseId: '61', spotName: '서울시립미술관', lat: 37.564262, lng: 126.974677 },
  { name: '덕수궁미술관', en: 'Deoksugung Palace Museum', courseId: '61', spotName: '덕수궁미술관', lat: 37.565885, lng: 126.973743 },
  { name: '국립현대미술관', en: 'National Museum of Modern and Contemporary Art', courseId: '63', spotName: '국립현대미술관 서울관', lat: 37.578967, lng: 126.980691 },
  { name: '국립중앙박물관', en: 'National Museum of Korea', courseId: '64', spotName: '국립중앙박물관', lat: 37.523828, lng: 126.981058 },
  { name: '동대문디자인플라자', en: 'Dongdaemun Design Plaza', courseId: '76', spotName: '동대문디자인플라자', lat: 37.566917, lng: 127.009456 },
  { name: '창덕궁', en: 'Changdeokgung Palace', courseId: '295', spotName: '창덕궁', lat: 37.582552, lng: 126.993203 },
  { name: '부소산성', en: 'Busosanseong Fortress', courseId: '15', spotName: '부소산성', lat: 36.284745, lng: 126.914872 },
  { name: '공산성', en: 'Gongsanseong Fortress', courseId: '84', spotName: '공산성', lat: 36.464977, lng: 127.123708 },
  { name: '불국사', en: 'Bulguksa Temple', courseId: '113', spotName: '불국사', lat: 35.790097, lng: 129.332092 },
  { name: '석굴암', en: 'Seokguram Grotto', courseId: '113', spotName: '석굴암', lat: 35.794795, lng: 129.349170 },
  { name: '해인사', en: 'Haeinsa Temple', courseId: '179', spotName: '해인사', lat: 35.801178, lng: 128.098098 },
  { name: '하회마을', en: 'Hahoe Folk Village', courseId: '162', spotName: '하회마을', lat: 36.538897, lng: 128.517965 },
  { name: '양동마을', en: 'Yangdong Folk Village', courseId: '259', spotName: '경주 양동마을', lat: 35.999759, lng: 129.254733 }
];
const ALLOWED_ORIGINS = new Set([
  'https://runloop-jet.vercel.app',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'capacitor://localhost',
  'ionic://localhost'
]);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serviceKey = getKmaServiceKey();
  if (!serviceKey) return res.status(500).json({ error: 'KMA_TOUR_WEATHER_SERVICE_KEY is not configured' });

  try {
    const query = req.query || {};
    const name = cleanText(getQueryValue(query.name), 100);
    const lat = clampNumber(getQueryValue(query.lat), -90, 90);
    const lng = clampNumber(getQueryValue(query.lng), -180, 180);
    const match = findKmaCourse(name, lat, lng);
    if (!match) return res.status(404).json({ error: 'No mapped KMA tour weather course' });

    const items = await fetchKmaWeatherItems(match.courseId, serviceKey);
    const item = pickWeatherItem(items, match);
    const weather = normalizeWeatherItem(item, match);
    if (!weather) return res.status(404).json({ error: 'No KMA tour weather item' });
    return res.status(200).json({ match, weather });
  } catch (error) {
    console.error('KMA tour weather proxy failed', error);
    return res.status(400).json({ error: 'Invalid KMA tour weather request' });
  }
}

async function fetchKmaWeatherItems(courseId, serviceKey) {
  const params = {
    pageNo: '1',
    numOfRows: '100',
    dataType: 'JSON',
    CURRENT_DATE: getSeoulCurrentDateHour(),
    HOUR: '24',
    COURSE_ID: String(courseId)
  };
  const apiHubResult = await fetchKmaJson(KMA_APIHUB_BASE_URL, { ...params, authKey: serviceKey }).catch(() => null);
  if (apiHubResult) return apiHubResult;
  const dataGoResult = await fetchKmaJson(KMA_DATA_GO_BASE_URL, { ...params, serviceKey }).catch(() => null);
  if (dataGoResult) return dataGoResult;
  return [];
}

async function fetchKmaJson(baseUrl, params) {
  const url = new URL(baseUrl);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`KMA weather failed ${response.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  const header = parsed && parsed.response && parsed.response.header;
  if (header && header.resultCode && !['00', '0000'].includes(String(header.resultCode))) {
    throw new Error(`KMA weather returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  return toArray(parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item);
}

function findKmaCourse(name, lat, lng) {
  const normalizedName = normalizeName(name);
  const byName = KMA_TOUR_COURSES.find(course => {
    const ko = normalizeName(course.name);
    const spot = normalizeName(course.spotName);
    const en = normalizeName(course.en);
    return normalizedName && (normalizedName.includes(ko) || normalizedName.includes(spot) || normalizedName.includes(en) || ko.includes(normalizedName));
  });
  if (byName) return { ...byName, distanceMeters: Math.round(distanceMeters(lat, lng, byName.lat, byName.lng)) };

  const nearest = KMA_TOUR_COURSES
    .map(course => ({ ...course, distanceMeters: distanceMeters(lat, lng, course.lat, course.lng) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  return nearest && nearest.distanceMeters <= 1200
    ? { ...nearest, distanceMeters: Math.round(nearest.distanceMeters) }
    : null;
}

function pickWeatherItem(items, match) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const bySpot = list.find(item => normalizeName(item.spotName).includes(normalizeName(match.spotName)));
  return bySpot || list[0];
}

function normalizeWeatherItem(item, match) {
  if (!item) return null;
  const temp = parseNumber(item.th3);
  const sky = normalizeSky(item.sky);
  const pop = parseNumber(item.pop);
  if (!Number.isFinite(temp) && !sky && !Number.isFinite(pop)) return null;
  return {
    source: 'kma',
    courseId: String(item.courseId || match.courseId),
    courseName: cleanText(item.courseName || '', 120),
    spotName: cleanText(item.spotName || match.spotName, 120),
    temp: Number.isFinite(temp) ? temp : null,
    high: nullableNumber(item.maxTa),
    low: nullableNumber(item.minTa),
    sky,
    pop: nullableNumber(item.pop),
    rain: cleanText(item.rn || '', 40),
    humidity: nullableNumber(item.rhm),
    wind: nullableNumber(item.ws),
    forecastTime: cleanText(item.tm || '', 20)
  };
}

function normalizeSky(value) {
  const text = String(value || '').trim();
  const map = {
    1: '맑음',
    2: '구름조금',
    3: '구름많음',
    4: '흐림'
  };
  return map[text] || text;
}

function getSeoulCurrentDateHour() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

function getKmaServiceKey() {
  const key = String(process.env.KMA_TOUR_WEATHER_SERVICE_KEY || '').trim();
  if (!key) return '';
  try {
    return key.includes('%') ? decodeURIComponent(key) : key;
  } catch (_) {
    return key;
  }
}

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error('Invalid coordinate');
  }
  return number;
}

function parseNumber(value) {
  const number = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : NaN;
}

function nullableNumber(value) {
  const number = parseNumber(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeName(value) {
  return String(value || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, '').toLowerCase();
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const radius = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
