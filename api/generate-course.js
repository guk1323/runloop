const DEFAULT_MODEL = 'gpt-5-mini';
const TAG_CLASS = {
  safe: 'tg',
  flat: 'tb',
  park: 'tg',
  river: 'tb',
  night: 'tg',
  quiet: 'tg',
  slope: 'ta',
  busy: 'ta',
  view: 'tb'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  try {
    const body = parseRequestBody(req.body);
    const km = clampNumber(body.km, 1, 20, 5);
    const lat = clampNumber(body.lat, -90, 90, 37.5503);
    const lng = clampNumber(body.lng, -180, 180, 126.92);
    const weather = cleanText(body.weather, 120) || '날씨 정보 없음';
    const preference = cleanText(body.preference, 80) || '조용하고 안전한 길';
    const place = cleanText(body.place, 80) || '현재 위치 주변';
    const savedCourseNames = Array.isArray(body.savedCourseNames)
      ? body.savedCourseNames.map(name => cleanText(name, 30)).filter(Boolean).slice(0, 6)
      : [];

    const result = await createOpenAiResponse(apiKey, {
      km,
      lat,
      lng,
      weather,
      preference,
      place,
      savedCourseNames
    });

    if (!result.ok) {
      console.error('OpenAI course generation failed', result.status, result.error);
      return res.status(502).json({ error: 'AI course generation failed' });
    }

    const text = extractOpenAiText(result.data);
    const parsed = parseJsonText(text);
    const rawCourses = Array.isArray(parsed.courses) ? parsed.courses : [];
    const courses = rawCourses.slice(0, 3).map((course, index) => normalizeCourse(course, index, km));

    if (courses.length === 0) {
      return res.status(502).json({ error: 'AI returned no usable courses' });
    }

    return res.status(200).json({ courses });
  } catch (error) {
    console.error('Runloop AI route error', error);
    return res.status(500).json({ error: 'Failed to generate courses' });
  }
}

async function createOpenAiResponse(apiKey, context) {
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
          'You create concise Korean running course recommendation cards for Runloop.',
          'Do not invent exact coordinates, turn-by-turn routes, businesses, safety guarantees, or live map data.',
          'Return valid JSON only. Keep names short, cute, and minimal.'
        ].join(' '),
        input: [
          `위치: ${context.place} (${context.lat.toFixed(5)}, ${context.lng.toFixed(5)})`,
          `목표 거리: ${context.km.toFixed(1)}km`,
          `날씨/상황: ${context.weather}`,
          `사용자 선호: ${context.preference}`,
          `이미 저장한 코스 이름: ${context.savedCourseNames.length ? context.savedCourseNames.join(', ') : '없음'}`,
          'JSON 형식: {"courses":[{"name":"이름","concept":"한 문장 컨셉","distanceKm":5.0,"paceMinPerKm":6.5,"tags":["안전","평지"],"safetyNote":"짧은 참고","mapStyle":"river|urban|park"}]}',
          'courses는 정확히 3개. distanceKm는 목표 거리의 ±10% 안. tags는 각 2~3개.'
        ].join('\n')
      })
    });

    const data = await aiRes.json().catch(() => ({}));
    if (aiRes.ok) return { ok: true, data, model };

    lastError = { model, status: aiRes.status, error: data && data.error };
    console.error('OpenAI model attempt failed', lastError);
    if (!shouldTryNextModel(aiRes.status, data && data.error)) break;
  }

  return { ok: false, status: lastError && lastError.status, error: lastError };
}

function getModelCandidates() {
  return [process.env.OPENAI_MODEL, DEFAULT_MODEL, 'gpt-4.1-mini']
    .map(model => String(model || '').trim())
    .filter(Boolean)
    .filter((model, index, arr) => arr.indexOf(model) === index);
}

function shouldTryNextModel(status, error) {
  const message = String((error && (error.message || error.code || error.type)) || '');
  return status === 400 || status === 404 || /model|not found|does not exist|access/i.test(message);
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
    try { return JSON.parse(match[0]); } catch (error) { return {}; }
  }
}

function normalizeCourse(course, index, targetKm) {
  if (!course || typeof course !== 'object') course = {};
  const styles = ['river', 'urban', 'park'];
  const colors = ['#F27A5E', '#D9654D', '#639922'];
  const distance = clampNumber(course.distanceKm, targetKm * 0.9, targetKm * 1.1, targetKm);
  const pace = clampNumber(course.paceMinPerKm, 5.5, 8.5, 6.5 + index * 0.2);
  const rawTags = Array.isArray(course.tags) ? course.tags : [];
  const tags = rawTags
    .map(normalizeTagLabel)
    .filter(Boolean)
    .slice(0, 3)
    .map(label => ({ l: label, c: getTagClass(label) }));
  while (tags.length < 2) {
    tags.push(index === 2 ? { l: '공원', c: 'tg' } : { l: '안전', c: 'tg' });
  }

  const mapStyle = styles.includes(course.mapStyle) ? course.mapStyle : inferMapStyle(tags, index);
  const concept = cleanText(course.concept, 45);
  const safetyNote = cleanText(course.safetyNote, 45);

  return {
    name: cleanText(course.name, 18) || `추천 코스 ${index + 1}`,
    km: distance.toFixed(1),
    pace,
    tags,
    meta: [concept, safetyNote].filter(Boolean).join(' · ') || '현재 조건에 맞춘 추천 코스',
    pt: mapStyle,
    color: colors[index] || colors[0],
    fromAi: true
  };
}

function normalizeTagLabel(tag) {
  if (typeof tag === 'string') return cleanText(tag, 8);
  if (tag && typeof tag === 'object') return cleanText(tag.l || tag.label || tag.name, 8);
  return '';
}

function getTagClass(label) {
  const value = String(label || '');
  if (/경사|언덕|혼잡|주의|차도/.test(value)) return TAG_CLASS.slope;
  if (/평지|강변|뷰|한강/.test(value)) return TAG_CLASS.flat;
  if (/공원|안전|야간|조용|산책/.test(value)) return TAG_CLASS.safe;
  return TAG_CLASS.safe;
}

function inferMapStyle(tags, index) {
  const text = tags.map(tag => tag.l).join(' ');
  if (/강변|한강|물/.test(text)) return 'river';
  if (/공원|산책/.test(text)) return 'park';
  return ['river', 'urban', 'park'][index] || 'urban';
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
