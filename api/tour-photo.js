const PHOTO_GALLERY_BASE_URL = 'https://apis.data.go.kr/B551011/PhotoGalleryService1';
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

  const serviceKey = getPhotoServiceKey();
  if (!serviceKey) {
    return res.status(500).json({ error: 'KTO_PHOTO_SERVICE_KEY is not configured' });
  }

  try {
    const query = req.query || {};
    const keyword = cleanKeyword(getQueryValue(query.keyword || query.q || query.place));
    if (!keyword) return res.status(400).json({ error: 'Missing keyword' });

    const items = await fetchPhotoItems(keyword, serviceKey, cleanInt(getQueryValue(query.rows), 6, 1, 12));
    const photos = items
      .map(normalizePhotoItem)
      .filter(Boolean);

    return res.status(200).json({ keyword, photos });
  } catch (error) {
    console.error('KTO photo proxy failed', error);
    return res.status(400).json({ error: 'Invalid KTO photo request' });
  }
}

async function fetchPhotoItems(keyword, serviceKey, rows) {
  const url = new URL(`${PHOTO_GALLERY_BASE_URL}/gallerySearchList1`);
  url.search = new URLSearchParams({
    serviceKey,
    MobileOS: 'ETC',
    MobileApp: 'Orotgil',
    _type: 'json',
    arrange: 'A',
    numOfRows: String(rows),
    pageNo: '1',
    keyword
  }).toString();

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`KTO photo failed with ${response.status}: ${text.slice(0, 120)}`);
  }
  const parsed = JSON.parse(text);
  const header = parsed && parsed.response && parsed.response.header;
  if (header && header.resultCode && header.resultCode !== '0000') {
    throw new Error(`KTO photo returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  return toArray(parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item);
}

function normalizePhotoItem(item) {
  const imageUrl = cleanUrl(item && item.galWebImageUrl);
  if (!imageUrl) return null;
  return {
    contentId: cleanText(item.galContentId, 40),
    title: cleanText(item.galTitle, 100),
    imageUrl,
    location: cleanText(item.galPhotographyLocation, 100),
    photographer: cleanText(item.galPhotographer, 80),
    month: cleanText(item.galPhotographyMonth, 20),
    keywords: cleanText(item.galSearchKeyword, 160),
    source: '한국관광공사 포토코리아'
  };
}

function getPhotoServiceKey() {
  const key = String(process.env.KTO_PHOTO_SERVICE_KEY || '').trim();
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

function cleanKeyword(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s._~+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//.test(url) ? url : '';
}

function cleanInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
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
