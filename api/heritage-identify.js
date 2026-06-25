const DEFAULT_MODEL = 'gpt-5-mini';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 3;
const RATE_LIMIT_DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_DAY = 20;
const MAX_IMAGE_DATA_URL_LENGTH = 4_200_000;
const KTO_BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
const CHA_HERITAGE_URL = 'https://api.kcisa.kr/openapi/service/rest/meta/CHAheri';
const ALLOWED_ORIGINS = new Set([
  'https://runloop-jet.vercel.app',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'capacitor://localhost',
  'ionic://localhost'
]);
const KNOWN_HERITAGE_SEEDS = [
  {
    id: 'cheomseongdae',
    name: '첨성대',
    aliases: ['첨성대', '경주 첨성대', 'Cheomseongdae', '천문대', '석조 천문대', 'astronomical observatory', 'stone observatory'],
    dedupeAliases: ['경주 첨성대', 'Cheomseongdae'],
    visualKeywords: ['첨성대', '천문대', '석조천문대', '석조 천문대', '관측대', '원통형', '병 모양', '돌탑', '석조', '사각 창', '네모난 창', '신라', '경주', 'observatory', 'astronomical', 'stone tower', 'cylindrical', 'square window'],
    lat: 35.834722,
    lng: 129.218611,
    address: '경북 경주시 인왕동',
    type: '문화재',
    description: '신라 시대에 만들어진 것으로 알려진 석조 천문 관측 시설이에요. 원통형에 가까운 돌 구조와 중간의 사각 창이 특징입니다.'
  },
  {
    id: 'gyeongbokgung',
    name: '경복궁',
    aliases: ['경복궁', '근정전', 'Gyeongbokgung', 'Geunjeongjeon'],
    dedupeAliases: ['서울 경복궁', 'Gyeongbokgung'],
    visualKeywords: ['궁궐', '궁전', '근정전', '경복궁', '단청', '월대', 'palace', 'royal palace'],
    lat: 37.579617,
    lng: 126.977041,
    address: '서울 종로구 사직로 161',
    type: '궁궐',
    description: '조선 왕조의 법궁으로, 왕실 의례와 국가 행사가 열리던 대표 궁궐입니다.'
  },
  {
    id: 'bulguksa',
    name: '불국사',
    aliases: ['불국사', 'Bulguksa', '청운교', '백운교'],
    dedupeAliases: ['경주 불국사', 'Bulguksa'],
    visualKeywords: ['사찰', '절', '불국사', '석가탑', '다보탑', 'temple', 'pagoda'],
    lat: 35.790014,
    lng: 129.331961,
    address: '경북 경주시 불국로 385',
    type: '사찰',
    description: '통일신라 불교문화의 대표 유산으로 석가탑, 다보탑 등과 함께 세계유산으로 알려져 있습니다.'
  },
  {
    id: 'suwon-hwaseong',
    name: '수원화성',
    aliases: ['수원화성', '화성행궁', 'Hwaseong Fortress'],
    dedupeAliases: ['수원 화성', '수원화성', 'Hwaseong Fortress'],
    visualKeywords: ['성곽', '성벽', '장안문', '팔달문', '화성', 'fortress', 'city wall'],
    lat: 37.287889,
    lng: 127.011778,
    address: '경기 수원시 장안구 영화동',
    type: '성곽',
    description: '정조 시대에 축성된 계획도시 성곽으로, 군사·도시·건축 기술이 함께 담긴 세계유산입니다.'
  }
];
const HERITAGE_REGION_PREFIXES = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시',
  '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
  '서울시', '부산시', '대구시', '인천시', '광주시', '대전시', '울산시', '세종시',
  '경주시', '수원시', '공주시', '부여군', '전주시', '안동시', '강릉시', '춘천시', '청주시', '목포시', '여수시', '순천시', '제주시', '서귀포시',
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  '경주', '수원', '공주', '부여', '전주', '안동', '강릉', '춘천', '청주', '목포', '여수', '순천', '서귀포'
].map(normalizeName).filter(Boolean).sort((a, b) => b.length - a.length);
const GENERIC_HERITAGE_NAME_KEYS = new Set([
  '궁궐', '궁전', '석탑', '불상', '성곽', '사찰', '절', '문화재', '유적', '유산', '관광지', '박물관', '전시관',
  '천문대', '행궁', '화성', '왕릉', '고분', '서원', '향교', '한옥', '문', '탑'
]);
const rateBuckets = globalThis.__runloopHeritageIdentifyRateBuckets || (globalThis.__runloopHeritageIdentifyRateBuckets = new Map());

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });

  const rateLimit = checkRateLimit(req);
  if (!rateLimit.ok) {
    res.setHeader('Retry-After', String(rateLimit.retryAfterSec));
    setRateLimitHeaders(res, rateLimit);
    return res.status(429).json({ error: 'AI rate limit exceeded', retryAfterSec: rateLimit.retryAfterSec });
  }
  setRateLimitHeaders(res, rateLimit);

  try {
    const body = parseRequestBody(req.body);
    const imageDataUrl = cleanImageDataUrl(body.imageDataUrl || body.image);
    if (!imageDataUrl) return res.status(400).json({ error: 'Missing image' });

    const lat = clampOptionalNumber(body.lat, -90, 90);
    const lng = clampOptionalNumber(body.lng, -180, 180);
    const lang = String(body.lang || '').toLowerCase().startsWith('en') ? 'en' : 'ko';
    const aiResult = await analyzeImageWithOpenAi(apiKey, { imageDataUrl, lat, lng });
    if (!aiResult.ok) {
      console.error('OpenAI heritage identification failed', aiResult.status, aiResult.error);
      return res.status(502).json({ error: 'AI image analysis failed' });
    }

    const analysis = normalizeAiAnalysis(parseJsonText(extractOpenAiText(aiResult.data)));
    const dataResult = await buildCultureDataCandidates(analysis, { lat, lng, lang });
    const candidates = mergeAiFallbackCandidates(dataResult.candidates, analysis, { lat, lng, lang }).slice(0, 3);

    return res.status(200).json({
      analysis: {
        summary: analysis.summary,
        visibleText: analysis.visibleText,
        visualTags: analysis.visualTags,
        queries: analysis.queries.slice(0, 6)
      },
      candidates,
      sources: dataResult.sources,
      model: aiResult.model
    });
  } catch (error) {
    console.error('Heritage identification error', error);
    return res.status(500).json({ error: 'Failed to identify heritage photo' });
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

async function analyzeImageWithOpenAi(apiKey, context) {
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
          'You analyze Korean cultural heritage photos for Orotgil.',
          'Return valid JSON only. Do not claim certainty.',
          'Extract visible Korean or English text when present.',
          'Suggest searchable Korean place or heritage names, not broad generic categories only.',
          'Recognize iconic Korean heritage when visually distinctive, for example Cheomseongdae is a stone astronomical observatory with a cylindrical stone body and square window.',
          'If unsure, provide multiple candidates with cautious reasons.'
        ].join(' '),
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                '사진 속 문화재 또는 문화유산 후보를 찾기 위한 단서를 추출해줘.',
                context.lat !== null && context.lng !== null ? `사용자 현재 위치: ${context.lat.toFixed(5)}, ${context.lng.toFixed(5)}` : '사용자 현재 위치: 없음',
                'JSON 형식: {"summary":"사진 단서 한 문장","visibleText":["보이는 글자"],"visualTags":["궁궐","석탑"],"queries":["검색할 한국어 후보명"],"candidates":[{"name":"후보명","reason":"짧은 이유","confidence":0.0}]}',
                'queries는 3~6개, candidates는 1~3개. 모르면 confidence를 낮게 둬.'
              ].join('\n')
            },
            {
              type: 'input_image',
              image_url: context.imageDataUrl
            }
          ]
        }],
        max_output_tokens: 1200
      })
    });

    const data = await aiRes.json().catch(() => ({}));
    if (aiRes.ok) return { ok: true, data, model };

    lastError = { model, status: aiRes.status, error: data && data.error };
    console.error('OpenAI vision model attempt failed', lastError);
    if (!shouldTryNextModel(aiRes.status, data && data.error)) break;
  }

  return { ok: false, status: lastError && lastError.status, error: lastError };
}

function getModelCandidates() {
  return [process.env.OPENAI_VISION_MODEL, process.env.OPENAI_MODEL, DEFAULT_MODEL, 'gpt-4.1-mini']
    .map(model => String(model || '').trim())
    .filter(Boolean)
    .filter((model, index, arr) => arr.indexOf(model) === index);
}

function shouldTryNextModel(status, error) {
  const message = String((error && (error.message || error.code || error.type)) || '');
  return status === 400 || status === 404 || /model|not found|does not exist|access|vision|image|modalit/i.test(message);
}

async function buildCultureDataCandidates(analysis, context) {
  const ktoKey = getServiceKey(['KTO_SERVICE_KEY']);
  const chaKey = getServiceKey(['CHA_HERITAGE_SERVICE_KEY', 'CHA_SERVICE_KEY', 'KCISA_CHA_HERITAGE_SERVICE_KEY']);
  const queries = getSearchQueries(analysis);
  const sources = [];
  const bucket = new Map();
  const knownMatches = getKnownHeritageMatches(analysis, context);
  knownMatches.forEach(candidate => addCandidate(bucket, candidate));
  if (knownMatches.length) sources.push('대표 문화재 보정 후보');

  for (const [queryIndex, query] of queries.entries()) {
    const baseScore = Math.max(24, 100 - queryIndex * 9);
    if (ktoKey) {
      const ktoItems = await fetchKtoKeywordItems(query, ktoKey).catch(error => {
        console.warn('KTO heritage search skipped', query, error);
        return [];
      });
      if (ktoItems.length) sources.push('한국관광공사 국문 관광정보');
      ktoItems.forEach(item => addCandidate(bucket, normalizeKtoCandidate(item, query, baseScore, context)));
    }
    if (chaKey) {
      const chaItems = await fetchChaHeritageItems(query, chaKey, 6).catch(error => {
        console.warn('CHA heritage search skipped', query, error);
        return [];
      });
      if (chaItems.length) sources.push('문화재청 문화재정보');
      chaItems.forEach(item => addCandidate(bucket, normalizeChaCandidate(item, query, baseScore)));
    }
  }

  const candidates = await enrichKtoCandidateDetails(Array.from(bucket.values()), ktoKey);
  candidates.sort((a, b) => b.score - a.score);
  const publicCandidates = dedupePublicCandidates(candidates.map(candidate => toPublicCandidate(candidate, context)));
  return {
    candidates: publicCandidates,
    sources: Array.from(new Set(sources))
  };
}

function getSearchQueries(analysis) {
  const raw = []
    .concat(getKnownHeritageExpandedQueries(analysis))
    .concat(analysis.queries || [])
    .concat((analysis.candidates || []).map(item => item && item.name))
    .concat(analysis.visibleText || []);
  const seen = new Set();
  return raw
    .map(value => cleanSearchQuery(value))
    .filter(value => value.length >= 2)
    .filter(value => !/^(궁궐|석탑|불상|성곽|사찰|문화재|유적|한옥|박물관|temple|palace|heritage)$/i.test(value))
    .filter(value => {
      const key = normalizeName(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function getKnownHeritageExpandedQueries(analysis) {
  const text = getAnalysisSearchText(analysis);
  const queries = [];
  KNOWN_HERITAGE_SEEDS.forEach(seed => {
    const exact = seed.aliases.some(alias => includesNormalized(text, alias));
    const visualHits = seed.visualKeywords.filter(keyword => includesNormalized(text, keyword)).length;
    if (exact || visualHits >= 2 || isCheomseongdaeVisualMatch(seed, text)) {
      queries.push(seed.name);
      queries.push(...seed.aliases.slice(0, 2));
    }
  });
  return queries;
}

function getKnownHeritageMatches(analysis, context) {
  const text = getAnalysisSearchText(analysis);
  return KNOWN_HERITAGE_SEEDS
    .map(seed => {
      const aliasHit = seed.aliases.some(alias => includesNormalized(text, alias));
      const visualHits = seed.visualKeywords.filter(keyword => includesNormalized(text, keyword)).length;
      const cheomseongdaeShapeHit = isCheomseongdaeVisualMatch(seed, text);
      if (!aliasHit && visualHits < 2 && !cheomseongdaeShapeHit) return null;
      const distKm = context.lat !== null && context.lng !== null
        ? getDistKm(context.lat, context.lng, seed.lat, seed.lng)
        : null;
      return {
        key: normalizeName(seed.name),
        id: `known:${seed.id}`,
        contentId: '',
        name: seed.name,
        query: seed.name,
        type: seed.type || '문화재',
        address: seed.address || '',
        lat: seed.lat,
        lng: seed.lng,
        distKm,
        imageUrl: '',
        description: seed.description,
        source: 'known',
        sourceLabel: '대표 문화재 보정 후보',
        placeUrl: getVisitKoreaSearchUrl(seed.name),
        score: 118 + (aliasHit ? 30 : 0) + visualHits * 10 + (cheomseongdaeShapeHit ? 24 : 0) + getDistanceScore(distKm),
        confidence: aliasHit ? 0.82 : cheomseongdaeShapeHit ? 0.74 : 0.66
      };
    })
    .filter(Boolean);
}

function isCheomseongdaeVisualMatch(seed, text) {
  if (seed.id !== 'cheomseongdae') return false;
  const stone = /석조|돌|stone|masonry|brick|granite/i.test(text);
  const tower = /탑|기둥|원통|병\s*모양|tower|cylindrical|column|barrel/i.test(text);
  const window = /창|구멍|window|opening|square/i.test(text);
  const observatory = /천문|관측|observatory|astronomical|astronomy/i.test(text);
  return observatory || stone && tower && window;
}

function getAnalysisSearchText(analysis) {
  return [
    analysis && analysis.summary,
    ...(analysis && analysis.visibleText || []),
    ...(analysis && analysis.visualTags || []),
    ...(analysis && analysis.queries || []),
    ...(analysis && analysis.candidates || []).flatMap(item => [item && item.name, item && item.reason])
  ].filter(Boolean).join(' ');
}

function includesNormalized(text, needle) {
  const haystack = normalizeName(text);
  const target = normalizeName(needle);
  return !!target && haystack.includes(target);
}

async function fetchKtoKeywordItems(keyword, serviceKey) {
  const requests = [12, 14].map(contentTypeId => {
    const url = new URL(`${KTO_BASE_URL}/searchKeyword2`);
    url.search = new URLSearchParams({
      serviceKey,
      MobileOS: 'ETC',
      MobileApp: 'Orotgil',
      _type: 'json',
      keyword,
      contentTypeId: String(contentTypeId),
      arrange: 'A',
      numOfRows: '8',
      pageNo: '1'
    }).toString();
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(response => response.text().then(text => ({ response, text })))
      .then(({ response, text }) => {
        if (!response.ok) throw new Error(`KTO failed with ${response.status}: ${text.slice(0, 120)}`);
        const parsed = JSON.parse(text);
        const header = parsed && parsed.response && parsed.response.header;
        if (header && header.resultCode && header.resultCode !== '0000') {
          throw new Error(`KTO returned ${header.resultCode}: ${header.resultMsg || ''}`);
        }
        return toArray(parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item);
      });
  });
  return (await Promise.all(requests)).flat();
}

async function fetchKtoDetail(contentId, serviceKey) {
  if (!contentId) return {};
  const url = new URL(`${KTO_BASE_URL}/detailCommon2`);
  url.search = new URLSearchParams({
    serviceKey,
    MobileOS: 'ETC',
    MobileApp: 'Orotgil',
    _type: 'json',
    contentId,
    defaultYN: 'Y',
    firstImageYN: 'Y',
    addrinfoYN: 'Y',
    mapinfoYN: 'Y',
    overviewYN: 'Y'
  }).toString();
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`KTO detail failed with ${response.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  return toArray(parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item)[0] || {};
}

async function enrichKtoCandidateDetails(candidates, serviceKey) {
  if (!serviceKey) return candidates;
  const targets = candidates
    .filter(candidate => candidate.contentId && candidate.source.includes('kto'))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  await Promise.all(targets.map(async candidate => {
    const detail = await fetchKtoDetail(candidate.contentId, serviceKey).catch(() => ({}));
    const overview = cleanOverview(detail.overview || '');
    if (overview && overview.length > candidate.description.length) candidate.description = overview;
    candidate.imageUrl = cleanUrl(candidate.imageUrl || detail.firstimage || detail.firstimage2 || '');
    candidate.address = cleanText(candidate.address || detail.addr1 || detail.addr2 || '', 120);
    candidate.lat = clampOptionalNumber(candidate.lat ?? detail.mapy, -90, 90);
    candidate.lng = clampOptionalNumber(candidate.lng ?? detail.mapx, -180, 180);
  }));
  return candidates;
}

async function fetchChaHeritageItems(keyword, serviceKey, rows) {
  const url = new URL(CHA_HERITAGE_URL);
  url.search = new URLSearchParams({
    serviceKey,
    keyword,
    numOfRows: String(rows),
    pageNo: '1'
  }).toString();
  const response = await fetch(url, { headers: { Accept: 'application/json, application/xml;q=0.9, */*;q=0.8' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`CHA failed with ${response.status}: ${text.slice(0, 120)}`);
  const header = parseChaHeader(text);
  if (header.resultCode && !['0000', '00', '0'].includes(String(header.resultCode))) {
    throw new Error(`CHA returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  return parseChaItems(text);
}

function normalizeKtoCandidate(item, query, baseScore, context) {
  const name = cleanText(item && item.title, 100);
  if (!name) return null;
  const lat = clampOptionalNumber(item.mapy, -90, 90);
  const lng = clampOptionalNumber(item.mapx, -180, 180);
  const distKm = lat !== null && lng !== null && context.lat !== null && context.lng !== null
    ? getDistKm(context.lat, context.lng, lat, lng)
    : null;
  const score = baseScore
    + getNameMatchScore(name, query)
    + (lat !== null && lng !== null ? 16 : 0)
    + getDistanceScore(distKm);
  return {
    key: normalizeName(name),
    id: cleanText(item.contentid, 60),
    contentId: cleanText(item.contentid, 60),
    name,
    query: cleanText(query, 80),
    type: item.contenttypeid === '14' ? '문화시설' : '관광지',
    address: cleanText([item.addr1, item.addr2].filter(Boolean).join(' '), 120),
    lat,
    lng,
    distKm,
    imageUrl: cleanUrl(item.firstimage || item.firstimage2 || ''),
    description: '',
    source: 'kto',
    sourceLabel: '한국관광공사 국문 관광정보',
    placeUrl: getVisitKoreaSearchUrl(name),
    score,
    confidence: 0.54
  };
}

function normalizeChaCandidate(item, query, baseScore) {
  const name = cleanText(item.title || item.alternativeTitle || item.sourceTitle, 100);
  if (!name) return null;
  const description = cleanOverview(item.description || item.subjectKeyword || item.subjectCategory || '');
  return {
    key: normalizeName(name),
    id: cleanText(item.uci || item.regDate || name, 90),
    contentId: '',
    name,
    query: cleanText(query, 80),
    type: '문화재',
    address: cleanText(item.spatial || item.spatialCoverage || '', 120),
    lat: null,
    lng: null,
    distKm: null,
    imageUrl: '',
    description,
    source: 'cha',
    sourceLabel: '문화재청 문화재정보',
    placeUrl: getVisitKoreaSearchUrl(name),
    score: baseScore + 18 + getNameMatchScore(name, query),
    confidence: 0.58
  };
}

function addCandidate(bucket, candidate) {
  if (!candidate || !candidate.key) return;
  const bucketKey = getCandidateBucketKey(bucket, candidate);
  candidate.key = bucketKey;
  const existing = bucket.get(bucketKey);
  if (!existing) {
    bucket.set(bucketKey, candidate);
    return;
  }
  const existingDescription = String(existing.description || '');
  const candidateDescription = String(candidate.description || '');
  existing.score = Math.max(existing.score, candidate.score) + 6;
  existing.name = chooseBetterCandidateName(existing.name, candidate.name);
  existing.contentId = existing.contentId || candidate.contentId;
  existing.lat = existing.lat ?? candidate.lat ?? null;
  existing.lng = existing.lng ?? candidate.lng ?? null;
  if (isFiniteNumber(candidate.distKm) && (!isFiniteNumber(existing.distKm) || Number(candidate.distKm) < Number(existing.distKm))) {
    existing.distKm = candidate.distKm;
  }
  existing.address = existing.address || candidate.address;
  existing.imageUrl = existing.imageUrl || candidate.imageUrl;
  if (candidateDescription && candidateDescription.length > existingDescription.length) {
    existing.description = candidate.description;
  }
  if (!existing.source.includes(candidate.source)) existing.source += `+${candidate.source}`;
  existing.sourceLabel = mergeSourceLabels(existing.sourceLabel, candidate.sourceLabel);
  existing.confidence = Math.max(existing.confidence || 0, candidate.confidence || 0);
}

function getCandidateBucketKey(bucket, candidate) {
  const key = getCanonicalCandidateKey(candidate) || candidate.key;
  if (key && bucket.has(key)) return key;
  for (const [existingKey, existing] of bucket.entries()) {
    if (areDuplicateHeritageCandidates(existing, candidate)) return existingKey;
  }
  return key || candidate.key;
}

function getCanonicalCandidateKey(candidate) {
  const name = candidate && candidate.name;
  const knownName = getKnownHeritageCanonicalName(name) || getKnownHeritageCanonicalName(candidate && candidate.query);
  if (knownName) return normalizeName(knownName);

  const key = normalizeName(name);
  if (!key) return '';
  const compactKey = stripCommonHeritageQualifiers(key);
  const regionlessKey = stripLeadingHeritageRegion(compactKey);
  if (isStrongSpecificHeritageKey(regionlessKey)) return regionlessKey;
  return compactKey || key;
}

function areDuplicateHeritageCandidates(a, b) {
  if (!a || !b) return false;
  if (a.contentId && b.contentId && String(a.contentId) === String(b.contentId)) return true;

  const aKnown = getKnownHeritageCanonicalName(a.name) || getKnownHeritageCanonicalName(a.query);
  const bKnown = getKnownHeritageCanonicalName(b.name) || getKnownHeritageCanonicalName(b.query);
  if (aKnown && bKnown && normalizeName(aKnown) === normalizeName(bKnown)) return true;

  if (areEquivalentHeritageNames(a.name, b.name)) return true;

  const distKm = getCandidatePairDistanceKm(a, b);
  if (distKm !== null && distKm <= 0.25 && areLooseHeritageNameVariants(a.name, b.name)) return true;
  return false;
}

function dedupePublicCandidates(candidates) {
  const bucket = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach(candidate => {
    if (!candidate || !candidate.name) return;
    const key = getCanonicalCandidateKey(candidate) || normalizeName(candidate.name);
    const existingKey = Array.from(bucket.keys()).find(currentKey => (
      currentKey === key || areDuplicateHeritageCandidates(bucket.get(currentKey), candidate)
    ));
    if (!existingKey) {
      bucket.set(key, { ...candidate });
      return;
    }
    const existing = bucket.get(existingKey);
    existing.name = chooseBetterCandidateName(existing.name, candidate.name);
    existing.contentId = existing.contentId || candidate.contentId;
    existing.lat = existing.lat ?? candidate.lat ?? null;
    existing.lng = existing.lng ?? candidate.lng ?? null;
    if (isFiniteNumber(candidate.distKm) && (!isFiniteNumber(existing.distKm) || Number(candidate.distKm) < Number(existing.distKm))) {
      existing.distKm = candidate.distKm;
    }
    existing.address = existing.address || candidate.address;
    existing.imageUrl = existing.imageUrl || candidate.imageUrl;
    if (candidate.description && String(candidate.description).length > String(existing.description || '').length) {
      existing.description = candidate.description;
    }
    if (!String(existing.source || '').includes(candidate.source)) {
      existing.source = [existing.source, candidate.source].filter(Boolean).join('+');
    }
    existing.sourceLabel = mergeSourceLabels(existing.sourceLabel, candidate.sourceLabel);
    existing.confidence = Math.max(existing.confidence || 0, candidate.confidence || 0);
  });
  return Array.from(bucket.values());
}

function mergeSourceLabels(...labels) {
  const values = labels
    .flatMap(label => String(label || '').split(' · '))
    .map(label => label.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join(' · ');
}

function chooseBetterCandidateName(existingName, candidateName) {
  const existing = cleanText(existingName, 100);
  const candidate = cleanText(candidateName, 100);
  if (!existing) return candidate;
  if (!candidate) return existing;

  const existingKnown = getKnownHeritageCanonicalName(existing);
  const candidateKnown = getKnownHeritageCanonicalName(candidate);
  if (candidateKnown && normalizeName(existing) !== normalizeName(candidateKnown)) return candidateKnown;
  if (existingKnown) return existingKnown;

  const existingKey = normalizeName(existing);
  const candidateKey = normalizeName(candidate);
  if (isStrongSpecificHeritageKey(candidateKey) && existingKey.includes(candidateKey)) return candidate;
  if (isStrongSpecificHeritageKey(existingKey) && candidateKey.includes(existingKey)) return existing;
  return existing.length <= candidate.length ? existing : candidate;
}

function getKnownHeritageCanonicalName(value) {
  const key = normalizeName(value);
  if (!key) return '';
  for (const seed of KNOWN_HERITAGE_SEEDS) {
    const seedKeys = [seed.name, ...(seed.dedupeAliases || [])]
      .map(normalizeName)
      .filter(Boolean);
    if (seedKeys.some(seedKey => areComparableHeritageKeys(key, seedKey))) return seed.name;
  }
  return '';
}

function areEquivalentHeritageNames(a, b) {
  const aKnown = getKnownHeritageCanonicalName(a);
  const bKnown = getKnownHeritageCanonicalName(b);
  if (aKnown && bKnown) return normalizeName(aKnown) === normalizeName(bKnown);

  const aKey = stripCommonHeritageQualifiers(normalizeName(a));
  const bKey = stripCommonHeritageQualifiers(normalizeName(b));
  if (!aKey || !bKey) return false;
  return areComparableHeritageKeys(aKey, bKey);
}

function areLooseHeritageNameVariants(a, b) {
  const aKey = stripLeadingHeritageRegion(stripCommonHeritageQualifiers(normalizeName(a)));
  const bKey = stripLeadingHeritageRegion(stripCommonHeritageQualifiers(normalizeName(b)));
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;
  return isStrongSpecificHeritageKey(aKey) && bKey.includes(aKey)
    || isStrongSpecificHeritageKey(bKey) && aKey.includes(bKey);
}

function areComparableHeritageKeys(a, b) {
  const aKey = stripCommonHeritageQualifiers(a);
  const bKey = stripCommonHeritageQualifiers(b);
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;

  const aRegionless = stripLeadingHeritageRegion(aKey);
  const bRegionless = stripLeadingHeritageRegion(bKey);
  if (aRegionless && bRegionless && aRegionless === bRegionless && isStrongSpecificHeritageKey(aRegionless)) {
    return true;
  }

  const shorter = aKey.length <= bKey.length ? aKey : bKey;
  const longer = aKey.length <= bKey.length ? bKey : aKey;
  return isStrongSpecificHeritageKey(shorter) && longer.includes(shorter);
}

function stripCommonHeritageQualifiers(value) {
  let key = normalizeName(value);
  [
    '유네스코세계문화유산',
    '유네스코세계유산',
    '세계문화유산',
    '세계유산',
    '국가지정문화재',
    '사적',
    '보물'
  ].forEach(token => {
    key = key.replace(new RegExp(normalizeName(token), 'g'), '');
  });
  return key;
}

function stripLeadingHeritageRegion(value) {
  let key = normalizeName(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of HERITAGE_REGION_PREFIXES) {
      if (key.startsWith(prefix) && key.length - prefix.length >= 3) {
        key = key.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }
  return key;
}

function isStrongSpecificHeritageKey(key) {
  const normalized = normalizeName(key);
  return normalized.length >= 3 && !GENERIC_HERITAGE_NAME_KEYS.has(normalized);
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function getCandidatePairDistanceKm(a, b) {
  const aLat = Number(a.lat);
  const aLng = Number(a.lng);
  const bLat = Number(b.lat);
  const bLng = Number(b.lng);
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return null;
  return getDistKm(aLat, aLng, bLat, bLng);
}

function toPublicCandidate(candidate, context) {
  const distKm = candidate.distKm ?? (
    candidate.lat !== null && candidate.lng !== null && context.lat !== null && context.lng !== null
      ? getDistKm(context.lat, context.lng, candidate.lat, candidate.lng)
      : null
  );
  return {
    id: candidate.id,
    contentId: candidate.contentId,
    name: candidate.name,
    type: candidate.type || '문화재',
    address: candidate.address,
    lat: candidate.lat,
    lng: candidate.lng,
    distKm,
    imageUrl: candidate.imageUrl,
    description: cleanOverview(candidate.description),
    source: candidate.source,
    sourceLabel: candidate.sourceLabel || '문화데이터',
    placeUrl: candidate.placeUrl || getVisitKoreaSearchUrl(candidate.name),
    confidence: Math.min(0.92, Math.max(candidate.confidence || 0.45, candidate.score / 160))
  };
}

function mergeAiFallbackCandidates(candidates, analysis) {
  const list = dedupePublicCandidates(Array.isArray(candidates) ? candidates.slice() : []);
  (analysis.candidates || []).forEach(item => {
    const name = cleanText(item && item.name, 80);
    const key = normalizeName(name);
    if (!key || list.some(candidate => areDuplicateHeritageCandidates(candidate, { name })) || list.length >= 3) return;
    list.push({
      id: `ai:${key}`,
      contentId: '',
      name,
      type: '문화재',
      address: '',
      lat: null,
      lng: null,
      distKm: null,
      imageUrl: '',
      description: cleanOverview(item.reason || analysis.summary || ''),
      source: 'ai',
      sourceLabel: 'AI 추정',
      placeUrl: getVisitKoreaSearchUrl(name),
      confidence: clampNumber(item.confidence, 0.2, 0.7, 0.36)
    });
  });
  return dedupePublicCandidates(list);
}

function normalizeAiAnalysis(raw) {
  const candidates = toArray(raw && raw.candidates)
    .map(item => ({
      name: cleanText(item && item.name, 80),
      reason: cleanText(item && item.reason, 180),
      confidence: clampNumber(item && item.confidence, 0, 1, 0.35)
    }))
    .filter(item => item.name);
  const visibleText = toArray(raw && raw.visibleText).map(item => cleanText(item, 60)).filter(Boolean).slice(0, 6);
  const visualTags = toArray(raw && raw.visualTags).map(item => cleanText(item, 30)).filter(Boolean).slice(0, 8);
  const queries = toArray(raw && raw.queries)
    .concat(candidates.map(item => item.name))
    .concat(visibleText)
    .map(cleanSearchQuery)
    .filter(Boolean)
    .slice(0, 8);
  return {
    summary: cleanText(raw && (raw.summary || raw.caption), 180) || '사진 속 문화재 단서를 확인했어요.',
    visibleText,
    visualTags,
    queries,
    candidates
  };
}

function cleanImageDataUrl(value) {
  const dataUrl = String(value || '').trim();
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return '';
  if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)) return '';
  return dataUrl.replace(/\s+/g, '');
}

function cleanSearchQuery(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s._~+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^0-9a-z가-힣]/gi, '')
    .trim();
}

function getNameMatchScore(name, query) {
  const a = normalizeName(name);
  const b = normalizeName(query);
  if (!a || !b) return 0;
  if (a === b) return 34;
  if (a.includes(b) || b.includes(a)) return 22;
  return 0;
}

function getDistanceScore(distKm) {
  const d = Number(distKm);
  if (!Number.isFinite(d)) return 0;
  if (d <= 1) return 18;
  if (d <= 3) return 12;
  if (d <= 8) return 6;
  return 0;
}

function getVisitKoreaSearchUrl(name) {
  return 'https://korean.visitkorea.or.kr/search/search_list.do?keyword=' + encodeURIComponent(String(name || '').trim());
}

function getServiceKey(names) {
  for (const name of names) {
    const key = String(process.env[name] || '').trim();
    if (!key) continue;
    try {
      return key.includes('%') ? decodeURIComponent(key) : key;
    } catch (_) {
      return key;
    }
  }
  return '';
}

function parseChaItems(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return toArray(extractJsonItems(JSON.parse(trimmed))); } catch (_) {}
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

function parseXmlItems(xml) {
  const items = [];
  const matches = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  matches.forEach(block => {
    const item = {};
    const tagMatches = block.match(/<([A-Za-z0-9_:.-]+)>([\s\S]*?)<\/\1>/g) || [];
    tagMatches.forEach(fragment => {
      const match = fragment.match(/^<([A-Za-z0-9_:.-]+)>([\s\S]*?)<\/\1>$/);
      if (!match) return;
      const key = match[1].split(':').pop();
      item[key] = decodeXml(match[2].replace(/<[^>]+>/g, ' '));
    });
    if (Object.keys(item).length) items.push(item);
  });
  return items;
}

function parseChaHeader(text) {
  const resultCode = extractXmlTag(text, 'resultCode') || extractJsonHeader(text, 'resultCode');
  const resultMsg = extractXmlTag(text, 'resultMsg') || extractJsonHeader(text, 'resultMsg');
  return { resultCode, resultMsg };
}

function extractJsonHeader(text, key) {
  try {
    const parsed = JSON.parse(String(text || ''));
    const header = parsed && parsed.response && parsed.response.header || parsed && parsed.header || {};
    return header && header[key] ? String(header[key]) : '';
  } catch (_) {
    return '';
  }
}

function extractXmlTag(text, tag) {
  const match = String(text || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
  const rawIp = forwarded || getHeader(req, 'x-real-ip') || req.socket && req.socket.remoteAddress || 'unknown';
  return String(rawIp).split(',')[0].trim().replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, 80) || 'unknown';
}

function getHeader(req, name) {
  const value = req.headers && req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function pruneRateBuckets(now) {
  if (rateBuckets.size <= 500) return;
  for (const [key, bucket] of rateBuckets.entries()) {
    if (!bucket || now - bucket.lastSeen > RATE_LIMIT_DAY_MS) rateBuckets.delete(key);
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
    try { return JSON.parse(match[0]); } catch (_) { return {}; }
  }
}

function clampOptionalNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
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

function cleanOverview(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 520);
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
  const dLat = (Number(lat2) - Number(lat1)) * Math.PI / 180;
  const dLng = (Number(lng2) - Number(lng1)) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(Number(lat1) * Math.PI / 180) * Math.cos(Number(lat2) * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
