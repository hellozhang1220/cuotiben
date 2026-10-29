// 全局配置：科目、年级、题型、错因、知识点建议树
export const GRADES = ['初一', '初二', '初三', '高一', '高二', '高三'];
export const SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治', '政治', '其他'];
export const SOURCES = ['作业', '测验', '月考', '练习', '其他'];
export const TYPES = ['选择题', '填空题', '计算题', '应用题', '解答题', '实验题', '阅读理解', '完形填空', '作文', '其他'];
export const REASONS = ['概念不清', '计算错误', '审题错误', '完全不会', '其他'];
export const DIFFICULTIES = ['简单', '中等', '较难'];

// 各科目知识点建议（录入时作为下拉提示，可自由增删）
export const KNOWLEDGE_TREE = {
  '数学': ['有理数', '数轴与绝对值', '一元一次方程', '整式的加减', '几何图形初步', '相交线与平行线', '实数', '平面直角坐标系', '二元一次方程组', '不等式与不等式组', '数据的收集整理与描述', '一次函数', '三角形', '全等三角形', '轴对称', '整式乘法与因式分解', '分式', '二次函数', '圆', '相似', '锐角三角函数', '概率初步'],
  '语文': ['字音字形', '词语运用', '病句修改', '标点符号', '古诗文默写', '文言文阅读', '现代文阅读', '名著阅读', '写作', '综合性学习'],
  '英语': ['词汇', '时态', '句型', '从句', '听力', '完形填空', '阅读理解', '任务型阅读', '书面表达'],
  '物理': ['声现象', '光现象', '透镜', '物态变化', '电流电路', '欧姆定律', '电功率', '力学', '压强', '浮力'],
  '化学': ['物质构成', '化学用语', '空气与氧气', '碳和碳的氧化物', '金属', '溶液', '酸碱盐'],
  '生物': ['细胞', '显微镜', '生物与环境', '植物', '人体', '绿色植物', '生态系统'],
  '历史': ['中国古代史', '中国近代史', '世界史'],
  '地理': ['地球与地图', '气候', '地形', '世界地理', '中国地理'],
  '道德与法治': ['成长与友谊', '师生与生命', '法治', '国情'],
};

export const STATUS = {
  UNMASTERED: 'unmastered',
  REVIEWING: 'reviewing',
  MASTERED: 'mastered',
};
export const STATUS_LABEL = { unmastered: '未掌握', reviewing: '复习中', mastered: '已掌握' };

// 遗忘曲线间隔（天）
const INTERVALS = [1, 3, 7, 15, 30];

export function makeId() {
  return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isDueToday(m) {
  return m.status !== STATUS.MASTERED && m.nextReviewAt <= dayStart(Date.now()) + 86400000;
}

// 记录一次复习结果，返回更新后的错题对象
export function applyReviewResult(m, correct) {
  const now = Date.now();
  m.lastReviewedAt = now;
  m.reviewHistory = m.reviewHistory || [];
  m.reviewHistory.push({ date: now, correct });
  if (correct) {
    m.stage = (m.stage || 0) + 1;
    if (m.stage >= INTERVALS.length) {
      m.status = STATUS.MASTERED;
      m.nextReviewAt = now + 30 * 86400000; // 保温复习
    } else {
      m.status = STATUS.REVIEWING;
      m.nextReviewAt = now + INTERVALS[m.stage] * 86400000;
    }
  } else {
    m.stage = 0;
    m.status = STATUS.UNMASTERED;
    m.nextReviewAt = now + INTERVALS[0] * 86400000;
  }
  return m;
}

// 图片压缩：缩放最长边并转 JPEG，控制体积（iPad 空间小也放心）
export function compressImage(file, max = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > max) {
          height = Math.round((height * max) / width);
          width = max;
        } else if (height > max) {
          width = Math.round((width * max) / height);
          height = max;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDateTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 全角转半角（数字、字母、标点），用于答案归一化比对
function toHalfWidth(str) {
  return (str || '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

// 归一化：去空白、转小写、全角转半角，便于比较学生答案与正确答案
export function normalizeAnswer(s) {
  return toHalfWidth((s || '').trim().toLowerCase()).replace(/\s+/g, '');
}

// 返回 true 正确 / false 不一致 / null 无法判断（任一方为空）
export function isAnswerMatch(student, correct) {
  const a = normalizeAnswer(student);
  const b = normalizeAnswer(correct);
  if (!a || !b) return null;
  if (a === b) return true;
  if (b.includes(a) || a.includes(b)) return true; // 容错：一方包含另一方
  return false;
}
