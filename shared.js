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
  const scheme = document.documentElement.dataset.chartScheme || 'default';
  const key = `${theme}-${scheme}`;
  if (_chartPaletteCache && _chartPaletteTheme === key) return _chartPaletteCache;
  const cs = getComputedStyle(document.documentElement);
  _chartPaletteCache = [1,2,3,4,5,6].map(i => cs.getPropertyValue(`--chart-${i}`).trim());
  _chartPaletteTheme = key;
  return _chartPaletteCache;
}

function invalidateChartPalette() {
  _chartPaletteCache = null;
}

// 返回带透明度的调色板，alpha ∈ [0,1]
function getChartPaletteWithAlpha(alpha) {
  const pal = getChartPalette();
  return pal.map(hex => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  });
}

// ==================== 主题应用工具 ====================
function applyAccentColor(hex) {
  const root = document.documentElement;
  if (!hex) {
    root.removeAttribute('data-accent');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-soft');
    root.style.removeProperty('--accent-glow');
    return;
  }
  // hex → HSL components for oklch-like usage via hsl()
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${hex} 15%, var(--bg))`);
  root.style.setProperty('--accent-glow', `color-mix(in srgb, ${hex} 20%, transparent)`);
  root.setAttribute('data-accent', hex);
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

// ==================== 时间黑洞渲染（popup/dashboard 共用） ====================
function renderBlackholesToContainer(container, blackholes, options = {}) {
  const { maxItems = 5, emptyMsg = '没有明显的时间黑洞。', useShortLabels = false } = options;
  if (!container || !blackholes || !blackholes.topBlackholes || !blackholes.topBlackholes.length) {
    if (container) container.innerHTML = `<div class="empty">${escapeHtml(emptyMsg)}</div>`;
    return;
  }
  const labels = useShortLabels ? WebsiteClassifier.BLACKHOLE_TYPE_LABELS_SHORT : WebsiteClassifier.BLACKHOLE_TYPE_LABELS;
  const wp = Number(blackholes.wastePercentage || 0).toFixed(1);
  const items = blackholes.topBlackholes.slice(0, maxItems).map(item => {
    const pct = blackholes.totalWastedTime > 0 ? Math.round(item.totalDuration / blackholes.totalWastedTime * 100) : 0;
    const catName = WebsiteClassifier.CATEGORY_NAMES[item.category] || '其他';
    const typeLabel = labels[item.blackholeType] || '';
    const meta = item.blackholeType === 'high_frequency'
      ? `${item.visitCount} 次访问 · 累计 ${formatDuration(item.totalDuration)}`
      : `${item.longSessionsCount} 次长访问 · 最长 ${formatDuration(item.longestSession)}`;
    return `<div class="domain-row"><div><div class="domain-name">${escapeHtml(item.domain)} <span style="font-size:11px;font-weight:500;color:var(--muted);background:var(--surface-2);padding:1px 6px;border-radius:4px;">${escapeHtml(catName)}</span> <span style="font-size:11px;font-weight:500;color:var(--yellow);">${escapeHtml(typeLabel)}</span></div><div class="domain-meta">${meta}</div></div><div style="text-align:right"><div class="domain-meta">${formatDuration(item.totalDuration)}</div><div class="domain-meta" style="font-size:11px">${pct}%</div></div></div>`;
  }).join('');
  container.innerHTML = `<div class="status-note danger"><strong>${wp}%</strong> 的时间陷入黑洞 · 共 ${formatDuration(blackholes.totalWastedTime)}</div>${items}`;
}
