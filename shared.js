// BrowseMind 共享工具模块 - popup/dashboard 共用的工具函数和常量

// ==================== 动画偏好 ====================
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const chartAnimation = prefersReducedMotion ? false : undefined;

// ==================== 日期工具 ====================
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toLocalDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ==================== URL 工具 ====================
function extractDomain(url) {
  try {
    return WebsiteClassifier.normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

// ==================== 数据聚合 ====================
function calculateDailyTrend(data, days = 7) {
  const dailyStats = {};
  data.forEach(record => {
    const date = record.date;
    if (!dailyStats[date]) dailyStats[date] = { date, visits: 0, duration: 0 };
    dailyStats[date].visits++;
    dailyStats[date].duration += record.duration || 0;
  });
  return Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
}

// ==================== 图表调色板（带缓存） ====================
let _chartPaletteCache = null;
let _chartPaletteTheme = null;

function getChartPalette() {
  const theme = document.documentElement.dataset.theme || 'light';
  if (_chartPaletteCache && _chartPaletteTheme === theme) return _chartPaletteCache;
  const cs = getComputedStyle(document.documentElement);
  _chartPaletteCache = [1,2,3,4,5,6].map(i => cs.getPropertyValue(`--chart-${i}`).trim());
  _chartPaletteTheme = theme;
  return _chartPaletteCache;
}

function invalidateChartPalette() {
  _chartPaletteCache = null;
}

// ==================== 分类颜色映射 ====================
// 分类名 → 调色板索引
const CATEGORY_PALETTE_MAP = {
  learning: 0,
  coding: 1,
  social: 2,
  entertainment: 3,
  other: 4,
  tools: 5
};

// 获取分类颜色对象 { learning: color, coding: color, ... }
function getCategoryColors() {
  const p = getChartPalette();
  return {
    learning: p[0] || '#6366f1',
    coding: p[1] || '#34d399',
    entertainment: p[2] || '#fbbf24',
    social: p[3] || '#f87171',
    tools: p[4] || '#a1a1aa',
    other: p[5] || '#818cf8'
  };
}

// ==================== 目标类型映射 ====================
const CATEGORY_MAP = {
  daily_learning: 'learning',
  daily_entertainment: 'entertainment',
  daily_coding: 'coding',
  daily_social: 'social'
};

const GOAL_TYPE_NAMES = {
  daily_learning: '每日学习时长',
  daily_entertainment: '每日娱乐时长限制',
  daily_coding: '每日编程时长',
  daily_social: '每日社交时长限制'
};

// ==================== 网格颜色 ====================
function getGridColor() {
  const cs = getComputedStyle(document.documentElement);
  return cs.getPropertyValue('--chart-grid').trim() || 'oklch(88% 0.01 58 / 0.5)';
}
