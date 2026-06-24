const KTO_BASE_URLS = {
  ko: 'https://apis.data.go.kr/B551011/KorService2',
  en: 'https://apis.data.go.kr/B551011/EngService2'
};
const KTO_KEY_ENV = {
  ko: 'KTO_SERVICE_KEY',
  en: 'KTO_EN_SERVICE_KEY'
};
const CHA_HERITAGE_URL = 'https://api.kcisa.kr/openapi/service/rest/meta/CHAheri';
const ALLOWED_ORIGINS = new Set([
  'https://runloop-jet.vercel.app',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'capacitor://localhost',
  'ionic://localhost'
]);
const RARE_HERITAGE_SEEDS = [
  { id: 'gyeongbokgung', name: '경복궁', nameEn: 'Gyeongbokgung Palace', lat: 37.579617, lng: 126.977041, region: '서울 종로구' },
  { id: 'changdeokgung', name: '창덕궁', nameEn: 'Changdeokgung Palace', lat: 37.579367, lng: 126.991057, region: '서울 종로구' },
  { id: 'jongmyo', name: '종묘', nameEn: 'Jongmyo Shrine', lat: 37.574641, lng: 126.994085, region: '서울 종로구' },
  { id: 'suwon-hwaseong', name: '수원화성', nameEn: 'Suwon Hwaseong Fortress', lat: 37.287889, lng: 127.011778, region: '경기 수원시' },
  { id: 'namhansanseong', name: '남한산성', nameEn: 'Namhansanseong Fortress', lat: 37.478566, lng: 127.181466, region: '경기 광주시' },
  { id: 'bulguksa', name: '불국사', nameEn: 'Bulguksa Temple', lat: 35.790014, lng: 129.331961, region: '경북 경주시' },
  { id: 'seokguram', name: '석굴암', nameEn: 'Seokguram Grotto', lat: 35.794951, lng: 129.349157, region: '경북 경주시' },
  { id: 'haeinsa', name: '해인사', nameEn: 'Haeinsa Temple', lat: 35.801479, lng: 128.098118, region: '경남 합천군' },
  { id: 'hahoe', name: '하회마을', nameEn: 'Hahoe Folk Village', lat: 36.539325, lng: 128.518318, region: '경북 안동시' },
  { id: 'yangdong', name: '양동마을', nameEn: 'Yangdong Folk Village', lat: 35.996636, lng: 129.253826, region: '경북 경주시' },
  { id: 'gongsanseong', name: '공산성', nameEn: 'Gongsanseong Fortress', lat: 36.462172, lng: 127.124834, region: '충남 공주시' },
  { id: 'busosanseong', name: '부소산성', nameEn: 'Busosanseong Fortress', lat: 36.28195, lng: 126.912244, region: '충남 부여군' },
  { id: 'mireuksa', name: '미륵사지', nameEn: 'Mireuksa Temple Site', lat: 36.012515, lng: 127.031354, region: '전북 익산시' },
  { id: 'wanggungri', name: '왕궁리유적', nameEn: 'Wanggung-ri Historic Site', lat: 35.972847, lng: 127.053673, region: '전북 익산시' }
];
const HERITAGE_SUBPLACE_PATTERN = /관리소|사무소|매표소|주차장|화장실|안내소|관광안내소|입구|출구|고객센터|센터$|분소|관리센터|office|ticket|parking|restroom|toilet|information|entrance|exit|management center/i;
const KTO_EXCLUDED_SUBPLACE_PATTERN = /관리소|사무소|매표소|주차장|화장실|입구|출구|고객센터|분소|관리센터|office|ticket|parking|restroom|toilet|entrance|exit|management center/i;

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
  if (!serviceKey) {
    return res.status(500).json({ error: `${KTO_KEY_ENV[lang]} is not configured` });
  }

  try {
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
      fetchKtoItems('locationBasedList2', { ...listParams, contentTypeId: 12 }, serviceKey, lang),
      fetchKtoItems('locationBasedList2', { ...listParams, contentTypeId: 14 }, serviceKey, lang)
    ]);

    let spots = mergeKtoItems(tourItems.concat(cultureItems), lat, lng)
      .map(item => normalizeKtoSpot(item, lat, lng, lang))
      .filter(Boolean)
      .sort((a, b) => {
        const distDiff = Number(a.distFromMe) - Number(b.distFromMe);
        if (distDiff) return distDiff;
        return Number(b.cultureValueStars) - Number(a.cultureValueStars);
      });

    spots = await enrichWithChaHeritage(spots, lat, lng, radius, lang);

    return res.status(200).json({ spots, lang });
  } catch (error) {
    console.error('KTO tour spot proxy failed', error);
    return res.status(400).json({ error: 'Invalid KTO tour spot request' });
  }
}

async function enrichWithChaHeritage(spots, userLat, userLng, radiusMeters, lang) {
  const serviceKey = getOptionalServiceKey([
    'CHA_HERITAGE_SERVICE_KEY',
    'CHA_SERVICE_KEY',
    'KCISA_CHA_HERITAGE_SERVICE_KEY'
  ]);
  if (!serviceKey) return spots;

  try {
    const verified = await verifyExistingHeritageSpots(spots, serviceKey, lang);
    const withSeeds = await appendVerifiedHeritageSeeds(verified, userLat, userLng, radiusMeters, serviceKey, lang);
    return withSeeds.sort((a, b) => {
      const distDiff = Number(a.distFromMe) - Number(b.distFromMe);
      if (distDiff) return distDiff;
      return Number(b.cultureValueStars) - Number(a.cultureValueStars);
    });
  } catch (error) {
    console.warn('CHA heritage enrichment skipped', error);
    return spots;
  }
}

async function verifyExistingHeritageSpots(spots, serviceKey, lang) {
  const candidates = spots
    .filter(isHeritageVerificationCandidate)
    .slice(0, 10);
  if (!candidates.length) return spots;

  const results = await Promise.all(candidates.map(async spot => {
    const keyword = getHeritageKeyword(spot);
    if (!keyword) return [getSpotStableKey(spot), null];
    const items = await fetchChaHeritageItems(keyword, serviceKey, 5).catch(() => []);
    return [getSpotStableKey(spot), findChaHeritageMatch(keyword, items)];
  }));
  const matches = new Map(results.filter(([, match]) => match));
  if (!matches.size) return spots;

  return spots.map(spot => {
    const match = matches.get(getSpotStableKey(spot));
    if (!match) return spot;
    return applyChaHeritageMatch(spot, match, lang);
  });
}

async function appendVerifiedHeritageSeeds(spots, userLat, userLng, radiusMeters, serviceKey, lang) {
  const existingNames = new Set(spots.map(spot => normalizeHeritageName(spot.place_name || spot.name)));
  const nearbySeeds = RARE_HERITAGE_SEEDS
    .map(seed => ({ ...seed, distFromMe: getDistKm(userLat, userLng, seed.lat, seed.lng) }))
    .filter(seed => seed.distFromMe * 1000 <= radiusMeters)
    .filter(seed => !existingNames.has(normalizeHeritageName(seed.name)))
    .slice(0, 6);
  if (!nearbySeeds.length) return spots;

  const additions = await Promise.all(nearbySeeds.map(async seed => {
    const items = await fetchChaHeritageItems(seed.name, serviceKey, 5).catch(() => []);
    const match = findChaHeritageMatch(seed.name, items);
    return match ? normalizeChaHeritageSeed(seed, match, lang) : null;
  }));

  return spots.concat(additions.filter(Boolean));
}

function isHeritageVerificationCandidate(spot) {
  const text = [spot.place_name, spot.name, spot.cultureType, spot.category_name].filter(Boolean).join(' ');
  if (HERITAGE_SUBPLACE_PATTERN.test(text)) return false;
  return Number(spot.cultureValueStars) >= 4 || /문화재|유산|역사|궁|왕릉|서원|향교|사찰|성곽|유적|Heritage|Historic|Palace|Fortress|Temple|Shrine/i.test(text);
}

function applyChaHeritageMatch(spot, match, lang) {
  const title = cleanText(match.title || match.alternativeTitle || '', 80);
  const stars = isRareHeritageMatch(spot, match)
    ? 5
    : Math.max(4, Math.round(Number(spot.cultureValueStars) || 4));
  const type = lang === 'en' ? 'Heritage' : '문화재';
  return {
    ...spot,
    source: spot.source === 'kto' ? 'kto+cha' : spot.source || 'cha',
    cultureType: type,
    cultureValueStars: stars,
    cultureValueLabel: lang === 'en'
      ? (stars >= 5 ? 'Verified rare heritage' : 'Verified heritage')
      : (stars >= 5 ? '공식 희귀 유산' : '공식 문화재'),
    category_name: [type, '문화재청'].filter(Boolean).join(' · '),
    heritage: {
      title,
      description: cleanText(match.description, 260),
      spatial: cleanText(match.spatial || match.spatialCoverage, 140),
      sourceTitle: cleanText(match.sourceTitle, 100),
      uci: cleanText(match.uci, 160)
    }
  };
}

function normalizeChaHeritageSeed(seed, match, lang) {
  const type = lang === 'en' ? 'Heritage' : '문화재';
  const title = cleanText(match.title || seed.name, 80);
  return {
    id: `cha:${seed.id}`,
    contentId: '',
    source: 'cha',
    place_name: seed.name,
    name: seed.name,
    nameEn: seed.nameEn,
    y: seed.lat,
    x: seed.lng,
    distFromMe: seed.distFromMe,
    cultureType: type,
    cultureValueStars: 5,
    cultureValueLabel: lang === 'en' ? 'Verified rare heritage' : '공식 희귀 유산',
    category_name: [type, '문화재청'].join(' · '),
    address_name: seed.region || cleanText(match.spatial || match.spatialCoverage, 140),
    firstImage: '',
    place_url: getVisitKoreaSearchUrl(lang === 'en' ? seed.nameEn : seed.name, lang),
    lang,
    heritage: {
      title,
      description: cleanText(match.description, 260),
      spatial: cleanText(match.spatial || match.spatialCoverage, 140),
      sourceTitle: cleanText(match.sourceTitle, 100),
      uci: cleanText(match.uci, 160)
    }
  };
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
  if (!response.ok) throw new Error(`CHA heritage failed with ${response.status}: ${text.slice(0, 120)}`);
  const header = parseChaHeader(text);
  if (header.resultCode && !['0000', '00', '0'].includes(String(header.resultCode))) {
    throw new Error(`CHA heritage returned ${header.resultCode}: ${header.resultMsg || ''}`);
  }
  return parseChaItems(text);
}

function findChaHeritageMatch(keyword, items) {
  const key = normalizeHeritageName(keyword);
  if (!key || HERITAGE_SUBPLACE_PATTERN.test(String(keyword || ''))) return null;
  return (Array.isArray(items) ? items : []).find(item => {
    const title = normalizeHeritageName([item.title, item.alternativeTitle].filter(Boolean).join(' '));
    const keywords = normalizeHeritageName([item.subjectKeyword, item.subjectCategory, item.description].filter(Boolean).join(' '));
    if (!title && !keywords) return false;
    if (title === key || title.includes(key) || key.includes(title) && title.length >= 3) return true;
    return keywords.includes(key);
  }) || null;
}

function isRareHeritageMatch(spot, match) {
  const text = [spot.place_name, spot.name, match && match.title, match && match.subjectKeyword, match && match.description].filter(Boolean).join(' ');
  return isFiveStarCultureTitle(text) || /세계문화유산|세계유산|유네스코|unesco|worldheritage/i.test(text.replace(/\s+/g, ''));
}

function getHeritageKeyword(spot) {
  const raw = String(spot && (spot.place_name || spot.name) || '');
  if (!raw || HERITAGE_SUBPLACE_PATTERN.test(raw)) return '';
  const compact = raw.replace(/\s+/g, '');
  const seed = RARE_HERITAGE_SEEDS.find(item => compact.includes(item.name));
  return seed ? seed.name : raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function getSpotStableKey(spot) {
  return String(spot && (spot.id || spot.contentId || `${spot.place_name}:${spot.y}:${spot.x}`) || '');
}

function normalizeHeritageName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()［\]\[\]{}·ㆍ,._\-]/g, '')
    .replace(/palace|fortress|temple|shrine|grotto|historicsite|folkvillage/g, '');
}

function parseChaItems(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return toArray(extractChaJsonItems(JSON.parse(trimmed)));
    } catch (_) {}
  }
  const matches = [...trimmed.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return matches.map(match => {
    const item = {};
    [...match[1].matchAll(/<([A-Za-z0-9_:-]+)>([\s\S]*?)<\/\1>/g)].forEach(([, key, value]) => {
      item[key.replace(/^[^:]+:/, '')] = decodeXml(value);
    });
    return item;
  });
}

function extractChaJsonItems(parsed) {
  return parsed && parsed.response && parsed.response.body && parsed.response.body.items && parsed.response.body.items.item
    || parsed && parsed.body && parsed.body.items && parsed.body.items.item
    || parsed && parsed.items && parsed.items.item
    || parsed && parsed.items
    || parsed && parsed.item
    || [];
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
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchKtoItems(operation, params, serviceKey, lang) {
  const url = new URL(`${KTO_BASE_URLS[lang] || KTO_BASE_URLS.ko}/${operation}`);
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

function normalizeKtoSpot(item, userLat, userLng, lang) {
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
  const value = getKtoCultureValue(item, title, lang);
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
    place_url: getVisitKoreaSearchUrl(title, lang),
    lang
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

function getKtoCultureValue(item, title, lang = 'ko') {
  const text = [title, item.addr1, item.cat1, item.cat2, item.cat3].filter(Boolean).join(' ');
  const contentTypeId = String(item.contenttypeid || '');
  const cat2 = String(item.cat2 || '');
  const cat3 = String(item.cat3 || '');
  const type = getKtoCultureType(item, title, lang);
  const label = makeCultureLabeler(lang);

  if (isTouristInfoPoint(text, cat3)) return { stars: 1, label: label('light'), type };
  if (isFiveStarCultureTitle(title, lang)) return { stars: 5, label: label('rare'), type };
  if (cat2 === 'A0201' || /궁|고궁|궁궐|왕릉|문화재|유적|사적|성곽|서원|향교|한옥|사찰|절|성당|근대문화유산|palace|royal|tomb|heritage|historic|fortress|shrine|temple|hanok|unesco/i.test(text)) {
    return { stars: 4, label: label('history'), type };
  }
  if (isMajorCultureVenue(text)) return { stars: 4, label: label('major'), type };
  if (isMuseumOrExhibitionVenue(text, cat3)) {
    return { stars: 3, label: label('facility'), type };
  }
  if (isPerformanceOrLocalVenue(text, cat3)) return { stars: 2, label: label('local'), type };
  if (isLightCulturePoint(text, cat3) || contentTypeId === '14') return { stars: 1, label: label('light'), type };
  return { excluded: true, stars: 0, label: label('excluded'), type };
}

function getKtoCultureType(item, title, lang = 'ko') {
  const text = [title, item.cat2, item.cat3].filter(Boolean).join(' ');
  const cat3 = String(item.cat3 || '');
  const en = lang === 'en';
  if (isTouristInfoPoint(text, cat3)) return en ? 'Culture point' : '문화 포인트';
  if (/A0201|궁|고궁|왕릉|문화재|유적|사적|성곽|서원|향교|한옥|사찰|절|성당|palace|royal|tomb|heritage|historic|fortress|shrine|temple|hanok|unesco/i.test(text)) return en ? 'Heritage' : '문화재';
  if (/박물관|기념관|museum|memorial/i.test(text) || ['A02060100', 'A02060200'].includes(cat3)) return en ? 'Museum' : '박물관';
  if (/미술관|갤러리|전시|gallery|exhibition|art museum/i.test(text) || ['A02060300', 'A02060500'].includes(cat3)) return en ? 'Exhibition' : '전시';
  if (/공연|극장|아트센터|문화예술회관|performance|theater|theatre|art center|arts center/i.test(text) || cat3 === 'A02060600') return en ? 'Performance' : '공연';
  if (/도서관|문화원|안내소|관광안내|조형물|기념비|동상|표지석|library|information|monument|statue|sculpture/i.test(text) || ['A02060700', 'A02060800', 'A02060900', 'A02061100'].includes(cat3)) {
    return en ? 'Culture point' : '문화 포인트';
  }
  return en ? 'Culture spot' : '문화 스팟';
}

function isExcludedKtoSpot(item, title) {
  const text = [title, item.addr1, item.addr2].filter(Boolean).join(' ');
  const cat3 = String(item.cat3 || '');
  if (KTO_EXCLUDED_SUBPLACE_PATTERN.test(text)) return true;
  if (/노래연습장|노래방|코인노래|karaoke|유흥|단란주점|주점|호프|펍|룸살롱|클럽|pc방|피시방|오락실/i.test(text)) return true;
  if (/CGV|롯데시네마|메가박스|씨네큐|백화점|쇼핑몰|마트|카페|식당|사설|교보문고|영풍문고|서점|bookstore/i.test(text)) return true;
  if (['A02061000', 'A02061200', 'A02061300', 'A02061400'].includes(cat3)) return true;
  return false;
}

function isMajorCultureVenue(text) {
  return /국립|국가|대한민국|예술의전당|세종문화회관|동대문디자인플라자|전쟁기념관|독립기념관|국립현대미술관|국립중앙박물관|national|seoul arts center|sejong center|war memorial|independence hall|ddp|leeum/i.test(text);
}

function isMuseumOrExhibitionVenue(text, cat3) {
  if (/갤러리|화랑|전시실|gallery/i.test(text) && !/미술관|박물관|art museum|museum/i.test(text)) return false;
  return /박물관|미술관|전시관|기념관|역사관|문학관|과학관|아카이브|museum|art museum|exhibition hall|memorial|history museum|archive/i.test(text)
    || ['A02060100', 'A02060200', 'A02060300'].includes(cat3)
    || (cat3 === 'A02060500' && /미술관|art museum/i.test(text));
}

function isPerformanceOrLocalVenue(text, cat3) {
  return /공연장|극장|아트센터|아트홀|문화예술회관|문화회관|문화센터|문화원|전수관|전수시설|체험관|콘서트홀|오페라|performance|theater|theatre|art center|arts center|concert hall|opera|culture center/i.test(text)
    || ['A02060600', 'A02060700', 'A02060800', 'A02061100'].includes(cat3);
}

function isLightCulturePoint(text, cat3) {
  return /도서관|작은도서관|갤러리|화랑|전시실|조형물|기념비|동상|표지석|비석|탑|문화의집|문화공간|library|gallery|exhibition room|monument|statue|sculpture|memorial stone|culture house/i.test(text)
    || ['A02060900', 'A02060500'].includes(cat3)
    || isTouristInfoPoint(text, cat3);
}

function isTouristInfoPoint(text, cat3) {
  return /관광안내소|안내소|관광안내|tourist information|information center/i.test(text);
}

function isFiveStarCultureTitle(title, lang = 'ko') {
  const compact = String(title || '').replace(/\s+/g, '');
  const lower = compact.toLowerCase();
  const exactNames = [
    '경복궁', '창덕궁', '종묘', '수원화성', '남한산성',
    '불국사', '석굴암', '해인사', '하회마을', '양동마을',
    '공산성', '부소산성', '미륵사지', '왕궁리유적'
  ];
  const enNames = [
    'gyeongbokgungpalace', 'changdeokgungpalace', 'jongmyoshrine',
    'suwonhwaseongfortress', 'namhansanseongfortress', 'bulguksatemple',
    'seokguramgrotto', 'haeinsatemple', 'hahoevillage', 'yangdongvillage',
    'gongsanseongfortress', 'busosanseongfortress', 'mireuksajitemplesite',
    'wanggungrihistoricsite'
  ];
  if (exactNames.some(name => compact === name)) return true;
  if (lang === 'en' && enNames.some(name => lower.includes(name))) return true;
  return /세계문화유산|세계유산|유네스코|unesco|worldheritage/i.test(compact);
}

function makeCultureLabeler(lang) {
  const labels = lang === 'en'
    ? {
        rare: 'World heritage',
        history: 'Historic site',
        major: 'Major culture venue',
        facility: 'Culture venue',
        local: 'Local culture',
        light: 'Light culture point',
        excluded: 'Excluded'
      }
    : {
        rare: '희귀 유산',
        history: '역사 명소',
        major: '대표 문화시설',
        facility: '문화시설',
        local: '지역 문화',
        light: '문화 포인트',
        excluded: '추천 제외'
      };
  return key => labels[key] || labels.local;
}

function buildKtoCategoryLabel(item, fallback) {
  return [fallback, item.contenttypeid ? `관광공사 ${item.contenttypeid}` : '']
    .filter(Boolean)
    .join(' · ');
}

function getVisitKoreaSearchUrl(title, lang = 'ko') {
  if (lang === 'en') {
    return 'https://www.google.com/search?q=' + encodeURIComponent(`site:english.visitkorea.or.kr/svc/contents/contentsView.do ${title}`);
  }
  const base = 'https://korean.visitkorea.or.kr/search/search_list.do?keyword=';
  return base + encodeURIComponent(title);
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

function getOptionalServiceKey(names) {
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
