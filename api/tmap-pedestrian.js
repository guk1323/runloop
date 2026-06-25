const TMAP_PEDESTRIAN_URL = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1';
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

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const appKey = String(process.env.TMAP_APP_KEY || '').trim();
  if (!appKey) {
    return res.status(500).json({ error: 'TMAP_APP_KEY is not configured' });
  }

  try {
    const body = normalizePedestrianBody(req.body);
    const tmapRes = await fetch(TMAP_PEDESTRIAN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        appKey
      },
      body: JSON.stringify(body)
    });

    const text = await tmapRes.text();
    res.status(tmapRes.status);
    res.setHeader('Content-Type', tmapRes.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch (error) {
    console.error('TMAP pedestrian proxy failed', error);
    return res.status(400).json({ error: 'Invalid TMAP pedestrian route request' });
  }
}

function normalizePedestrianBody(rawBody) {
  const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody || {});
  const normalized = {
    startX: clampNumber(body.startX, -180, 180),
    startY: clampNumber(body.startY, -90, 90),
    endX: clampNumber(body.endX, -180, 180),
    endY: clampNumber(body.endY, -90, 90),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    searchOption: cleanOption(body.searchOption, '4'),
    sort: 'index',
    startName: cleanName(body.startName || '출발'),
    endName: cleanName(body.endName || '도착')
  };

  const passList = cleanPassList(body.passList);
  if (passList) normalized.passList = passList;
  return normalized;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error('Invalid coordinate');
  }
  return number;
}

function cleanOption(value, fallback) {
  const text = String(value || '').trim();
  return /^[0-9]{1,2}$/.test(text) ? text : fallback;
}

function cleanName(value) {
  return String(value || '').replace(/[^\p{L}\p{N}%._~+-]/gu, '').slice(0, 60) || 'Orotgil';
}

function cleanPassList(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parts = text.split('_').slice(0, 5).map(part => {
    const [lng, lat] = part.split(',').map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '';
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return '';
    return `${lng},${lat}`;
  }).filter(Boolean);
  return parts.join('_');
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
