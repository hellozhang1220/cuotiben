import * as DB from './db.js';
import * as C from './config.js';

const TITLES = { input: '录入错题', list: '错题本', analysis: '分析', review: '复习重做', me: '我的' };
let DATA = [];
let editingId = null;

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
  bindEvents();
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

// ---------- 录入 ----------
let pendingPhotos = [];

function bindEvents() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => goView(t.dataset.view)));

  document.getElementById('in-subject').addEventListener('change', updateKpList);

  document.getElementById('in-photos').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      const dataUrl = await C.compressImage(f, 1200, 0.8);
      pendingPhotos.push(dataUrl);
    }
    e.target.value = '';
    renderThumbs();
  });

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

  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal' || e.target.classList.contains('close-x')) closeModal('modal');
  });
  document.getElementById('review-modal').addEventListener('click', (e) => {
    if (e.target.id === 'review-modal' || e.target.classList.contains('close-x')) closeModal('review-modal');
  });
}

function renderThumbs() {
  const box = document.getElementById('in-thumbs');
  box.innerHTML = '';
  pendingPhotos.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    wrap.innerHTML = `<img src="${src}"><button class="del" data-i="${i}">×</button>`;
    wrap.querySelector('.del').addEventListener('click', () => {
      pendingPhotos.splice(i, 1);
      renderThumbs();
    });
    box.appendChild(wrap);
  });
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
  };
}

function clearForm() {
  pendingPhotos = [];
  renderThumbs();
  ['in-kp', 'in-question', 'in-wrong', 'in-correct', 'in-solution'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('saveTip').textContent = '';
}

async function saveMistake() {
  const f = readForm();
  if (!f.subject) return tip('请选择科目');
  if (!f.images.length && !f.question) return tip('请拍照或填写题干');
  if (!f.correct) return tip('请填写正确答案');

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
    tip('已保存 ✓');
  }
  editingId = null;
  document.getElementById('btn-save').textContent = '保存错题';
  clearForm();
  await refresh();
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
  renderThumbs();
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
      ${m.images && m.images[0] ? `<img class="thumb-sm" src="${m.images[0]}">` : '<div class="thumb-sm"></div>'}
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
  const imgs = (m.images || []).map((s) => `<img src="${s}">`).join('');
  card.innerHTML = `
    <button class="close-x">×</button>
    <h3>${m.subject} · ${m.grade} <span class="badge ${m.status}">${C.STATUS_LABEL[m.status]}</span></h3>
    <div class="row"><span class="k">题型 / 错因 / 难度</span><div class="v">${m.type} · ${m.reason} · ${m.difficulty}</div></div>
    <div class="row"><span class="k">知识点</span><div class="v">${m.knowledgePoint || '—'}</div></div>
    ${imgs ? `<div class="row"><span class="k">题目图片</span>${imgs}</div>` : ''}
    ${m.question ? `<div class="row"><span class="k">题干</span><div class="v">${escapeHtml(m.question)}</div></div>` : ''}
    ${m.wrong ? `<div class="row"><span class="k">我的错答</span><div class="v">${escapeHtml(m.wrong)}</div></div>` : ''}
    <div class="row"><span class="k">正确答案</span><div class="v">${escapeHtml(m.correct)}</div></div>
    ${m.solution ? `<div class="row"><span class="k">解题思路</span><div class="v">${escapeHtml(m.solution)}</div></div>` : ''}
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
}

function groupCount(arr, key) {
  const map = {};
  arr.forEach((m) => { map[m[key]] = (map[m[key]] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function barChart(elId, title, pairs) {
  const el = document.getElementById(elId);
  if (!pairs.length) { el.innerHTML = `<h4>${title}</h4><div class="empty">暂无数据</div>`; return; }
  const max = Math.max(...pairs.map((p) => p[1]));
  el.innerHTML = `<h4>${title}</h4>` + pairs.map(([name, val]) => `
    <div class="bar-row">
      <div class="name">${name}</div>
      <div class="track"><div class="fill" style="width:${Math.round((val / max) * 100)}%"></div></div>
      <div class="val">${val}</div>
    </div>`).join('');
}

// ---------- 复习 ----------
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
      ${m.images && m.images[0] ? `<img class="thumb-sm" src="${m.images[0]}">` : '<div class="thumb-sm"></div>'}
      <div class="meta">
        <div class="t1">${m.subject} · ${m.grade} <span class="badge ${m.status}">${C.STATUS_LABEL[m.status]}</span></div>
        <div class="t2">${m.knowledgePoint || '未填知识点'} · 已巩固 ${m.stage || 0}/5</div>
      </div>`;
    el.addEventListener('click', () => openReview(m));
    box.appendChild(el);
  });
}

function openReview(m) {
  const card = document.getElementById('review-modal-card');
  const imgs = (m.images || []).map((s) => `<img src="${s}">`).join('');
  card.innerHTML = `
    <button class="close-x">×</button>
    <h3>${m.subject} · ${m.grade} · ${m.knowledgePoint || ''}</h3>
    <div class="row"><span class="k">题目（隐藏答案，先自己答）</span></div>
    ${imgs ? `<div class="row">${imgs}</div>` : ''}
    ${m.question ? `<div class="row"><div class="v">${escapeHtml(m.question)}</div></div>` : ''}
    <div class="answer-box"><input id="rv-answer" placeholder="在这里写下你的答案（可选）"></div>
    <button class="btn-primary" id="rv-reveal">对答案</button>
    <div id="rv-result" style="display:none">
      <div class="reveal"><div class="k">正确答案</div><div class="v">${escapeHtml(m.correct)}</div></div>
      ${m.solution ? `<div class="reveal"><div class="k">解题思路</div><div class="v">${escapeHtml(m.solution)}</div></div>` : ''}
      <div class="btn-group">
        <button class="btn-ok" id="rv-ok">我答对了 ✓</button>
        <button class="btn-bad" id="rv-bad">答错了 ✗</button>
      </div>
    </div>`;
  card.querySelector('.close-x').addEventListener('click', () => closeModal('review-modal'));
  card.querySelector('#rv-reveal').addEventListener('click', () => {
    card.querySelector('#rv-result').style.display = 'block';
    card.querySelector('#rv-reveal').style.display = 'none';
  });
  const finish = async (correct) => {
    const updated = C.applyReviewResult(m, correct);
    await DB.putMistake(updated);
    closeModal('review-modal');
    await refresh();
  };
  card.querySelector('#rv-ok').addEventListener('click', () => finish(true));
  card.querySelector('#rv-bad').addEventListener('click', () => finish(false));
  openModal('review-modal');
}

// ---------- 备份 ----------
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'cuotiben', version: 1, exportedAt: Date.now(), items: DATA }, null, 2)], { type: 'application/json' });
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
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

init();
