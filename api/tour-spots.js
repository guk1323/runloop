const KTO_BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
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

  const serviceKey = getKtoServiceKey();
  if (!serviceKey) {
    return res.status(500).json({ error: 'KTO_SERVICE_KEY is not configured' });
  }

  try {
    const query = req.query || {};
    const lat = clampNumber(getQueryValue(query.lat), -90, 90);
    const lng = clampNumber(getQueryValue(query.lng), -180, 180);
    const radius = cleanInt(getQueryValue(query.radius), 10000, 1000, 20000);
    const rows = cleanInt(getQueryValue(query.rows), 80, 10, 120);

    const listParams = {
      mapX: lng,
      mapY: lat,
      radius,
      arrange: 'E',
      numOfRows: rows,
      pageNo: 1
    };
    const [tourItems, cultureItems] = await Promise.all([
      fetchKtoItems('locationBasedList2', { ...listParams, contentTypeId: 12 }, serviceKey),
      fetchKtoItems('locationBasedList2', { ...listParams, contentTypeId: 14 }, serviceKey)
    ]);

    const spots = mergeKtoItems(tourItems.concat(cultureItems), lat, lng)
      .map(item => normalizeKtoSpot(item, lat, lng))
      .filter(Boolean)
      .sort((a, b) => {
        const distDiff = Number(a.distFromMe) - Number(b.distFromMe);
        if (distDiff) return distDiff;
        return Number(b.cultureValueStars) - Number(a.cultureValueStars);
      });

    return res.status(200).json({ spots });
  } catch (error) {
    console.error('KTO tour spot proxy failed', error);
    return res.status(400).json({ error: 'Invalid KTO tour spot request' });
  }
}

async function fetchKtoItems(operation, params, serviceKey) {
  const url = new URL(`${KTO_BASE_URL}/${operation}`);
  const search = new URLSearchParams({
    serviceKey,
    MobileOS: 'ETC',
    MobileApp: 'Runloop',
    _type: 'json',
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]))
  });
  url.search = search.toString();

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`KTO ${operation} failed with ${response.status}: ${text.slice(0, 120)}`);
  }

  const parsed = JSON.parse(text);
  const header = parsed && parsed.response && parsed.response.header;
  if (header && header.resultCode && header.resultCode !== '0000') {
    throw new Error(`KTO ${operation} returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  return toArray(parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item);
}

function normalizeKtoSpot(item, userLat, userLng) {
  const title = cleanText(item.title, 80);
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  if (!title || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (isExcludedKtoSpot(item, title)) return null;

  const contentTypeId = String(item.contenttypeid || '');
  const distMeters = Number(item.dist);
  const distFromMe = Number.isFinite(distMeters)
    ? distMeters / 1000
    : getDistKm(userLat, userLng, lat, lng);
  const value = getKtoCultureValue(item, title);
  if (value.excluded) return null;

  return {
    id: String(item.contentid || `${title}:${lat.toFixed(5)}:${lng.toFixed(5)}`),
    contentId: String(item.contentid || ''),
    contentTypeId,
    source: 'kto',
    place_name: title,
    name: title,
    y: lat,
    x: lng,
    distFromMe,
    cultureType: value.type,
    cultureValueStars: value.stars,
    cultureValueLabel: value.label,
    category_name: buildKtoCategoryLabel(item, value.type),
    address_name: cleanText([item.addr1, item.addr2].filter(Boolean).join(' '), 140),
    firstImage: cleanUrl(item.firstimage || item.firstimage2),
    place_url: getVisitKoreaSearchUrl(title)
  };
}

function mergeKtoItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = String(item && item.contentid || '').trim()
      || `${cleanText(item && item.title, 80)}:${item && item.mapx}:${item && item.mapy}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getKtoCultureValue(item, title) {
  const text = [title, item.addr1, item.cat1, item.cat2, item.cat3].filter(Boolean).join(' ');
  const contentTypeId = String(item.contenttypeid || '');
  const cat2 = String(item.cat2 || '');
  const cat3 = String(item.cat3 || '');
  const type = getKtoCultureType(item, title);

  if (isFiveStarCultureTitle(title)) return { stars: 5, label: '희귀 유산', type };
  if (cat2 === 'A0201' || /궁|고궁|궁궐|왕릉|문화재|유적|사적|성곽|서원|향교|한옥|사찰|절|성당|근대문화유산/.test(text)) {
    return { stars: 4, label: '역사 명소', type };
  }
  if (contentTypeId === '14') {
    if (/국립|시립|도립|기념관|역사관/.test(text) || ['A02060100', 'A02060200'].includes(cat3)) {
      return { stars: 4, label: '대표 문화시설', type };
    }
    if (/박물관|미술관|전시관|갤러리|공연장|아트센터|문화예술회관/.test(text)) {
      return { stars: 3, label: '문화시설', type };
    }
    return { stars: 2, label: '지역 문화', type };
  }
  if (/전시|공연|문화관|기념관|박물관|미술관/.test(text)) {
    return { stars: 3, label: '문화시설', type };
  }
  return { excluded: true, stars: 0, label: '추천 제외', type };
}

function getKtoCultureType(item, title) {
  const text = [title, item.cat2, item.cat3].filter(Boolean).join(' ');
  const cat3 = String(item.cat3 || '');
  if (/A0201|궁|고궁|왕릉|문화재|유적|사적|성곽|서원|향교|한옥|사찰|절|성당/.test(text)) return '문화재';
  if (/박물관|기념관/.test(text) || ['A02060100', 'A02060200'].includes(cat3)) return '박물관';
  if (/미술관|갤러리|전시/.test(text) || ['A02060300', 'A02060500'].includes(cat3)) return '전시';
  if (/공연|극장|아트센터|문화예술회관/.test(text) || cat3 === 'A02060600') return '공연';
  return '문화 스팟';
}

function isExcludedKtoSpot(item, title) {
  const text = [title, item.addr1, item.addr2].filter(Boolean).join(' ');
  const cat3 = String(item.cat3 || '');
  if (/관리소|사무소|매표소|주차장|화장실|안내소|관광안내소|입구|출구|고객센터|센터$|분소|관리센터/.test(text)) return true;
  if (/노래연습장|노래방|코인노래|karaoke|유흥|단란주점|주점|호프|펍|룸살롱|클럽|pc방|피시방|오락실/i.test(text)) return true;
  if (/CGV|롯데시네마|메가박스|씨네큐|백화점|쇼핑몰|마트|카페|식당|사설/i.test(text)) return true;
  if (['A02060900', 'A02061000', 'A02061200', 'A02061300', 'A02061400'].includes(cat3)) return true;
  return false;
}

function isFiveStarCultureTitle(title) {
  const compact = String(title || '').replace(/\s+/g, '');
  const exactNames = [
    '경복궁', '창덕궁', '종묘', '수원화성', '남한산성',
    '불국사', '석굴암', '해인사', '하회마을', '양동마을',
    '공산성', '부소산성', '미륵사지', '왕궁리유적'
  ];
  return exactNames.some(name => compact === name);
}

function buildKtoCategoryLabel(item, fallback) {
  return [fallback, item.contenttypeid ? `관광공사 ${item.contenttypeid}` : '']
    .filter(Boolean)
    .join(' · ');
}

function getVisitKoreaSearchUrl(title) {
  return 'https://korean.visitkorea.or.kr/search/search_list.do?keyword=' + encodeURIComponent(title);
}

function getKtoServiceKey() {
  const key = String(process.env.KTO_SERVICE_KEY || '').trim();
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

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getDistKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
