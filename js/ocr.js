// OCR 引擎：云端 AI 视觉（OpenAI 兼容接口）为主，本地 Tesseract.js 兜底。
// - 云端：准确度最高，能理解"只提取题目、忽略答案"，但需要你提供 API Key（仅存本机）。
// - 本地：完全离线、免费、零隐私泄露，但中文+公式识别一般，且无法自动排除答案。

let tesseractLoading = null;

export function getOcrConfig() {
  try {
    return JSON.parse(localStorage.getItem('cb_ocr') || '{}');
  } catch {
    return {};
  }
}

export function saveOcrConfig(cfg) {
  localStorage.setItem('cb_ocr', JSON.stringify(cfg));
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('本地识别组件加载失败，请检查网络后重试'));
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

// dataUrls: 图片 dataURL 数组；mode: 'question' 只识别题目忽略答案 | 'all' 识别全部文字
// onStatus: 进度回调(字符串)
// 返回 { text, engine }
export async function ocrImage(dataUrls, mode = 'all', onStatus) {
  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const cfg = getOcrConfig();
  const provider = cfg.provider || 'auto';

  if (provider !== 'local' && cfg.apiKey) {
    try {
      const t = await cloudOcr(urls, mode, cfg, onStatus);
      return { text: t, engine: 'cloud' };
    } catch (e) {
      if (provider === 'cloud') throw e; // 明确只用云端却失败，直接抛出
      console.warn('云端识别失败，降级本地：', e);
    }
  }
  const t = await localOcr(urls[0], onStatus);
  return { text: t, engine: 'local' };
}

async function cloudOcr(urls, mode, cfg, onStatus) {
  const endpoint = (cfg.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = cfg.model || 'gpt-4o-mini';
  const prompt =
    mode === 'question'
      ? '这是一道题目的图片，可能同时包含"题目"和"答案"。请只提取"题干/题目"部分的文字，不要包含任何答案、解析或解题过程；如果图片里既有题目又有答案，仅输出题目部分。直接输出提取的文字，不要加解释，不要使用 markdown 代码块。'
      : '请识别这张图片中的全部文字，保持原有顺序，直接输出识别结果，不要加解释。';
  const content = [{ type: 'text', text: prompt }];
  urls.forEach((u) => content.push({ type: 'image_url', image_url: { url: u } }));

  if (onStatus) onStatus('云端 AI 识别中…');
  const res = await fetch(endpoint + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 2000 }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('云端识别失败(' + res.status + ')：' + t.slice(0, 160));
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content || '').trim();
}

async function localOcr(dataUrl, onStatus) {
  if (onStatus) onStatus('本地识别中（首次较慢，需下载组件）…');
  const T = await loadTesseract();
  const out = await T.recognize(dataUrl, 'chi_sim+eng', { logger: () => {} });
  return (out.data.text || '').trim();
}

// 判断学生答案与正确答案是否等价（云端 AI 辅助；无 Key 时返回 null 表示无法自动判定）
export async function judgeEquivalent(student, correct, question, onStatus) {
  const cfg = getOcrConfig();
  if (!cfg.apiKey) return null;
  const endpoint = (cfg.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = cfg.model || 'gpt-4o-mini';
  const prompt = `题目：${question || '（无题目文字）'}\n正确答案：${correct}\n学生的作答：${student}\n请严格判断学生的作答是否正确（与正确答案等价或一致）。只回答"正确"或"错误"，不要任何解释。`;
  if (onStatus) onStatus('AI 判分中…');
  try {
    const res = await fetch(endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 16 }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const txt = (json.choices?.[0]?.message?.content || '').trim();
    if (/正确/.test(txt) && !/错误/.test(txt)) return true;
    if (/错误/.test(txt)) return false;
    return null;
  } catch {
    return null;
  }
}
