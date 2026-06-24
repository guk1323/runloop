const KTO_BASE_URLS = {
  ko: 'https://apis.data.go.kr/B551011/KorService2',
  en: 'https://apis.data.go.kr/B551011/EngService2'
};
const KTO_KEY_ENV = {
  ko: 'KTO_SERVICE_KEY',
  en: 'KTO_EN_SERVICE_KEY'
};
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

  const query = req.query || {};
  const lang = getKtoLanguage(getQueryValue(query.lang));
  const serviceKey = getKtoServiceKey(lang);
  if (!serviceKey) return res.status(500).json({ error: `${KTO_KEY_ENV[lang]} is not configured` });

  try {
    const lat = cleanCoord(getQueryValue(query.lat), 37.5503, -90, 90);
    const lng = cleanCoord(getQueryValue(query.lng), 126.92, -180, 180);
    const radius = cleanInt(getQueryValue(query.radius), 12000, 1000, 20000);
    const rows = cleanInt(getQueryValue(query.rows), 50, 10, 100);
    const days = cleanInt(getQueryValue(query.days), 45, 7, 120);
    const today = new Date();
    const startDate = formatKtoDate(today);
    const endDate = formatKtoDate(new Date(today.getTime() + days * 86400000));

    const results = await Promise.allSettled([
      fetchKtoItems('locationBasedList2', {
        mapX: lng,
        mapY: lat,
        radius,
        arrange: 'E',
        contentTypeId: 15,
        numOfRows: rows,
        pageNo: 1
      }, serviceKey, lang),
      fetchKtoItems('searchFestival2', {
        eventStartDate: startDate,
        eventEndDate: endDate,
        arrange: 'A',
        numOfRows: rows,
        pageNo: 1
      }, serviceKey, lang)
    ]);

    const merged = results
      .flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .map(item => normalizeKtoEvent(item, lat, lng, lang))
      .filter(Boolean);

    const events = dedupeEvents(merged)
      .filter(event => {
        if (!event.endDate) return true;
        return String(event.endDate) >= startDate;
      })
      .filter(event => {
        if (event.distFromMe === null) return false;
        return Number(event.distFromMe) * 1000 <= radius * 1.2;
      })
      .sort(sortEvents)
      .slice(0, 20);

    return res.status(200).json({ events, lang });
  } catch (error) {
    console.error('KTO tour event proxy failed', error);
    return res.status(400).json({ error: 'Invalid KTO tour event request' });
  }
}

async function fetchKtoItems(operation, params, serviceKey, lang) {
  const url = new URL(`${KTO_BASE_URLS[lang] || KTO_BASE_URLS.ko}/${operation}`);
  url.search = new URLSearchParams({
    serviceKey,
    MobileOS: 'ETC',
    MobileApp: 'Runloop',
    _type: 'json',
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]))
  }).toString();

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`KTO event failed with ${response.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  const header = parsed && parsed.response && parsed.response.header;
  if (header && header.resultCode && header.resultCode !== '0000') {
    throw new Error(`KTO event returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  return toArray(parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item);
}

function normalizeKtoEvent(item, userLat, userLng, lang) {
  const title = cleanText(item && item.title, 120);
  if (!title) return null;
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const distFromMe = hasPoint ? getDistKm(userLat, userLng, lat, lng) : null;
  const startDate = cleanDate(item.eventstartdate || item.eventStartDate);
  const endDate = cleanDate(item.eventenddate || item.eventEndDate);
  const addr = cleanText([item.addr1, item.addr2].filter(Boolean).join(' '), 160);
  return {
    id: cleanText(item.contentid || item.contentId || `${title}:${startDate}:${addr}`, 100),
    contentId: cleanText(item.contentid || item.contentId, 40),
    title,
    startDate,
    endDate,
    place: addr || cleanText(item.eventplace || item.eventPlace || '', 120),
    image: cleanUrl(item.firstimage || item.firstimage2 || ''),
    lat: hasPoint ? lat : null,
    lng: hasPoint ? lng : null,
    distFromMe,
    tel: cleanText(item.tel, 80),
    link: getSearchLink(title, lang),
    source: lang === 'en' ? 'VisitKorea' : '한국관광공사'
  };
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter(event => {
    const key = String(event.contentId || `${event.title}:${event.startDate}:${event.place}`).replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortEvents(a, b) {
  const aDate = a.startDate || '99999999';
  const bDate = b.startDate || '99999999';
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  const aDist = Number.isFinite(Number(a.distFromMe)) ? Number(a.distFromMe) : 9999;
  const bDist = Number.isFinite(Number(b.distFromMe)) ? Number(b.distFromMe) : 9999;
  return aDist - bDist;
}

function getKtoLanguage(value) {
  return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'ko';
}

function getKtoServiceKey(lang) {
  const key = String(process.env[KTO_KEY_ENV[lang] || KTO_KEY_ENV.ko] || '').trim();
  if (!key) return '';
  try {
    return key.includes('%') ? decodeURIComponent(key) : key;
  } catch (_) {
    return key;
  }
}

function getSearchLink(title, lang) {
  const query = lang === 'en' ? `${title} Korea festival` : `${title} 행사`;
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
}

function formatKtoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function cleanDate(value) {
  const date = String(value || '').replace(/[^\d]/g, '').slice(0, 8);
  return date.length === 8 ? date : '';
}

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanCoord(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//.test(url) ? url : '';
}

function getDistKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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
