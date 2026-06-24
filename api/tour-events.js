const KTO_BASE_URLS = {
  ko: 'https://apis.data.go.kr/B551011/KorService2',
  en: 'https://apis.data.go.kr/B551011/EngService2'
};
const KTO_KEY_ENV = {
  ko: 'KTO_SERVICE_KEY',
  en: 'KTO_EN_SERVICE_KEY'
};
const KSPORTS_API_URL = 'https://api.odcloud.kr/api/3072953/v1/uddi:2ca4b21a-482b-40d9-bd2f-f8812e2205f4';
const KSPORTS_KEY_ENV = 'KSPORTS_SERVICE_KEY';
const ALLOWED_ORIGINS = new Set([
  'https://runloop-jet.vercel.app',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'capacitor://localhost',
  'ionic://localhost'
]);
const REGION_CENTERS = [
  { pattern: /서울|종로|중구|용산|성동|광진|동대문|중랑|성북|강북|도봉|노원|은평|서대문|마포|양천|강서|구로|금천|영등포|동작|관악|서초|강남|송파|강동/, lat: 37.5665, lng: 126.9780 },
  { pattern: /수원/, lat: 37.2636, lng: 127.0286 },
  { pattern: /용인/, lat: 37.2411, lng: 127.1776 },
  { pattern: /화성/, lat: 37.1995, lng: 126.8310 },
  { pattern: /성남|분당|판교/, lat: 37.4200, lng: 127.1265 },
  { pattern: /안양|군포|의왕/, lat: 37.3943, lng: 126.9568 },
  { pattern: /부천|광명/, lat: 37.5034, lng: 126.7660 },
  { pattern: /고양|파주/, lat: 37.6584, lng: 126.8320 },
  { pattern: /인천/, lat: 37.4563, lng: 126.7052 },
  { pattern: /경기|경기도/, lat: 37.2636, lng: 127.0286 },
  { pattern: /부산/, lat: 35.1796, lng: 129.0756 },
  { pattern: /대구/, lat: 35.8714, lng: 128.6014 },
  { pattern: /광주/, lat: 35.1595, lng: 126.8526 },
  { pattern: /대전/, lat: 36.3504, lng: 127.3845 },
  { pattern: /울산/, lat: 35.5384, lng: 129.3114 },
  { pattern: /세종/, lat: 36.4800, lng: 127.2890 },
  { pattern: /강원|춘천/, lat: 37.8813, lng: 127.7298 },
  { pattern: /충북|청주/, lat: 36.6424, lng: 127.4890 },
  { pattern: /충남|천안|아산/, lat: 36.8151, lng: 127.1139 },
  { pattern: /전북|전주/, lat: 35.8242, lng: 127.1480 },
  { pattern: /전남|목포|여수|순천/, lat: 34.8118, lng: 126.3922 },
  { pattern: /경북|포항|경주/, lat: 36.0190, lng: 129.3435 },
  { pattern: /경남|창원|김해/, lat: 35.2285, lng: 128.6811 },
  { pattern: /제주/, lat: 33.4996, lng: 126.5312 }
];

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = req.query || {};
  const lang = getKtoLanguage(getQueryValue(query.lang));
  const ktoServiceKey = getKtoServiceKey(lang);
  const sportsServiceKey = getSportsServiceKey();
  if (!ktoServiceKey && !sportsServiceKey) {
    return res.status(500).json({ error: `${KTO_KEY_ENV[lang]} or ${KSPORTS_KEY_ENV} is not configured` });
  }

  try {
    const lat = cleanCoord(getQueryValue(query.lat), 37.5503, -90, 90);
    const lng = cleanCoord(getQueryValue(query.lng), 126.92, -180, 180);
    const radius = cleanInt(getQueryValue(query.radius), 12000, 1000, 50000);
    const rows = cleanInt(getQueryValue(query.rows), 50, 10, 100);
    const days = cleanInt(getQueryValue(query.days), 45, 7, 120);
    const today = new Date();
    const startDate = formatKtoDate(today);
    const endDate = formatKtoDate(new Date(today.getTime() + days * 86400000));
    const requests = [];

    if (ktoServiceKey) {
      requests.push(
        fetchKtoItems('locationBasedList2', {
          mapX: lng,
          mapY: lat,
          radius: Math.min(radius, 20000),
          arrange: 'E',
          contentTypeId: 15,
          numOfRows: rows,
          pageNo: 1
        }, ktoServiceKey, lang),
        fetchKtoItems('searchFestival2', {
          eventStartDate: startDate,
          eventEndDate: endDate,
          arrange: 'A',
          numOfRows: rows,
          pageNo: 1
        }, ktoServiceKey, lang)
      );
    }
    if (sportsServiceKey) {
      requests.push(fetchSportsItems({ rows: Math.min(rows * 8, 800), pageNo: 1 }, sportsServiceKey));
    }

    const results = await Promise.allSettled(requests);

    const merged = results
      .flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .map(item => item && item.__source === 'ksports'
        ? normalizeSportsEvent(item, lat, lng, lang)
        : normalizeKtoEvent(item, lat, lng, lang))
      .filter(Boolean);

    const events = dedupeEvents(merged)
      .filter(event => {
        if (!event.endDate) return true;
        return String(event.endDate) >= startDate;
      })
      .filter(event => {
        if (event.distFromMe === null) return event.type === 'sports';
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
    category: lang === 'en' ? 'Festival' : '축제',
    type: 'festival',
    source: lang === 'en' ? 'VisitKorea' : '한국관광공사'
  };
}

async function fetchSportsItems(params, serviceKey) {
  const url = new URL(KSPORTS_API_URL);
  url.search = new URLSearchParams({
    page: String(params.pageNo || 1),
    perPage: String(params.rows || 300),
    returnType: 'JSON',
    serviceKey
  }).toString();

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`KSPORTS event failed with ${response.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  return toArray(parsed && parsed.data).map(item => ({ ...item, __source: 'ksports' }));
}

function normalizeSportsEvent(item, userLat, userLng, lang) {
  const title = cleanText(item['대회명'] || item['행사명'] || item['대회명칭'] || item['대회설명'] || '', 120);
  if (!title) return null;
  const place = cleanText(item['개최지'] || item['대회장소'] || item['장소'] || '', 160);
  const point = inferRegionPoint(place);
  const startDate = cleanDate(item['시작일자'] || item['대회시작일'] || item['경기일'] || '');
  const endDate = cleanDate(item['종료일자'] || item['대회종료일'] || item['경기일'] || '');
  if (!startDate && !endDate) return null;
  const distFromMe = point ? getDistKm(userLat, userLng, point.lat, point.lng) : null;
  const org = cleanText(item['종목단체'] || item['개최단체'] || '', 80);
  return {
    id: cleanText(`sports:${title}:${startDate}:${place}`, 140),
    contentId: '',
    title,
    startDate,
    endDate,
    place,
    image: '',
    lat: point ? point.lat : null,
    lng: point ? point.lng : null,
    distFromMe,
    tel: cleanText(item['전화번호'] || '', 80),
    link: cleanUrl(item['자료바로가기'] || item['단체홈페이지'] || '') || getSearchLink(title, lang),
    category: lang === 'en' ? 'Sports' : '체육',
    type: 'sports',
    source: lang === 'en' ? 'Korean Sport & Olympic Committee' : '대한체육회',
    organizer: org
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
  return normalizeServiceKey(key);
}

function getSportsServiceKey() {
  const key = String(process.env[KSPORTS_KEY_ENV] || process.env.SPORTS_SERVICE_KEY || '').trim();
  return normalizeServiceKey(key);
}

function normalizeServiceKey(key) {
  if (!key) return '';
  try {
    return key.includes('%') ? decodeURIComponent(key) : key;
  } catch (_) {
    return key;
  }
}

function inferRegionPoint(place) {
  const text = String(place || '').trim();
  if (!text) return null;
  const match = REGION_CENTERS.find(region => region.pattern.test(text));
  return match ? { lat: match.lat, lng: match.lng } : null;
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
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
  if (match) {
    return `${match[1]}${match[2].padStart(2, '0')}${match[3].padStart(2, '0')}`;
  }
  const date = text.replace(/[^\d]/g, '').slice(0, 8);
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
