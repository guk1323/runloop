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
    const contentId = cleanContentId(getQueryValue(query.contentId || query.contentid || query.id));
    if (!contentId) return res.status(400).json({ error: 'Missing contentId' });
    const item = await fetchKtoDetail(contentId, serviceKey, lang);
    return res.status(200).json({
      contentId,
      lang,
      title: cleanText(item.title || '', 100),
      overview: cleanOverview(item.overview || ''),
      firstImage: cleanUrl(item.firstimage || item.firstimage2 || '')
    });
  } catch (error) {
    console.error('KTO tour detail proxy failed', error);
    return res.status(400).json({ error: 'Invalid KTO detail request' });
  }
}

async function fetchKtoDetail(contentId, serviceKey, lang) {
  const url = new URL(`${KTO_BASE_URLS[lang] || KTO_BASE_URLS.ko}/detailCommon2`);
  url.search = new URLSearchParams({
    serviceKey,
    MobileOS: 'ETC',
    MobileApp: 'Runloop',
    _type: 'json',
    contentId,
    defaultYN: 'Y',
    firstImageYN: 'Y',
    areacodeYN: 'Y',
    addrinfoYN: 'Y',
    mapinfoYN: 'Y',
    overviewYN: 'Y'
  }).toString();

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`KTO detail failed with ${response.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  const header = parsed && parsed.response && parsed.response.header;
  if (header && header.resultCode && header.resultCode !== '0000') {
    throw new Error(`KTO detail returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  const items = toArray(parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item);
  return items[0] || {};
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

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanContentId(value) {
  return String(value || '').replace(/[^\w-]/g, '').slice(0, 40);
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanOverview(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function cleanUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//.test(url) ? url : '';
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
