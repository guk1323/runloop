const CHA_PHOTO_URL = 'https://api.kcisa.kr/openapi/service/rest/meta/CHAphot';
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
  const keyword = cleanKeyword(getQueryValue(query.keyword || query.q || query.place));
  if (!keyword) return res.status(400).json({ error: 'Missing keyword' });

  const serviceKey = getServiceKey([
    'CHA_HERITAGE_PHOTO_SERVICE_KEY',
    'CHA_PHOTO_SERVICE_KEY',
    'KCISA_CHA_PHOTO_SERVICE_KEY'
  ]);
  if (!serviceKey) return res.status(200).json({ keyword, photos: [], configured: false });

  try {
    const rows = cleanInt(getQueryValue(query.rows), 8, 1, 20);
    const items = await fetchChaItems(CHA_PHOTO_URL, {
      keyword,
      numOfRows: rows,
      pageNo: 1
    }, serviceKey);
    const normalized = items.map(normalizePhotoItem).filter(Boolean);
    const photos = normalized.filter(item => item.imageUrl);
    return res.status(200).json({ keyword, photos, items: normalized.slice(0, 8), configured: true });
  } catch (error) {
    console.error('CHA heritage photo proxy failed', error);
    return res.status(200).json({ keyword, photos: [], configured: true });
  }
}

async function fetchChaItems(endpoint, params, serviceKey) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    serviceKey,
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]))
  }).toString();

  const response = await fetch(url, { headers: { Accept: 'application/json, application/xml;q=0.9, */*;q=0.8' } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CHA photo failed with ${response.status}: ${text.slice(0, 120)}`);
  }
  const items = parseChaItems(text);
  const header = parseChaHeader(text);
  if (header.resultCode && !['0000', '00', '0'].includes(String(header.resultCode))) {
    throw new Error(`CHA photo returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  return items;
}

function normalizePhotoItem(item) {
  const title = cleanText(item.title || item.sourceTitle || item.alternativeTitle, 100);
  const description = cleanText(item.description, 220);
  const imageUrl = findLikelyImageUrl(item);
  const referenceUrl = findReferenceUrl(item);
  if (!title && !description && !imageUrl && !referenceUrl) return null;
  return {
    contentId: cleanText(item.uci || item.regDate || title, 80),
    title,
    imageUrl,
    location: cleanText(item.spatial || item.spatialCoverage, 100),
    photographer: cleanText(item.creator || item.contributor, 80),
    keywords: cleanText(item.subjectKeyword || item.subjectCategory, 160),
    description,
    referenceUrl,
    rights: cleanText(item.rights || item.copyrightOthers, 160),
    source: '문화재청 문화재사진정보'
  };
}

function findLikelyImageUrl(item) {
  const priorityKeys = [
    'imageUrl', 'imageurl', 'image', 'imgUrl', 'thumbnail', 'thumbUrl',
    'referenceIdentifier', 'url', 'uci', 'description'
  ];
  for (const key of priorityKeys) {
    const url = extractUrl(item && item[key]);
    if (isLikelyImageUrl(url)) return url;
  }
  for (const value of Object.values(item || {})) {
    const url = extractUrl(value);
    if (isLikelyImageUrl(url)) return url;
  }
  return '';
}

function findReferenceUrl(item) {
  for (const value of Object.values(item || {})) {
    const url = extractUrl(value);
    if (url) return url;
  }
  return cleanText(item && item.uci, 160);
}

function extractUrl(value) {
  const text = cleanText(value, 1000);
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? cleanUrl(match[0]) : '';
}

function isLikelyImageUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  return /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(url)
    || /\/(image|photo|thumbnail|thumb)\//i.test(url);
}

function parseChaItems(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return toArray(extractJsonItems(JSON.parse(trimmed)));
    } catch (_) {}
  }
  return parseXmlItems(trimmed);
}

function extractJsonItems(parsed) {
  return parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item
    || parsed && parsed.body && parsed.body.items && parsed.body.items.item
    || parsed && parsed.items && parsed.items.item
    || parsed && parsed.items
    || parsed && parsed.item
    || [];
}

function parseXmlItems(text) {
  const matches = [...String(text || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return matches.map(match => {
    const item = {};
    [...match[1].matchAll(/<([A-Za-z0-9_:-]+)>([\s\S]*?)<\/\1>/g)].forEach(([, key, value]) => {
      item[key.replace(/^[^:]+:/, '')] = decodeXml(value);
    });
    return item;
  });
}

function parseChaHeader(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && parsed.response && parsed.response.header || parsed && parsed.header || {};
    } catch (_) {
      return {};
    }
  }
  return {
    resultCode: getXmlTagValue(trimmed, 'resultCode'),
    resultMsg: getXmlTagValue(trimmed, 'resultMsg')
  };
}

function getXmlTagValue(text, tag) {
  const match = String(text || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function getServiceKey(names) {
  const key = names.map(name => String(process.env[name] || '').trim()).find(Boolean) || '';
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
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanUrl(value) {
  return String(value || '').trim().replace(/[),.;]+$/g, '');
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
