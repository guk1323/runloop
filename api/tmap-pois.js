const TMAP_POI_URL = 'https://apis.openapi.sk.com/tmap/pois';
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

  const appKey = String(process.env.TMAP_APP_KEY || '').trim();
  if (!appKey) {
    return res.status(500).json({ error: 'TMAP_APP_KEY is not configured' });
  }

  try {
    const params = normalizePoiParams(req.query || {});
    const tmapRes = await fetch(`${TMAP_POI_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json', appKey }
    });

    const text = await tmapRes.text();
    res.status(tmapRes.status);
    res.setHeader('Content-Type', tmapRes.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch (error) {
    console.error('TMAP POI proxy failed', error);
    return res.status(400).json({ error: 'Invalid TMAP POI request' });
  }
}

function normalizePoiParams(query) {
  const keyword = cleanKeyword(getQueryValue(query.searchKeyword));
  if (!keyword) throw new Error('Missing keyword');

  const params = new URLSearchParams({
    version: '1',
    searchKeyword: keyword,
    page: cleanInt(getQueryValue(query.page), 1, 1, 10),
    count: cleanInt(getQueryValue(query.count), 20, 1, 20),
    searchType: 'all',
    searchtypCd: getQueryValue(query.searchtypCd) === 'R' ? 'R' : 'A',
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    multiPoint: 'N',
    poiGroupYn: 'N'
  });

  const centerLon = optionalNumber(getQueryValue(query.centerLon), -180, 180);
  const centerLat = optionalNumber(getQueryValue(query.centerLat), -90, 90);
  if (centerLon !== null && centerLat !== null) {
    params.set('centerLon', String(centerLon));
    params.set('centerLat', String(centerLat));
    params.set('radius', cleanInt(getQueryValue(query.radius), 33, 1, 33));
  }

  return params;
}

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanKeyword(value) {
  return String(value || '').replace(/[^\p{L}\p{N}\s._~+-]/gu, '').trim().slice(0, 80);
}

function cleanInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return String(fallback);
  return String(Math.min(max, Math.max(min, number)));
}

function optionalNumber(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
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
