import * as DB from './db.js';
import * as C from './config.js';
import * as OCR from './ocr.js';

const TITLES = { input: '录入错题', list: '错题本', analysis: '分析', review: '复习重做', me: '我的' };
let DATA = [];
let editingId = null;

// 三处图片：题目图片 / 错答图片 / 正确答案图片
let pendingPhotos = [];
let pendingWrongImages = [];
let pendingCorrectImages = [];

// ---------- 初始化 ----------
async function init() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  fillSelect('in-subject', C.SUBJECTS);
  fillSelect('in-grade', C.GRADES, currentGrade());
  fillSelect('in-source', C.SOURCES);
  fillSelect('in-type', C.TYPES);
  fillSelect('in-reason', C.REASONS);
  fillSelect('in-diff', C.DIFFICULTIES);
  fillSelect('me-grade', C.GRADES, currentGrade());
  fillSelect('f-subject', ['全部', ...C.SUBJECTS]);
  fillSelect('f-grade', ['全部', ...C.GRADES]);
  fillSelect('f-status', ['全部', ...Object.values(C.STATUS_LABEL)]);
  updateKpList();
  loadOcrSettings();
  bindEvents();
  initVoiceInput();
  await refresh();
  goView('input');
}

function currentGrade() {
  return localStorage.getItem('cb_grade') || '初一';
}

function fillSelect(id, opts, selected) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  opts.forEach((o) => {
    const op = document.createElement('option');
    op.value = o; op.textContent = o;
    if (o === selected) op.selected = true;
    el.appendChild(op);
  });
}

function updateKpList() {
  const subj = document.getElementById('in-subject').value;
  const list = document.getElementById('kp-list');
  list.innerHTML = '';
  (C.KNOWLEDGE_TREE[subj] || []).forEach((k) => {
    const o = document.createElement('option');
    o.value = k; list.appendChild(o);
  });
}

// ---------- 录入：图片与识别 ----------
function bindEvents() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => goView(t.dataset.view)));

  document.getElementById('in-subject').addEventListener('change', updateKpList);

  document.getElementById('in-photos').addEventListener('change', (e) => handlePhotoInput(e, pendingPhotos, renderQuestionThumbs));
  document.getElementById('in-wrong-photos').addEventListener('change', (e) => handlePhotoInput(e, pendingWrongImages, renderWrongThumbs));
  document.getElementById('in-correct-photos').addEventListener('change', (e) => handlePhotoInput(e, pendingCorrectImages, renderCorrectThumbs));

  document.getElementById('btn-ocr-question').addEventListener('click', doOcrQuestion);
  document.getElementById('btn-ocr-wrong').addEventListener('click', doOcrWrong);
  document.getElementById('btn-ocr-correct').addEventListener('click', doOcrCorrect);

  document.getElementById('btn-save').addEventListener('click', saveMistake);

  ['f-subject', 'f-grade', 'f-status'].forEach((id) =>
    document.getElementById(id).addEventListener('change', renderList));

  document.getElementById('me-grade').addEventListener('change', (e) => {
    localStorage.setItem('cb_grade', e.target.value);
    document.getElementById('in-grade').value = e.target.value;
  });

  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', importBackup);
  document.getElementById('btn-clear').addEventListener('click', clearData);

  document.getElementById('btn-ocr-save').addEventListener('click', saveOcrSettings);
  document.getElementById('btn-ocr-test').addEventListener('click', () => document.getElementById('ocr-test-input').click());
  document.getElementById('ocr-test-input').addEventListener('change', testOcr);

  // 复习页拍照识别
  document.getElementById('rv-cam-input').addEventListener('change', onReviewCamera);

  // 点击可放大图片
  document.addEventListener('click', (e) => {
    const z = e.target.closest('.zoomable');
    if (z) { openLightbox(z.src); }
    if (e.target.id === 'lightbox') closeLightbox();
  });

  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal' || e.target.classList.contains('close-x')) closeModal('modal');
  });
  document.getElementById('review-modal').addEventListener('click', (e) => {
    if (e.target.id === 'review-modal' || e.target.classList.contains('close-x')) closeModal('review-modal');
  });
}

// 通用：把图片文件压入数组并渲染缩略图
async function handlePhotoInput(e, arr, render) {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    const dataUrl = await C.compressImage(f, 1200, 0.8);
    arr.push(dataUrl);
  }
  e.target.value = '';
  render();
}

// 通用缩略图渲染（带删除 + 点击放大）
function renderImgThumbs(boxId, arr, onChange) {
  const box = document.getElementById(boxId);
  box.innerHTML = '';
  arr.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    wrap.innerHTML = `<img class="zoomable" src="${src}"><button class="del" data-i="${i}">×</button>`;
    wrap.querySelector('.del').addEventListener('click', (ev) => {
      ev.stopPropagation();
      arr.splice(i, 1);
      onChange();
    });
    box.appendChild(wrap);
  });
}
function renderQuestionThumbs() { renderImgThumbs('in-thumbs', pendingPhotos, renderQuestionThumbs); }
function renderWrongThumbs() { renderImgThumbs('in-wrong-thumbs', pendingWrongImages, renderWrongThumbs); }
function renderCorrectThumbs() { renderImgThumbs('in-correct-thumbs', pendingCorrectImages, renderCorrectThumbs); }

async function doOcrQuestion() {
  if (!pendingPhotos.length) return tip('请先上传题目图片');
  try {
    const { text, engine } = await OCR.ocrImage(pendingPhotos, 'question', showToast);
    document.getElementById('in-question').value = text;
    showToast(`题目已识别（${engine === 'cloud' ? '云端 AI' : '本地'}），请核对`);
    setTimeout(hideToast, 1600);
  } catch (err) { showToast('识别失败：' + err.message); setTimeout(hideToast, 2000); }
}
async function doOcrWrong() {
  if (!pendingWrongImages.length) return tip('请先上传错答图片');
  try {
    const { text } = await OCR.ocrImage(pendingWrongImages, 'all', showToast);
    document.getElementById('in-wrong').value = text;
    showToast('错答文字已识别，请核对'); setTimeout(hideToast, 1600);
  } catch (err) { showToast('识别失败：' + err.message); setTimeout(hideToast, 2000); }
}
async function doOcrCorrect() {
  if (!pendingCorrectImages.length) return tip('请先上传正确答案图片');
  try {
    const { text, engine } = await OCR.ocrImage(pendingCorrectImages, 'all', showToast);
    document.getElementById('in-correct').value = text;
    showToast(`答案已识别（${engine === 'cloud' ? '云端 AI' : '本地'}），请核对`);
    setTimeout(hideToast, 1600);
  } catch (err) { showToast('识别失败：' + err.message); setTimeout(hideToast, 2000); }
}

function readForm() {
  return {
    subject: document.getElementById('in-subject').value,
    grade: document.getElementById('in-grade').value,
    source: document.getElementById('in-source').value,
    type: document.getElementById('in-type').value,
    reason: document.getElementById('in-reason').value,
    difficulty: document.getElementById('in-diff').value,
    knowledgePoint: document.getElementById('in-kp').value.trim(),
    question: document.getElementById('in-question').value.trim(),
    wrong: document.getElementById('in-wrong').value.trim(),
    correct: document.getElementById('in-correct').value.trim(),
    solution: document.getElementById('in-solution').value.trim(),
    images: pendingPhotos.slice(),
    wrongImages: pendingWrongImages.slice(),
    correctImages: pendingCorrectImages.slice(),
  };
}

function clearForm() {
  pendingPhotos = []; pendingWrongImages = []; pendingCorrectImages = [];
  renderQuestionThumbs(); renderWrongThumbs(); renderCorrectThumbs();
  ['in-kp', 'in-question', 'in-wrong', 'in-correct', 'in-solution'].forEach((id) => (document.getElementById(id).value = ''));
  // 注意：不再清空 saveTip，避免把"提交成功"的鼓励提示瞬间抹掉（之前 bug）
}

async function saveMistake() {
  const f = readForm();
  if (!f.subject) return tip('请选择科目');
  // 必填校验：题目/题干为可选；错答 / 正确答案 文字或图片二选一即可；解题思路需文字
  if (!fieldFilled(f.wrong, f.wrongImages)) return tip('📌 我的错答还没记录哦（传图或写文字都行）');
  if (!fieldFilled(f.correct, f.correctImages)) return tip('📌 正确答案还没记录哦（传图或写文字都行）');
  if (!f.solution.trim()) return tip('📌 解题思路还没写，写上更易掌握～');

  if (editingId) {
    const old = await DB.getMistake(editingId);
    const merged = { ...old, ...f };
    await DB.putMistake(merged);
    tip('已保存修改');
  } else {
    const m = {
      id: C.makeId(),
      createdAt: Date.now(),
      status: C.STATUS.UNMASTERED,
      stage: 0,
      nextReviewAt: Date.now(),
      reviewHistory: [],
      ...f,
    };
    await DB.putMistake(m);
    showSuccess();
  }
  editingId = null;
  document.getElementById('btn-save').textContent = '保存错题';
  clearForm();
  await refresh();
}

// 字段是否已填：文字非空，或已上传图片，二选一即可
function fieldFilled(text, images) {
  return (text && text.trim().length > 0) || (images && images.length > 0);
}

// 提交成功提示：带点幽默 + 鼓励，随机抽一条
const SUCCESS_MSGS = [
  '🎉 错题已入库！它将成为你封神路上的垫脚石～',
  '✨ 搞定！又一块绊脚石被你收编，继续保持！',
  '🚀 保存成功！错题不怕多，就怕不回头，你已经在路上了！',
  '💪 已记录！这道题被你关进小黑屋，下次让它认输！',
  '🌟 漂亮！错题本又厚了一页，你的实力也厚了一层！',
  '🏆 已存档！每一个被认真记录的错题，都是将来考场的加分项！',
];
function showSuccess() {
  const el = document.getElementById('saveTip');
  const msg = SUCCESS_MSGS[Math.floor(Math.random() * SUCCESS_MSGS.length)];
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4200);
}

function tip(msg) {
  document.getElementById('saveTip').textContent = msg;
  setTimeout(() => (document.getElementById('saveTip').textContent = ''), 2500);
}

function loadIntoForm(m) {
  editingId = m.id;
  document.getElementById('in-subject').value = m.subject;
  document.getElementById('in-grade').value = m.grade;
  document.getElementById('in-source').value = m.source;
  document.getElementById('in-type').value = m.type;
  document.getElementById('in-reason').value = m.reason;
  document.getElementById('in-diff').value = m.difficulty;
  document.getElementById('in-kp').value = m.knowledgePoint || '';
  document.getElementById('in-question').value = m.question || '';
  document.getElementById('in-wrong').value = m.wrong || '';
  document.getElementById('in-correct').value = m.correct || '';
  document.getElementById('in-solution').value = m.solution || '';
  pendingPhotos = (m.images || []).slice();
  pendingWrongImages = (m.wrongImages || []).slice();
  pendingCorrectImages = (m.correctImages || []).slice();
  renderQuestionThumbs(); renderWrongThumbs(); renderCorrectThumbs();
  document.getElementById('btn-save').textContent = '保存修改';
  document.getElementById('saveTip').textContent = '编辑中：保存后回到错题本';
  goView('input');
}

// ---------- 错题本 ----------
function renderList() {
  const fs = document.getElementById('f-subject').value;
  const fg = document.getElementById('f-grade').value;
  const fst = document.getElementById('f-status').value;
  const items = DATA.filter((m) =>
    (fs === '全部' || m.subject === fs) &&
    (fg === '全部' || m.grade === fg) &&
    (fst === '全部' || C.STATUS_LABEL[m.status] === fst)
  ).sort((a, b) => b.createdAt - a.createdAt);

  const box = document.getElementById('list-container');
  if (!items.length) { box.innerHTML = '<div class="empty">还没有符合条件的错题，去录一道吧～</div>'; return; }
  box.innerHTML = '';
  items.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      ${m.images && m.images[0] ? `<img class="thumb-sm zoomable" src="${m.images[0]}">` : '<div class="thumb-sm"></div>'}
      <div class="meta">
        <div class="t1">${m.subject} · ${m.grade} <span class="badge ${m.status}">${C.STATUS_LABEL[m.status]}</span></div>
        <div class="t2">${m.type} · ${m.knowledgePoint || '未填知识点'} · ${m.reason}</div>
        <div class="t3">${C.fmtDate(m.createdAt)}</div>
      </div>`;
    el.addEventListener('click', () => openDetail(m));
    box.appendChild(el);
  });
}

function openDetail(m) {
  const card = document.getElementById('modal-card');
  const qImgs = (m.images || []).map((s) => `<img class="zoomable" src="${s}">`).join('');
  const wImgs = (m.wrongImages || []).map((s) => `<img class="zoomable" src="${s}">`).join('');
  const cImgs = (m.correctImages || []).map((s) => `<img class="zoomable" src="${s}">`).join('');
  card.innerHTML = `
    <button class="close-x">×</button>
    <h3>${m.subject} · ${m.grade} <span class="badge ${m.status}">${C.STATUS_LABEL[m.status]}</span></h3>
    <div class="row"><span class="k">题型 / 错因 / 难度</span><div class="v">${m.type} · ${m.reason} · ${m.difficulty}</div></div>
    <div class="row"><span class="k">知识点</span><div class="v">${m.knowledgePoint || '—'}</div></div>
    ${qImgs ? `<div class="row"><span class="k">题目图片（点开看原图）</span>${qImgs}</div>` : ''}
    ${m.question ? `<div class="row"><span class="k">题干</span><div class="v">${escapeHtml(m.question)}</div></div>` : ''}
    ${wImgs ? `<div class="row"><span class="k">错答图片</span>${wImgs}</div>` : ''}
    ${m.wrong ? `<div class="row"><span class="k">我的错答</span><div class="v">${escapeHtml(m.wrong)}</div></div>` : ''}
    <div class="row"><span class="k">正确答案</span><div class="v">${escapeHtml(m.correct)}</div></div>
    ${cImgs ? `<div class="row"><span class="k">正确答案图片</span>${cImgs}</div>` : ''}
    ${m.solution ? `<div class="row"><span class="k">解题思路</span><div class="v">${escapeHtml(m.solution)}</div></div>` : ''}
    ${reviewHistoryHtml(m)}
    <div class="btn-group">
      <button class="btn-outline" id="d-edit">编辑</button>
      <button class="btn-danger" id="d-del">删除</button>
    </div>`;
  card.querySelector('.close-x').addEventListener('click', () => closeModal('modal'));
  card.querySelector('#d-edit').addEventListener('click', () => { closeModal('modal'); loadIntoForm(m); });
  card.querySelector('#d-del').addEventListener('click', async () => {
    if (confirm('确定删除这道错题？')) { await DB.deleteMistake(m.id); closeModal('modal'); await refresh(); }
  });
  openModal('modal');
}

// 复习记录时间线：展示每次重新解答的时间与对错，让孩子看清复习轨迹
function reviewHistoryHtml(m) {
  const h = m.reviewHistory || [];
  if (!h.length) return '';
  const rows = h.slice().reverse().map((r, i) => `
    <div class="rev-row">
      <span class="rev-idx">第 ${h.length - i} 次</span>
      <span class="rev-time">${C.fmtDateTime(r.date)}</span>
      <span class="rev-result ${r.correct ? 'ok' : 'bad'}">${r.correct ? '答对 ✓' : '答错 ✗'}</span>
    </div>`).join('');
  return `<div class="row"><span class="k">复习记录（共重新解答 ${h.length} 次）</span><div class="rev-list">${rows}</div></div>`;
}

// ---------- 分析 ----------
function renderAnalysis() {
  const total = DATA.length;
  const mastered = DATA.filter((m) => m.status === C.STATUS.MASTERED).length;
  const reviewing = DATA.filter((m) => m.status === C.STATUS.REVIEWING).length;
  const unmastered = DATA.filter((m) => m.status === C.STATUS.UNMASTERED).length;

  document.getElementById('stat-cards').innerHTML = `
    <div class="sc"><div class="num">${total}</div><div class="lab">总错题</div></div>
    <div class="sc"><div class="num" style="color:var(--ok)">${mastered}</div><div class="lab">已掌握</div></div>
    <div class="sc"><div class="num" style="color:var(--warn)">${reviewing}</div><div class="lab">复习中</div></div>
    <div class="sc"><div class="num" style="color:var(--bad)">${unmastered}</div><div class="lab">未掌握</div></div>`;

  barChart('chart-subject', '按科目分布', groupCount(DATA, 'subject'));
  barChart('chart-grade', '按年级分布', groupCount(DATA, 'grade'));
  barChart('chart-type', '按题型分布', groupCount(DATA, 'type'));
  barChart('chart-reason', '按错因分布', groupCount(DATA, 'reason'));
  barChart('chart-kp', '🔥 按知识点分布（最易错的知识点）', groupCount(DATA, 'knowledgePoint'), true);
}

function groupCount(arr, key) {
  const map = {};
  arr.forEach((m) => { map[m[key]] = (map[m[key]] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function barChart(elId, title, pairs, highlightTop) {
  const el = document.getElementById(elId);
  if (!pairs.length) { el.innerHTML = `<h4>${title}</h4><div class="empty">暂无数据</div>`; return; }
  const max = Math.max(...pairs.map((p) => p[1]));
  el.innerHTML = `<h4>${title}</h4>` + pairs.map(([name, val]) => {
    const isTop = highlightTop && val === max;
    return `
    <div class="bar-row">
      <div class="name">${name || '未填知识点'}${isTop ? ' 🔥' : ''}</div>
      <div class="track"><div class="fill${isTop ? ' danger' : ''}" style="width:${Math.round((val / max) * 100)}%"></div></div>
      <div class="val">${val}</div>
    </div>`;
  }).join('');
}

// ---------- 复习（只显示题目，答案藏在"对答案"后） ----------
function renderReview() {
  const due = DATA.filter((m) => C.isDueToday(m)).sort((a, b) => a.nextReviewAt - b.nextReviewAt);
  const allActive = DATA.filter((m) => m.status !== C.STATUS.MASTERED);
  document.getElementById('review-head').innerHTML = allActive.length
    ? `今日应复习 <b>${due.length}</b> 题 · 共 ${allActive.length} 题待巩固`
    : '🎉 所有错题都已掌握，太棒了！';

  const box = document.getElementById('review-container');
  const list = due.length ? due : allActive.slice(0, 20);
  if (!list.length) { box.innerHTML = '<div class="empty">暂无需要复习的错题</div>'; return; }
  box.innerHTML = '';
  list.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      ${m.images && m.images[0] ? `<img class="thumb-sm zoomable" src="${m.images[0]}">` : '<div class="thumb-sm"></div>'}
      <div class="meta">
        <div class="t1">${m.subject} · ${m.grade} <span class="badge ${m.status}">${C.STATUS_LABEL[m.status]}</span></div>
        <div class="t2">${m.knowledgePoint || '未填知识点'} · 已巩固 ${m.stage || 0}/5</div>
        <div class="t3">${m.lastReviewedAt ? '上次复习 ' + C.fmtDate(m.lastReviewedAt) : '还没复习过'}</div>
      </div>`;
    el.addEventListener('click', () => openReview(m));
    box.appendChild(el);
  });
}

function openReview(m) {
  const card = document.getElementById('review-modal-card');
  const qImgs = (m.images || []).map((s) => `<img class="zoomable" src="${s}">`).join('');
  const cImgs = (m.correctImages || []).map((s) => `<img class="zoomable" src="${s}">`).join('');
  card.innerHTML = `
    <button class="close-x">×</button>
    <h3>${m.subject} · ${m.grade} · ${m.knowledgePoint || ''}</h3>
    <div class="row"><span class="k">题目（先自己答，答案在下面）</span></div>
    ${qImgs ? `<div class="row">${qImgs}</div>` : ''}
    ${m.question ? `<div class="row"><div class="v">${escapeHtml(m.question)}</div></div>` : ''}
    <div class="answer-box">
      <div class="answer-row">
        <input id="rv-answer" placeholder="写下答案，或点 🎤 语音 / 📷 拍照">
        <button class="mic-btn" id="rv-voice" type="button">🎤</button>
        <button class="cam-btn" id="rv-cam" type="button">📷</button>
      </div>
    </div>
    <button class="btn-primary" id="rv-reveal">判分 / 对答案</button>
    <div id="rv-result" style="display:none">
      <div class="reveal"><div class="k">正确答案</div><div class="v">${escapeHtml(m.correct)}</div></div>
      ${cImgs ? `<div class="reveal"><div class="k">正确答案图片</div>${cImgs}</div>` : ''}
      ${m.solution ? `<div class="reveal"><div class="k">解题思路</div><div class="v">${escapeHtml(m.solution)}</div></div>` : ''}
      <div id="rv-judge"></div>
      <div class="btn-group">
        <button class="btn-ok" id="rv-ok">我答对了 ✓</button>
        <button class="btn-bad" id="rv-bad">答错了 ✗</button>
      </div>
    </div>`;
  card.querySelector('.close-x').addEventListener('click', () => closeModal('review-modal'));
  card.querySelector('#rv-cam').addEventListener('click', () => document.getElementById('rv-cam-input').click());
  attachVoiceInput(card.querySelector('#rv-answer'), card.querySelector('#rv-voice'));
  card.querySelector('#rv-reveal').addEventListener('click', () => runJudge(m, card));
  card.querySelector('#rv-ok').addEventListener('click', () => finishReview(m, true));
  card.querySelector('#rv-bad').addEventListener('click', () => finishReview(m, false));
  openModal('review-modal');
}

async function runJudge(m, card) {
  card.querySelector('#rv-result').style.display = 'block';
  card.querySelector('#rv-reveal').style.display = 'none';
  const judgeEl = card.querySelector('#rv-judge');
  const student = (card.querySelector('#rv-answer').value || '').trim();

  if (!student) { judgeEl.innerHTML = '<span class="judge warn">⚠ 未填写答案，请自行核对后选择</span>'; return; }
  if (!m.correct) { judgeEl.innerHTML = '<span class="judge warn">⚠ 本题未记录文字答案，请自行核对后选择</span>'; return; }

  const quick = C.isAnswerMatch(student, m.correct);
  if (quick === true) {
    judgeEl.innerHTML = '<span class="judge ok">✓ 答案一致，看起来答对了</span>';
    return;
  }
  // 不一致：尝试云端 AI 复核（若已配置）
  const ai = await OCR.judgeEquivalent(student, m.correct, m.question, showToast);
  setTimeout(hideToast, 1500);
  if (ai === true) judgeEl.innerHTML = '<span class="judge ok">✓ AI 判定作答正确</span>';
  else if (ai === false) judgeEl.innerHTML = '<span class="judge bad">✗ 与正确答案不一致，请确认</span>';
  else judgeEl.innerHTML = '<span class="judge warn">⚠ 自动判定不确定，请自行核对后选择</span>';
}

async function onReviewCamera(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const dataUrl = await C.compressImage(f, 1200, 0.8);
  try {
    const { text } = await OCR.ocrImage([dataUrl], 'all', showToast);
    const inp = document.getElementById('rv-answer');
    if (inp) inp.value = text;
    showToast('已识别，请核对'); setTimeout(hideToast, 1600);
  } catch (err) { showToast('识别失败：' + err.message); setTimeout(hideToast, 2000); }
  e.target.value = '';
}

async function finishReview(m, correct) {
  const updated = C.applyReviewResult(m, correct);
  await DB.putMistake(updated);
  closeModal('review-modal');
  showToast(`复习已记录 ✓ ${C.fmtDate(Date.now())} · ${correct ? '这次答对了' : '这次答错了，下次加油'}`);
  setTimeout(hideToast, 2600);
  await refresh();
}

// ---------- 语音输入（Web Speech API，免费、无需 Key，可复用到任意输入框） ----------
function attachVoiceInput(targetEl, btnEl) {
  if (!targetEl || !btnEl) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const idleText = btnEl.textContent || '🎤';
  if (!SR) {
    btnEl.disabled = true; btnEl.textContent = idleText; btnEl.title = '当前浏览器不支持语音输入';
    return;
  }
  let rec = null;
  let baseline = '';
  let finalText = '';
  let listening = false;

  btnEl.addEventListener('click', () => {
    if (listening) { try { rec.stop(); } catch (e) {} return; }
    rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    baseline = targetEl.value;
    finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      targetEl.value = baseline + finalText + interim;
    };
    rec.onstart = () => {
      listening = true;
      btnEl.classList.add('listening');
      btnEl.textContent = '⏹ 停止';
      showToast('聆听中…说吧');
    };
    rec.onend = () => {
      listening = false;
      btnEl.classList.remove('listening');
      btnEl.textContent = idleText;
      hideToast();
      targetEl.value = baseline + finalText; // 去掉临时识别片段，保留已确定的文字
      targetEl.focus();
    };
    rec.onerror = (e) => {
      listening = false;
      btnEl.classList.remove('listening');
      btnEl.textContent = idleText;
      hideToast();
      const map = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器中允许',
        'no-speech': '没听到声音，再试一次',
        'network': '网络异常，语音识别需要联网',
        'aborted': '',
      };
      const msg = map[e.error] || ('语音识别出错：' + e.error);
      if (msg) { showToast(msg); setTimeout(hideToast, 2500); }
    };
    try { rec.start(); } catch (err) { /* 已启动则忽略 */ }
  });
}

// 录入页"解题思路"语音按钮
function initVoiceInput() {
  attachVoiceInput(document.getElementById('in-solution'), document.getElementById('btn-solution-voice'));
}

// ---------- OCR 设置 ----------
function loadOcrSettings() {
  const cfg = OCR.getOcrConfig();
  document.getElementById('ocr-provider').value = cfg.provider || 'auto';
  document.getElementById('ocr-endpoint').value = cfg.endpoint || '';
  document.getElementById('ocr-key').value = cfg.apiKey || '';
  document.getElementById('ocr-model').value = cfg.model || '';
}
function saveOcrSettings() {
  const cfg = {
    provider: document.getElementById('ocr-provider').value,
    endpoint: document.getElementById('ocr-endpoint').value.trim(),
    apiKey: document.getElementById('ocr-key').value.trim(),
    model: document.getElementById('ocr-model').value.trim(),
  };
  OCR.saveOcrConfig(cfg);
  showToast('识别设置已保存'); setTimeout(hideToast, 1500);
}
async function testOcr(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const dataUrl = await C.compressImage(f, 1200, 0.8);
  try {
    const { text, engine } = await OCR.ocrImage([dataUrl], 'all', showToast);
    showToast('识别成功（' + (engine === 'cloud' ? '云端 AI' : '本地') + '）：' + (text.slice(0, 40) || '（无文字）'));
    setTimeout(hideToast, 3000);
  } catch (err) { showToast('识别失败：' + err.message); setTimeout(hideToast, 2500); }
  e.target.value = '';
}

// ---------- 备份 ----------
function exportBackup() {
  const obj = { app: 'cuotiben', version: 1, exportedAt: Date.now(), items: DATA };
  // 把图片以独立文件形式不内联（保持 JSON 可读），这里仍内联 dataURL 以便单文件备份
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `错题备份_${C.fmtDate(Date.now())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  tip('已导出备份');
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    const items = Array.isArray(obj) ? obj : obj.items || [];
    if (!confirm(`将导入 ${items.length} 条错题（相同 ID 会覆盖，不重复）。继续？`)) return;
    for (const it of items) { if (it && it.id) await DB.putMistake(it); }
    await refresh();
    tip('导入完成');
  } catch (err) {
    alert('导入失败：文件格式不正确');
  }
  e.target.value = '';
}

async function clearData() {
  if (confirm('确定清空全部错题数据？此操作不可恢复（请先导出备份）！')) {
    await DB.clearAll();
    await refresh();
    tip('已清空');
  }
}

// ---------- 通用 ----------
async function refresh() {
  DATA = await DB.getAllMistakes();
  if (document.getElementById('view-list').classList.contains('active')) renderList();
  if (document.getElementById('view-analysis').classList.contains('active')) renderAnalysis();
  if (document.getElementById('view-review').classList.contains('active')) renderReview();
}

function goView(name) {
  if (name === 'input') { const st = document.getElementById('saveTip'); if (st) st.textContent = ''; } // 清掉"编辑中"等残留提示
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  document.getElementById('topTitle').textContent = TITLES[name];
  if (name === 'list') renderList();
  if (name === 'analysis') renderAnalysis();
  if (name === 'review') renderReview();
}

function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }
function openLightbox(src) { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox').hidden = false; }
function closeLightbox() { document.getElementById('lightbox').hidden = true; }

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
}
function hideToast() { document.getElementById('toast').hidden = true; }

function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

init();
