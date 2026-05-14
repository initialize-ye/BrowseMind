// getPreferences(), DEFAULT_API_BASE_URL, DEFAULT_PREFERENCES, escapeHtml are defined in dataSync.js
function getChartPalette() {
  const cs = getComputedStyle(document.documentElement);
  return [1,2,3,4,5,6].map(i => cs.getPropertyValue(`--chart-${i}`).trim());
}
let palette = getChartPalette();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const chartAnimation = prefersReducedMotion ? false : undefined;
const categoryMap = { daily_learning: 'learning', daily_entertainment: 'entertainment', daily_coding: 'coding', daily_social: 'social' };
const goalTypeNames = { daily_learning: '每日学习时长', daily_entertainment: '每日娱乐时长限制', daily_coding: '每日编程时长', daily_social: '每日社交时长限制' };
let dataSync = null;
let _connectionCache = { result: null, time: 0 };
const CONNECTION_CACHE_TTL = 30000; // 30s
async function cachedCheckConnection() {
  const now = Date.now();
  if (_connectionCache.result !== null && now - _connectionCache.time < CONNECTION_CACHE_TTL) {
    return _connectionCache.result;
  }
  const result = await dataSync.checkConnection();
  _connectionCache = { result, time: now };
  return result;
}
let trendChart = null;
let hourlyChart = null;
let activeSidebarTab = 'actions';
let isSidebarCollapsed = false;
let attentionChart = null;
let currentClassifiedData = [];
let domainFilterTimer = null;
const SIDEBAR_TABS = ['dashboard', 'insights', 'actions', 'goals', 'settings'];

function todayString() { return new Date().toISOString().split('T')[0]; }
// formatDuration() is defined in dataSync.js (shared with popup)
function log(message) {
  const box = document.getElementById('logBox');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const lines = box.textContent.split('\n');
  if (lines.length > 200) lines.length = 200;
  box.textContent = `[${time}] ${message}\n${lines.join('\n')}`;
}
// ==================== 主题切换 ====================
function applyTheme(themeMode) {
  const html = document.documentElement;
  if (themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    html.setAttribute('data-theme', 'dark');
  } else {
    html.removeAttribute('data-theme');
  }
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    const labels = { light: '亮色', dark: '深色', system: '跟随系统' };
    const iconKey = { light: 'sun', dark: 'moon', system: 'system' };
    const svg = WebsiteClassifier.UI_ICONS[iconKey[themeMode] || 'sun'];
    btn.innerHTML = svg + ' ' + (labels[themeMode] || labels.light);
    btn.dataset.theme = themeMode;
  }
  // Update chart colors for new theme
  setTimeout(() => {
    palette = getChartPalette();
    const gridColor = getGridColor();
    if (trendChart) {
      trendChart.data.datasets[0].borderColor = palette[0];
      trendChart.data.datasets[0].backgroundColor = palette[0] + '14';
      trendChart.data.datasets[1].borderColor = palette[1];
      trendChart.data.datasets[1].backgroundColor = palette[1] + '1a';
      trendChart.options.scales.y.grid.color = gridColor;
      trendChart.update();
    }
    if (hourlyChart) {
      const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
      const active = hourlyChart._activeHours || hourlyChart.data.datasets[0].data.map(v => v > 0);
      hourlyChart.data.datasets[0].backgroundColor = active.map(on => on ? accentColor : 'rgba(128,128,128,0.15)');
      hourlyChart.options.scales.y.grid.color = gridColor;
      hourlyChart.update();
    }
    if (attentionChart) {
      attentionChart.data.datasets[0].borderColor = palette[0];
      attentionChart.data.datasets[0].backgroundColor = palette[0] + '14';
      attentionChart.options.scales.y.grid.color = gridColor;
      attentionChart.update();
    }
  }, 80);
}
async function cycleTheme() {
  const current = document.getElementById('themeToggleBtn')?.dataset?.theme || 'light';
  const next = { light: 'dark', dark: 'system', system: 'light' };
  const themeMode = next[current];
  await chrome.storage.local.set({ themeMode });
  applyTheme(themeMode);
  log(`主题已切换：${themeMode}`);
}
async function loadTheme() {
  const { themeMode = 'light' } = await chrome.storage.local.get('themeMode');
  applyTheme(themeMode);
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themeMode));
}

function setButtonBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyText;
    return;
  }
  button.disabled = false;
  button.setAttribute('aria-busy', 'false');
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}
function setNote(message, type = 'info') {
  // Update the inline note in Actions view
  const note = document.getElementById('operationNote');
  note.style.display = 'block';
  note.className = `note ${type === 'success' ? 'success' : type === 'danger' ? 'danger' : ''}`;
  note.textContent = message;

  // Also show a toast visible from any tab
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const bgMap = { success: 'var(--green-soft)', danger: 'var(--red-soft)', info: 'var(--accent-soft)' };
  const colorMap = { success: 'var(--green)', danger: 'var(--red)', info: 'var(--accent)' };
  toast.style.cssText = `pointer-events:auto;margin-bottom:8px;padding:12px 16px;border-radius:var(--radius-sm);background:${bgMap[type] || bgMap.info};color:${colorMap[type] || colorMap.info};font-size:13px;line-height:1.5;box-shadow:var(--shadow);opacity:0;transition:opacity .2s ease;`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
// getPreferences() 由 dataSync.js 提供
async function getApiBaseUrl() {
  const { apiBaseUrl } = await getPreferences();
  return apiBaseUrl;
}
async function loadSidebarState() {
  const { dashboardSidebarCollapsed = false, dashboardActiveSidebarTab = 'actions' } = await chrome.storage.local.get(['dashboardSidebarCollapsed', 'dashboardActiveSidebarTab']);
  isSidebarCollapsed = Boolean(dashboardSidebarCollapsed);
  activeSidebarTab = dashboardActiveSidebarTab;
}
function applySidebarState() {
  document.body.classList.toggle('sidebar-collapsed', isSidebarCollapsed);
  const toggleButton = document.getElementById('sidebarToggleBtn');
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', isSidebarCollapsed ? 'false' : 'true');
    toggleButton.setAttribute('aria-label', isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏');
    toggleButton.innerHTML = isSidebarCollapsed ? WebsiteClassifier.UI_ICONS.menu : WebsiteClassifier.UI_ICONS.close;
  }
  document.querySelectorAll('[data-sidebar-tab]').forEach(button => {
    const label = button.querySelector('.sidebar-tab-label')?.textContent?.trim() || button.dataset.sidebarTab;
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}
async function toggleSidebar() {
  isSidebarCollapsed = !isSidebarCollapsed;
  applySidebarState();
  await chrome.storage.local.set({ dashboardSidebarCollapsed: isSidebarCollapsed });
  // Wait for CSS grid transition to fully complete (280ms) before resizing
  setTimeout(() => {
    if (trendChart) trendChart.resize();
    if (hourlyChart) hourlyChart.resize();
    // Second pass ensures charts pick up final layout dimensions
    requestAnimationFrame(() => {
      if (trendChart) trendChart.resize();
      if (hourlyChart) hourlyChart.resize();
    });
  }, 320);
}
async function switchSidebarTab(tab, options = {}) {
  if (!SIDEBAR_TABS.includes(tab)) {
    tab = 'actions';
  }
  const { focusPanel = false } = options;
  activeSidebarTab = tab;
  document.querySelectorAll('[data-sidebar-tab]').forEach(button => {
    const isActive = button.dataset.sidebarTab === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });
  document.querySelectorAll('[data-main-view]').forEach(view => {
    const isActive = view.dataset.mainView === tab;
    view.classList.toggle('active', isActive);
    view.hidden = !isActive;
    view.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    if (isActive && focusPanel) {
      view.focus();
    }
  });
  await chrome.storage.local.set({ dashboardActiveSidebarTab: tab });
  if (tab === 'dashboard') {
    requestAnimationFrame(() => {
      if (trendChart) trendChart.resize();
      if (hourlyChart) hourlyChart.resize();
    });
  }
  if (tab === 'settings') {
    await loadPreferences();
    renderOverrideRules();
  }
  if (tab === 'insights') {
    loadLatestAIAnalysis().catch(() => {});
    loadAdvancedInsights().catch(() => {});
    loadReports().catch(() => {});
  }
}
function applyPreferencesToForm(preferences) {
  document.getElementById('apiBaseUrlInput').value = preferences.apiBaseUrl;
  document.getElementById('autoSyncEnabledInput').checked = Boolean(preferences.autoSyncEnabled);
  document.getElementById('notificationsEnabledInput').checked = Boolean(preferences.notificationsEnabled);
  updateInterventionWarning();
  document.getElementById('autoSyncDebounceInput').value = Math.round(preferences.autoSyncDebounceMs / 1000);
  document.getElementById('autoSyncMinIntervalInput').value = Math.round(preferences.autoSyncMinIntervalMs / 1000);
  document.getElementById('dataRetentionDaysInput').value = preferences.dataRetentionDays;
  document.getElementById('minVisitDurationInput').value = preferences.minVisitDurationSeconds;
  document.getElementById('blackholeThresholdInput').value = preferences.blackholeThresholdMinutes;
  document.getElementById('analysisDaysInput').value = String(preferences.analysisDays);
  document.getElementById('interventionsEnabledInput').checked = Boolean(preferences.interventionsEnabled);
  document.getElementById('focusModeEnabledInput').checked = Boolean(preferences.focusModeEnabled);
  document.getElementById('domainAllowlistInput').value = preferences.domainAllowlist || '';
  document.getElementById('domainBlocklistInput').value = preferences.domainBlocklist || '';
  document.getElementById('categoryTimeLimitsInput').value = preferences.categoryTimeLimits || '';
  document.getElementById('interventionCooldownInput').value = preferences.interventionCooldownMinutes;
}
function updateInterventionWarning() {
  const warnEl = document.getElementById('interventionWarning');
  if (!warnEl) return;
  const interventionsOn = document.getElementById('interventionsEnabledInput')?.checked;
  const notificationsOn = document.getElementById('notificationsEnabledInput')?.checked;
  warnEl.style.display = (interventionsOn && !notificationsOn) ? '' : 'none';
}
async function loadPreferences() {
  const preferences = await getPreferences();
  applyPreferencesToForm(preferences);
  return preferences;
}
function readPreferencesFromForm() {
  return {
    apiBaseUrl: document.getElementById('apiBaseUrlInput').value.trim() || DEFAULT_API_BASE_URL,
    autoSyncEnabled: document.getElementById('autoSyncEnabledInput').checked,
    notificationsEnabled: document.getElementById('notificationsEnabledInput').checked,
    autoSyncDebounceMs: Math.max(1000, Number(document.getElementById('autoSyncDebounceInput').value || 15) * 1000),
    autoSyncMinIntervalMs: Math.max(10000, Number(document.getElementById('autoSyncMinIntervalInput').value || 120) * 1000),
    dataRetentionDays: Math.max(1, Number(document.getElementById('dataRetentionDaysInput').value || 7)),
    minVisitDurationSeconds: Math.max(1, Number(document.getElementById('minVisitDurationInput').value || 3)),
    blackholeThresholdMinutes: Math.max(1, Number(document.getElementById('blackholeThresholdInput').value || 30)),
    analysisDays: Math.max(1, Number(document.getElementById('analysisDaysInput').value || 7)),
    interventionsEnabled: document.getElementById('interventionsEnabledInput').checked,
    focusModeEnabled: document.getElementById('focusModeEnabledInput').checked,
    domainAllowlist: document.getElementById('domainAllowlistInput').value.trim(),
    domainBlocklist: document.getElementById('domainBlocklistInput').value.trim(),
    categoryTimeLimits: document.getElementById('categoryTimeLimitsInput').value.trim(),
    interventionCooldownMinutes: Math.max(1, Number(document.getElementById('interventionCooldownInput').value || 30))
  };
}
async function initDataSync() {
  const apiBaseUrl = await getApiBaseUrl();
  dataSync = new DataSync(apiBaseUrl);
  _connectionCache = { result: null, time: 0 }; // invalidate on new instance
  return dataSync;
}

// ==================== 分类纠错 ====================
async function getClassificationOverrides() {
  const { classificationOverrides = {} } = await chrome.storage.local.get('classificationOverrides');
  return classificationOverrides;
}
async function saveClassificationOverride(domain, category) {
  const overrides = await getClassificationOverrides();
  overrides[domain] = category;
  await chrome.storage.local.set({ classificationOverrides: overrides });
}
async function removeClassificationOverride(domain) {
  const overrides = await getClassificationOverrides();
  delete overrides[domain];
  await chrome.storage.local.set({ classificationOverrides: overrides });
}
function renderOverrideRules() {
  const container = document.getElementById('overrideRuleList');
  if (!container) return;
  getClassificationOverrides().then(overrides => {
    const entries = Object.entries(overrides);
    if (!entries.length) {
      container.innerHTML = '<div class="empty">暂无自定义分类规则。</div>';
      return;
    }
    const classifier = new WebsiteClassifier();
    const categories = classifier.getAllCategories();
    container.innerHTML = entries.map(([domain, category]) => {
      const info = categories[category] || { name: '其他', icon: WebsiteClassifier.SVG.other };
      const encDomain = domain.replace(/"/g, '&quot;');
      return `<div class="domain-row"><div><div class="domain-name">${escapeHtml(domain)}</div><div class="domain-meta">${info.icon} ${escapeHtml(info.name)}</div></div><button class="danger" data-override-remove="${encDomain}">移除</button></div>`;
    }).join('');
    container.querySelectorAll('[data-override-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await removeClassificationOverride(btn.dataset.overrideRemove);
        renderOverrideRules();
        await loadAnalytics();
        log(`已移除分类规则：${btn.dataset.overrideRemove}`);
      });
    });
  });
}
function showCategoryPicker(domain, currentCategory) {
  const classifier = new WebsiteClassifier();
  const categories = classifier.getAllCategories();
  const picker = document.getElementById('categoryPicker');

  // Backdrop overlay
  let backdrop = document.getElementById('pickerBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'pickerBackdrop';
    backdrop.style.cssText = 'display:none;position:fixed;inset:0;z-index:9997;background:oklch(0% 0 0 / 0.32);';
    document.body.appendChild(backdrop);
  }
  backdrop.style.display = 'block';

  picker.style.display = 'block';
  picker.innerHTML = `<div class="picker-header"><strong>修改分类：${escapeHtml(domain)}</strong><button class="ghost" id="closePickerBtn" style="min-height:32px;padding:4px 10px;">取消</button></div>` +
    Object.entries(categories).map(([key, info]) =>
      `<button class="picker-option${key === currentCategory ? ' active' : ''}" data-pick-cat="${key}">${info.icon} ${escapeHtml(info.name)}</button>`
    ).join('');

  // Track previously focused element to restore on close
  const trigger = document.activeElement;

  function closePicker() {
    picker.style.display = 'none';
    backdrop.style.display = 'none';
    document.removeEventListener('keydown', onPickerKey);
    backdrop.removeEventListener('click', closePicker);
    if (trigger && typeof trigger.focus === 'function') trigger.focus();
  }

  function onPickerKey(e) {
    if (e.key === 'Escape') { closePicker(); return; }
    // Focus trap: cycle Tab within dialog
    if (e.key === 'Tab') {
      const focusable = picker.querySelectorAll('button:not([disabled])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  document.getElementById('closePickerBtn').addEventListener('click', closePicker);
  backdrop.addEventListener('click', closePicker);
  document.addEventListener('keydown', onPickerKey);

  // Focus the first option
  const firstBtn = picker.querySelector('[data-pick-cat]');
  if (firstBtn) firstBtn.focus();

  picker.querySelectorAll('[data-pick-cat]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newCat = btn.dataset.pickCat;
      await saveClassificationOverride(domain, newCat);
      closePicker();
      log(`已将 ${domain} 分类为 ${categories[newCat]?.name || newCat}`);
      await loadAnalytics();
      renderOverrideRules();
    });
  });
}

function calculateDailyTrend(data, days = 7) {
  const dailyStats = {};
  data.forEach(record => {
    const date = record.date;
    if (!dailyStats[date]) dailyStats[date] = { date, visits: 0, duration: 0 };
    dailyStats[date].visits++;
    dailyStats[date].duration += record.duration || 0;
  });
  return Object.values(dailyStats).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-days);
}
function calculateTopDomains(data) {
  const domainMap = {};
  data.forEach(record => {
    if (!record.domain) return;
    if (!domainMap[record.domain]) domainMap[record.domain] = { domain: record.domain, visits: 0, duration: 0 };
    domainMap[record.domain].visits++;
    domainMap[record.domain].duration += record.duration || 0;
  });
  return Object.values(domainMap).sort((a, b) => b.duration - a.duration).slice(0, 8);
}
function renderMetrics(data) {
  const today = todayString();
  const todayData = data.filter(record => record.date === today);
  const todayDuration = todayData.reduce((sum, record) => sum + (record.duration || 0), 0);
  const uniqueSites = new Set(data.map(record => record.domain).filter(Boolean)).size;
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  document.getElementById('metricTodayVisits').textContent = todayData.length;
  document.getElementById('metricTodayDuration').textContent = formatDuration(todayDuration);
  document.getElementById('metricWeekVisits').textContent = data.length;
  document.getElementById('metricUniqueSites').textContent = uniqueSites;
}
function renderCategoryList(categoryStats, classifier) {
  const container = document.getElementById('categoryList');
  if (!categoryStats.length) {
    container.innerHTML = '<div class="empty">分类数据还在积累中，多逛几个站点就有了。</div>';
    return;
  }
  const categories = classifier.getAllCategories();
  container.innerHTML = categoryStats.map((stat, index) => {
    const info = categories[stat.category] || { name: '其他', icon: WebsiteClassifier.SVG.other };
    const percentage = Number(stat.percentage || 0);
    return `<div class="category-row"><div><strong>${info.icon} ${escapeHtml(info.name)}</strong><div class="category-meta">${stat.visits} 次</div></div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(percentage, 100)}%; background:${palette[index % palette.length]}"></div></div><div class="category-meta">${percentage.toFixed(1)}%</div></div>`;
  }).join('');
}
function renderDomainList(domains) {
  const container = document.getElementById('domainList');
  if (!domains.length) {
    container.innerHTML = '<div class="empty">暂无站点数据。</div>';
    return;
  }
  container.innerHTML = domains.map(domain => {
    const encDomain = (domain.domain || '').replace(/"/g, '&quot;');
    return `<div class="domain-row"><div><div class="domain-name">${escapeHtml(domain.domain)}</div><div class="domain-meta">${domain.visits} 次访问 · ${escapeHtml(domain.categoryName || '全部分类')}</div></div><div class="domain-meta"><span>${formatDuration(domain.duration)}</span> <button class="ghost" data-correct-domain="${encDomain}" data-correct-cat="${domain.category || 'other'}" style="min-height:28px;padding:2px 8px;font-size:11px;">修改分类</button></div></div>`;
  }).join('');
  container.querySelectorAll('[data-correct-domain]').forEach(btn => {
    btn.addEventListener('click', () => {
      showCategoryPicker(btn.dataset.correctDomain, btn.dataset.correctCat);
    });
  });
}
function renderFilteredDomains() {
  const categoryFilter = document.getElementById('categoryFilterInput').value;
  const domainFilter = document.getElementById('domainFilterInput').value.trim().toLowerCase();
  const classifier = new WebsiteClassifier();
  const categories = classifier.getAllCategories();
  const filtered = currentClassifiedData.filter(record => {
    const matchesCategory = categoryFilter === 'all' || record.category === categoryFilter;
    const matchesDomain = !domainFilter || (record.domain || '').includes(domainFilter);
    return matchesCategory && matchesDomain;
  });
  const domains = calculateTopDomains(filtered).map(domain => {
    const firstRecord = filtered.find(record => record.domain === domain.domain);
    const cat = firstRecord?.category || 'other';
    return { ...domain, category: cat, categoryName: categories[cat]?.name || '其他' };
  });
  renderDomainList(domains);
}
function getGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.06)';
}
function renderTrendChart(dailyTrend) {
  const labels = dailyTrend.map(item => { const date = new Date(item.date); return `${date.getMonth() + 1}/${date.getDate()}`; });
  const durationData = dailyTrend.map(item => Math.round((item.duration || 0) / 60));
  const visitsData = dailyTrend.map(item => item.visits);
  if (trendChart) {
    trendChart.data.labels = labels;
    trendChart.data.datasets[0].data = durationData;
    trendChart.data.datasets[0].borderColor = palette[0];
    trendChart.data.datasets[0].backgroundColor = palette[0] + '14';
    trendChart.data.datasets[1].data = visitsData;
    trendChart.data.datasets[1].borderColor = palette[1];
    trendChart.data.datasets[1].backgroundColor = palette[1] + '1a';
    trendChart.options.scales.y.grid.color = getGridColor();
    trendChart.update();
    return;
  }
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [
      { label: '时长（分钟）', data: durationData, borderColor: palette[0], backgroundColor: palette[0] + '14', tension: .36, fill: true, yAxisID: 'y' },
      { label: '访问次数', data: visitsData, borderColor: palette[1], backgroundColor: palette[1] + '1a', tension: .36, fill: true, yAxisID: 'y1' }
    ]},
    options: { responsive: true, maintainAspectRatio: false, animation: chartAnimation, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, grid: { color: getGridColor() } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }, x: { grid: { display: false } } } }
  });
}
function renderHourlyChart(hourlyDist) {
  const hourMap = new Map(hourlyDist.map(item => [item.hour, item.duration]));
  const allHours = Array.from({ length: 24 }, (_, i) => ({ hour: i, duration: hourMap.get(i) || 0 }));
  const labels = allHours.map(item => `${item.hour}:00`);
  const data = allHours.map(item => Math.round(item.duration / 60));
  const activeHours = allHours.map(item => item.duration > 0);
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
  const bgColors = activeHours.map(active => active ? accentColor : 'rgba(128,128,128,0.15)');
  if (hourlyChart) {
    hourlyChart.data.labels = labels;
    hourlyChart.data.datasets[0].data = data;
    hourlyChart.data.datasets[0].backgroundColor = bgColors;
    hourlyChart._activeHours = activeHours;
    hourlyChart.options.scales.y.grid.color = getGridColor();
    hourlyChart.update();
    return;
  }
  const ctx = document.getElementById('hourlyChart').getContext('2d');
  hourlyChart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: '分钟', data, backgroundColor: bgColors, borderRadius: 0 }] }, options: { responsive: true, maintainAspectRatio: false, animation: chartAnimation, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: getGridColor() } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } } } } });
  hourlyChart._activeHours = activeHours;
}
function renderBlackholes(blackholes) {
  const container = document.getElementById('blackholeStats');
  if (!blackholes || !blackholes.top_blackholes || !blackholes.top_blackholes.length) {
    container.innerHTML = '<div class="empty">没有明显的时间黑洞 — 你的浏览节奏很健康。</div>';
    return;
  }
  const items = blackholes.top_blackholes.slice(0, 5).map(item => {
    const pct = blackholes.total_wasted_time > 0 ? Math.round(item.total_duration / blackholes.total_wasted_time * 100) : 0;
    const catName = WebsiteClassifier.CATEGORY_NAMES[item.category] || '其他';
    const typeLabel = WebsiteClassifier.BLACKHOLE_TYPE_LABELS[item.blackhole_type] || '';
    const meta = item.blackhole_type === 'high_frequency'
      ? `${item.visit_count} 次访问 · 累计 ${formatDuration(item.total_duration)}`
      : `${item.long_sessions_count} 次长访问 · 最长 ${formatDuration(item.longest_session)}`;
    return `<div class="domain-row"><div><div class="domain-name">${escapeHtml(item.domain)} <span style="font-size:11px;font-weight:500;color:var(--muted);background:var(--surface-2);padding:1px 6px;border-radius:4px;">${catName}</span> <span style="font-size:11px;font-weight:500;color:var(--yellow);">${typeLabel}</span></div><div class="domain-meta">${meta}</div></div><div style="text-align:right"><div class="domain-meta">${formatDuration(item.total_duration)}</div><div class="domain-meta" style="font-size:11px">${pct}%</div></div></div>`;
  }).join('');
  const wp = Number(blackholes.waste_percentage || 0).toFixed(1);
  container.innerHTML = `<div class="status-note danger"><strong>${wp}%</strong> 的时间陷入黑洞 · 共 ${formatDuration(blackholes.total_wasted_time)}</div>${items}`;
}
function renderAttentionCurve(attentionCurve) {
  const statsContainer = document.getElementById('attentionStats');
  if (!attentionCurve || !attentionCurve.hourly_focus) {
    statsContainer.innerHTML = '<div class="empty">专注曲线需要更多数据 — 同步后再来看看。</div>';
    return;
  }
  const peakLabels = (attentionCurve.peak_hours || []).map(h => `${h}:00`).join('、') || '—';
  const recommendation = attentionCurve.recommendations && attentionCurve.recommendations[0] ? `<div class="status-note">${escapeHtml(attentionCurve.recommendations[0])}</div>` : '';
  statsContainer.innerHTML = `<div class="insight-cards"><div class="insight-card"><span>专注分数</span><strong>${Math.round(attentionCurve.focus_score || 0)}</strong></div><div class="insight-card"><span>高效时段</span><strong>${(attentionCurve.peak_hours || []).length}</strong><small>${peakLabels}</small></div></div>${recommendation}`;
  const activeHours = attentionCurve.hourly_focus.filter(item => item.total_duration > 0);
  if (!activeHours.length) { if (attentionChart) { attentionChart.destroy(); attentionChart = null; } return; }
  const labels = activeHours.map(item => `${item.hour}:00`);
  const scores = activeHours.map(item => item.score);
  if (attentionChart) {
    attentionChart.data.labels = labels;
    attentionChart.data.datasets[0].data = scores;
    attentionChart.data.datasets[0].borderColor = palette[0];
    attentionChart.data.datasets[0].backgroundColor = palette[0] + '14';
    attentionChart.options.scales.y.grid.color = getGridColor();
    attentionChart.update();
    return;
  }
  const ctx = document.getElementById('attentionChart').getContext('2d');
  attentionChart = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: '专注度', data: scores, borderColor: palette[0], backgroundColor: palette[0] + '14', tension: .36, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, animation: chartAnimation, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, grid: { color: getGridColor() } }, x: { grid: { display: false } } } } });
}
function renderAIAnalysis(analysis) {
  const container = document.getElementById('aiAnalysisResult');

  const categoryColors = {
    learning: palette[0], coding: palette[1], entertainment: palette[3],
    social: palette[2], tools: palette[5], other: palette[4]
  };
  const categoryNames = {
    learning: '学习', coding: '编程', entertainment: '娱乐',
    social: '社交', tools: '工具', other: '其他'
  };

  // 1. 总结卡片
  let html = `<div class="ai-summary-card"><div class="ai-summary-label">行为总结</div><p>${escapeHtml(analysis.summary || '暂无总结')}</p></div>`;

  // 2. 分类占比条
  const stats = analysis.category_stats || [];
  if (stats.length > 0) {
    const segments = stats.map(s => {
      const color = categoryColors[s.category] || palette[4];
      return `<div class="ai-stacked-segment" style="width:${s.percentage}%;background:${color}"></div>`;
    }).join('');
    const legend = stats.map(s => {
      const color = categoryColors[s.category] || palette[4];
      const name = categoryNames[s.category] || s.category;
      return `<span class="ai-legend-item"><span class="ai-legend-dot" style="background:${color}"></span>${name} <span class="ai-legend-pct">${s.percentage}%</span></span>`;
    }).join('');
    html += `<div class="ai-bar-chart"><div class="ai-bar-chart-title">时间分布</div><div class="ai-stacked-bar">${segments}</div><div class="ai-bar-legend">${legend}</div></div>`;
  }

  // 3. 热门网站表格
  const domains = analysis.top_domains || [];
  if (domains.length > 0) {
    const rows = domains.slice(0, 8).map((d, i) => `<tr><td style="color:var(--muted);font-size:11px;">${i + 1}</td><td class="domain-name">${escapeHtml(d.domain)}</td><td>${d.visits} 次</td><td class="domain-dur">${formatDuration(d.total_duration)}</td></tr>`).join('');
    html += `<div class="ai-table-wrap"><div class="ai-table-title">热门网站</div><table class="ai-table"><thead><tr><th>#</th><th>网站</th><th>访问</th><th>时长</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // 4. 问题卡片
  const issues = (analysis.issues || []).map(issue => `<li class="ai-issue-card">${escapeHtml(issue)}</li>`).join('') || '<li class="ai-issue-card">暂未发现明显问题。</li>';

  // 5. 建议卡片
  const suggestions = (analysis.suggestions || []).map(s => `<li class="ai-suggestion-card">${escapeHtml(s)}</li>`).join('') || '<li class="ai-suggestion-card">暂无建议。</li>';

  html += `<ul class="ai-card-list">${issues}</ul><ul class="ai-card-list">${suggestions}</ul>`;
  container.innerHTML = html;
}
function renderReports(reports) {
  const container = document.getElementById('reportList');
  if (!reports || !reports.length) {
    container.innerHTML = '<div class="empty">暂无历史报告。<br><small>运行 AI 分析后，结果会自动保存为历史报告。</small></div>';
    return;
  }
  const typeLabels = { ai_analysis: 'AI 分析', ai_7d: '7天', ai_14d: '14天', ai_30d: '30天', ai_weekly: '周报', ai_monthly: '月报' };
  container.innerHTML = reports.slice(0, 5).map((report, i) => {
    const typeLabel = typeLabels[report.report_type] || (report.report_type || '分析');
    const date = report.report_date || (report.created_at ? report.created_at.split('T')[0] : '');
    const summary = report.ai_summary || '';
    let issues = [];
    try { issues = JSON.parse(report.ai_issues); } catch { issues = []; }
    if (!Array.isArray(issues)) { try { issues = JSON.parse(issues); } catch { issues = []; } }
    let suggestions = [];
    try { suggestions = JSON.parse(report.ai_suggestions); } catch { suggestions = []; }
    if (!Array.isArray(suggestions)) { try { suggestions = JSON.parse(suggestions); } catch { suggestions = []; } }
    const issuesHtml = issues.length ? issues.map(iss => `<li>${escapeHtml(iss)}</li>`).join('') : '<li>暂无记录的问题</li>';
    const suggestionsHtml = suggestions.length ? suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('') : '<li>暂无记录的建议</li>';
    return `<div class="report-card">
      <div class="report-card-header" role="button" tabindex="0" aria-expanded="false" aria-label="展开报告详情">
        <div class="report-card-meta">
          <span class="report-type-badge">${escapeHtml(typeLabel)}</span>
          <span class="report-date">${escapeHtml(date)}</span>
          ${report.total_duration ? `<span class="report-duration">${formatDuration(report.total_duration)}</span>` : ''}
        </div>
        <div class="report-card-summary">${escapeHtml(summary) || '暂无总结'}</div>
        <div class="report-card-indicator" aria-hidden="true">▼</div>
      </div>
      <div class="report-card-body" role="region">
        <div class="report-card-section">
          <h4>发现的问题</h4>
          <ul>${issuesHtml}</ul>
        </div>
        <div class="report-card-section">
          <h4>优化建议</h4>
          <ul>${suggestionsHtml}</ul>
        </div>
      </div>
    </div>`;
  }).join('');
  // Bind click/keyboard handlers for expandable report cards
  container.querySelectorAll('.report-card-header').forEach(header => {
    function toggleReport() {
      const card = header.closest('.report-card');
      const expanded = card.classList.toggle('expanded');
      header.setAttribute('aria-expanded', String(expanded));
    }
    header.addEventListener('click', toggleReport);
    header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleReport(); } });
  });
}
function renderAdvancedEmpty(message) {
  document.getElementById('blackholeStats').innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  document.getElementById('attentionStats').innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  if (attentionChart) {
    attentionChart.destroy();
    attentionChart = null;
  }
}
async function loadAdvancedInsights() {
  const preferences = await getPreferences();
  await initDataSync();

  if (await cachedCheckConnection()) {
    await dataSync.initUserId();
    const response = await fetch(`${dataSync.apiBaseUrl}/api/advanced-analysis/${dataSync.userId}?days=${preferences.analysisDays}&blackhole_threshold=${preferences.blackholeThresholdMinutes}`);
    if (response.ok) {
      const analysis = await response.json();
      renderBlackholes(analysis.blackholes);
      renderAttentionCurve(analysis.attention_curve);
      return;
    }
    if (response.status !== 404) {
      const error = await response.json();
      throw new Error(error.detail || '高级分析失败');
    }
  }

  // 后端不可用或无云端数据 — 使用本地离线分析
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  if (!browsingData.length) {
    renderAdvancedEmpty('暂无浏览数据，无法进行高级分析。');
    return;
  }
  const localAnalyzer = new LocalAdvancedAnalyzer(preferences.blackholeThresholdMinutes);
  const analysis = localAnalyzer.analyzeAll(browsingData, preferences.blackholeThresholdMinutes);
  renderBlackholes(analysis.blackholes);
  renderAttentionCurve(analysis.attention_curve);
}

async function runComparison() {
  const button = document.getElementById('compareBtn');
  const container = document.getElementById('compareResult');
  setButtonBusy(button, true, '对比中...');
  try {
    await initDataSync();
    if (!(await cachedCheckConnection())) {
      container.innerHTML = '<div class="empty">后端未连接，无法进行周期对比。</div>';
      return;
    }
    await dataSync.initUserId();
    const p1 = document.getElementById('comparePeriod1').value;
    const p2 = document.getElementById('comparePeriod2').value;
    const response = await fetch(`${dataSync.apiBaseUrl}/api/analysis/${dataSync.userId}/compare?period1=${p1}&period2=${p2}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || '对比失败');
    }
    const data = await response.json();
    renderComparison(data, p1, p2);
  } catch (error) {
    container.innerHTML = `<div class="empty">对比失败：${escapeHtml(error.message)}</div>`;
  } finally {
    setButtonBusy(button, false);
  }
}

function renderComparison(data, p1Days, p2Days) {
  const container = document.getElementById('compareResult');
  const dur = data.duration_change_pct;
  const durIcon = dur > 0 ? '+' : '';
  const durColor = dur > 0 ? 'var(--red)' : dur < 0 ? 'var(--green)' : 'var(--muted)';

  let html = `<div class="insight-cards">
    <div class="insight-card"><span>近 ${p1Days} 天 vs ${p2Days} 天前</span><strong style="color:${durColor}">${durIcon}${dur}%</strong><small>总时长变化</small></div>
    <div class="insight-card"><span>近期访问</span><strong>${data.period1.total_visits}</strong><small>${formatDuration(data.period1.total_duration)}</small></div>
    <div class="insight-card"><span>对比期访问</span><strong>${data.period2.total_visits}</strong><small>${formatDuration(data.period2.total_duration)}</small></div>
  </div>`;

  // 分类占比变化
  const cats = Object.entries(data.category_changes).sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta));
  if (cats.length) {
    html += '<div style="margin-top:12px;">';
    for (const [cat, info] of cats) {
      const catName = WebsiteClassifier.CATEGORY_NAMES[cat] || cat;
      const deltaIcon = info.delta > 0 ? '+' : '';
      const deltaColor = info.delta > 0 ? 'var(--red)' : info.delta < 0 ? 'var(--green)' : 'var(--muted)';
      html += `<div class="domain-row"><div><div class="domain-name">${catName}</div><div class="domain-meta">${p1Days}天: ${info.period1_pct}% · ${p2Days}天前: ${info.period2_pct}%</div></div><div style="color:${deltaColor};font-weight:600;font-size:13px;">${deltaIcon}${info.delta}%</div></div>`;
    }
    html += '</div>';
  }

  // 新增/消失域名
  if (data.new_domains.length) {
    html += `<div style="margin-top:12px;"><div style="font-size:12px;font-weight:600;margin-bottom:6px;">近期新增域名 (${data.new_domains.length})</div><div style="font-size:11px;color:var(--muted);">${data.new_domains.map(d => escapeHtml(d)).join('、')}</div></div>`;
  }
  if (data.disappeared_domains.length) {
    html += `<div style="margin-top:8px;"><div style="font-size:12px;font-weight:600;margin-bottom:6px;">消失的域名 (${data.disappeared_domains.length})</div><div style="font-size:11px;color:var(--muted);">${data.disappeared_domains.map(d => escapeHtml(d)).join('、')}</div></div>`;
  }

  container.innerHTML = html;
}

async function loadReports() {
  try {
    await initDataSync();
    if (!(await cachedCheckConnection())) {
      renderReports([]);
      return;
    }
    await dataSync.initUserId();
    const response = await fetch(`${dataSync.apiBaseUrl}/api/reports/${dataSync.userId}?limit=5`);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('历史报告加载失败:', response.status, errorText);
      renderReports([]);
      return;
    }
    renderReports(await response.json());
  } catch (error) {
    console.error('历史报告加载失败:', error);
    renderReports([]);
  }
}
async function loadLatestAIAnalysis() {
  const container = document.getElementById('aiAnalysisResult');
  try {
    await initDataSync();
    if (!(await cachedCheckConnection())) return;
    await dataSync.initUserId();
    const response = await fetch(`${dataSync.apiBaseUrl}/api/reports/${dataSync.userId}?limit=1`);
    if (!response.ok) return;
    const reports = await response.json();
    if (reports && reports.length > 0) {
      const latest = reports[0];
      if (latest.ai_summary || latest.ai_issues || latest.ai_suggestions) {
        const issues = (() => { try { return JSON.parse(latest.ai_issues); } catch { return [latest.ai_issues]; } })();
        const suggestions = (() => { try { return JSON.parse(latest.ai_suggestions); } catch { return [latest.ai_suggestions]; } })();
        let parsedCategoryStats = [];
        try { parsedCategoryStats = JSON.parse(latest.category_stats); } catch { parsedCategoryStats = []; }
        renderAIAnalysis({ summary: latest.ai_summary || '', issues: Array.isArray(issues) ? issues : [], suggestions: Array.isArray(suggestions) ? suggestions : [], category_stats: Array.isArray(parsedCategoryStats) ? parsedCategoryStats : [], top_domains: latest.top_domains || [] });
        return;
      }
    }
    container.innerHTML = '<div class="empty">尚未生成 AI 分析，前往"操作"页执行 AI 分析。</div>';
  } catch {
    container.innerHTML = '<div class="empty">尚未生成 AI 分析，前往"操作"页执行 AI 分析。</div>';
  }
}
async function refreshInsights() {
  const button = document.getElementById('refreshInsightsBtn');
  setButtonBusy(button, true, '刷新中...');
  try {
    await loadAdvancedInsights();
    await loadReports();
    await loadLatestAIAnalysis();
    setNote('洞察已刷新', 'success');
    log('洞察页已刷新');
  } catch (error) {
    setNote(`洞察刷新失败：${error.message}`, 'danger');
    log(`洞察刷新失败：${error.message}`);
  } finally {
    setButtonBusy(button, false);
  }
}

async function loadAnalytics() {
  const storage = await chrome.storage.local.get(['browsingData', 'classificationOverrides', 'analysisDays']);
  const browsingData = storage.browsingData || [];
  if (!browsingData.length) {
    renderMetrics([]);
    renderCategoryList([], new WebsiteClassifier());
    currentClassifiedData = [];
    renderDomainList([]);
    renderTrendChart([]);
    renderHourlyChart([]);
    return { count: 0, topCategoryText: '暂无本地浏览数据。' };
  }
  const processor = new DataProcessor(browsingData);
  const cleanedData = processor.clean().getData();
  const classificationOverrides = storage.classificationOverrides || {};
  const classifier = new WebsiteClassifier(classificationOverrides);
  const classifiedData = classifier.classifyBatch(cleanedData);
  const analyzer = new StatisticsAnalyzer(classifiedData);
  const categoryStats = analyzer.analyzeByCategory();
  const hourlyDist = analyzer.getHourlyDistribution();
  const analysisDays = Number(storage.analysisDays || DEFAULT_PREFERENCES.analysisDays);
  const dailyTrend = calculateDailyTrend(classifiedData, analysisDays);
  // Window data to analysisDays for metrics display
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - analysisDays);
  const windowStartStr = windowStart.toISOString().split('T')[0];
  const windowedData = classifiedData.filter(r => r.date >= windowStartStr);
  currentClassifiedData = classifiedData;
  renderMetrics(windowedData);
  renderCategoryList(categoryStats, classifier);
  renderFilteredDomains();
  renderTrendChart(dailyTrend);
  renderHourlyChart(hourlyDist);
  const topCategoryText = categoryStats[0] ? `${classifier.getCategoryInfo(categoryStats[0].category).name}占比最高，约 ${Number(categoryStats[0].percentage).toFixed(1)}%。` : '分类数据正在积累。';
  return { count: classifiedData.length, topCategoryText };
}

async function refreshDashboard() {
  const preferences = await loadPreferences();
  await initDataSync();
  const { userId, lastSyncTime } = await chrome.storage.local.get(['userId', 'lastSyncTime']);
  const analytics = await loadAnalytics();
  const connected = await cachedCheckConnection();
  const syncText = lastSyncTime ? `上次同步：${new Date(lastSyncTime).toLocaleString('zh-CN')}` : '尚未同步。';
  const days = preferences.analysisDays;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  document.getElementById('statusNote').textContent = `${connected ? '云服务器连接正常。' : '无法连接云服务器。'} 已载入 ${analytics.count} 条本地记录。${analytics.topCategoryText} ${syncText} 当前分析窗口：${days} 天。`;
  document.getElementById('analysisWindowDesc').textContent = `${greeting} — 查看最近 ${days} 天的访问、分类、时段和高频站点。`;
  document.getElementById('weekVisitsLabel').textContent = `${days} 天访问`;
  document.getElementById('trendChartTitle').textContent = `${days} 天趋势`;
  await loadGoals();
  if (activeSidebarTab === 'insights') {
    await loadAdvancedInsights();
    await loadReports();
  }
  if (activeSidebarTab === 'settings') {
    renderOverrideRules();
  }
  log(`刷新完成：${analytics.count} 条记录，用户 ${userId ? userId.slice(0, 10) + '…' : '未生成'}`);
}
async function syncNow() {
  const button = document.getElementById('syncBtn');
  setButtonBusy(button, true, '同步中...');
  try { await initDataSync(); log('开始同步本地数据...'); const result = await dataSync.syncLocalData(); setNote(result.message || '同步完成', 'success'); log(`同步完成：${result.message || '成功'}`); await refreshDashboard(); } catch (error) { setNote(`同步失败：${error.message}`, 'danger'); log(`同步失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function runAIAnalysis() {
  const button = document.getElementById('aiBtn');
  setButtonBusy(button, true, '分析中...');
  try { const preferences = await getPreferences(); await initDataSync(); if (!(await cachedCheckConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); log('开始 AI 分析...'); const response = await fetch(`${dataSync.apiBaseUrl}/api/ai-analysis/${dataSync.userId}?days=${preferences.analysisDays}`, { method: 'POST' }); if (!response.ok) { const error = await response.json(); throw new Error(error.detail || 'AI 分析失败'); } const analysis = await response.json(); renderAIAnalysis(analysis); await loadReports(); setNote(`AI 分析完成：${analysis.summary}`, 'success'); log(`AI 总结：${analysis.summary}`); await switchSidebarTab('insights', { focusPanel: true }); } catch (error) { setNote(`AI 分析失败：${error.message}`, 'danger'); log(`AI 分析失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function createGoal() {
  const button = document.getElementById('createGoalBtn');
  setButtonBusy(button, true, '添加中...');
  try { await initDataSync(); if (!(await cachedCheckConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); const goalType = document.getElementById('goalTypeSelect').value; const durationMinutes = parseInt(document.getElementById('goalDurationInput').value, 10); if (!durationMinutes || durationMinutes <= 0) throw new Error('请输入有效的目标时长'); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal_type: goalType, category: categoryMap[goalType], target_duration: durationMinutes * 60, date: todayString() }) }); if (!response.ok) { const error = await response.json(); throw new Error(error.detail || '创建目标失败'); } setNote('目标已添加', 'success'); log(`已添加目标：${goalTypeNames[goalType]} ${durationMinutes} 分钟`); await loadGoals(); } catch (error) { setNote(`创建目标失败：${error.message}`, 'danger'); log(`创建目标失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function loadGoals() {
  const list = document.getElementById('goalList');
  try { await initDataSync(); if (!(await cachedCheckConnection())) { list.innerHTML = '<div class="goal-card"><div><strong>云服务器未连接</strong><p class="muted">连接后可管理目标。</p></div></div>'; return; } await dataSync.initUserId(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}?date=${todayString()}&is_active=1`); if (!response.ok) throw new Error('获取目标失败'); const goals = await response.json(); if (!goals.length) { list.innerHTML = '<div class="goal-card"><div><strong>还没有目标</strong><p class="muted">设一个今日目标，看看自己能走多远。</p></div></div>'; return; } list.innerHTML = goals.map(goal => { const pct = Number(goal.progress_percentage || 0); const achieved = pct >= 100; const warning = pct >= 80 && !achieved; const barClass = achieved ? 'achieved' : (warning ? 'warning' : ''); return `<div class="goal-card ${achieved ? 'achieved' : ''}"><div><strong>${goalTypeNames[goal.goal_type] || goal.goal_type}</strong><p class="muted">${formatDuration(goal.current_progress)} / ${formatDuration(goal.target_duration)} · ${pct.toFixed(1)}%${achieved ? ' <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;"><path d="M9 12l2 2 4-4"/></svg>' : ''}</p></div><div class="button-row compact"><button class="secondary" data-goal-edit-id="${goal.id}" data-goal-duration="${Math.round(goal.target_duration / 60)}">编辑</button><button class="ghost" data-goal-disable-id="${goal.id}">停用</button><button class="danger" data-goal-id="${goal.id}">删除</button></div><div class="bar-track"><div class="bar-fill ${barClass}" style="width: ${Math.min(pct, 100)}%"></div></div></div>`; }).join(''); list.querySelectorAll('[data-goal-id]').forEach(button => button.addEventListener('click', () => deleteGoal(button.dataset.goalId))); list.querySelectorAll('[data-goal-disable-id]').forEach(button => button.addEventListener('click', () => deactivateGoal(button.dataset.goalDisableId))); list.querySelectorAll('[data-goal-edit-id]').forEach(button => button.addEventListener('click', () => editGoalDuration(button.dataset.goalEditId, button.dataset.goalDuration))); } catch (error) { list.innerHTML = `<div class="goal-card"><div><strong>加载失败</strong><p class="muted">${error.message}</p></div></div>`; }
}
async function refreshGoalProgress() {
  const button = document.getElementById('refreshGoalsBtn');
  setButtonBusy(button, true, '刷新中...');
  try { await initDataSync(); if (!(await cachedCheckConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}/update-progress?date=${encodeURIComponent(todayString())}`, { method: 'POST' }); if (!response.ok) throw new Error('刷新目标进度失败'); setNote('目标进度已刷新', 'success'); log('目标进度已刷新'); await loadGoals(); } catch (error) { setNote(`目标刷新失败：${error.message}`, 'danger'); log(`目标刷新失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function editGoalDuration(goalId, currentMinutes) {
  const value = prompt('新的目标时长（分钟）', currentMinutes);
  if (value === null) return;
  const minutes = Number(value);
  if (!minutes || minutes <= 0) { setNote('请输入有效的目标时长', 'danger'); return; }
  try { await initDataSync(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_duration: Math.round(minutes * 60) }) }); if (!response.ok) throw new Error('编辑失败'); setNote('目标已更新', 'success'); log(`已更新目标 #${goalId}`); await loadGoals(); } catch (error) { setNote(`目标编辑失败：${error.message}`, 'danger'); log(`目标编辑失败：${error.message}`); }
}
async function deactivateGoal(goalId) {
  if (!confirm('确定停用这个目标吗？停用后不会继续统计今日进度。')) return;
  try { await initDataSync(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: 0 }) }); if (!response.ok) throw new Error('停用失败'); setNote('目标已停用', 'success'); log(`已停用目标 #${goalId}`); await loadGoals(); } catch (error) { setNote(`目标停用失败：${error.message}`, 'danger'); log(`目标停用失败：${error.message}`); }
}
async function deleteGoal(goalId) {
  if (!confirm('确定删除这个目标吗？')) return;
  try { await initDataSync(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'DELETE' }); if (!response.ok) throw new Error('删除失败'); setNote('目标已删除', 'success'); log(`已删除目标 #${goalId}`); await loadGoals(); } catch (error) { setNote(`删除目标失败：${error.message}`, 'danger'); log(`删除目标失败：${error.message}`); }
}
let _autoSaveTimer = null;
let _settingsStatusTimer = null;
function autoSaveSettings() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(async () => {
    const preferences = readPreferencesFromForm();
    await chrome.storage.local.set(preferences);
    await initDataSync();
    showSettingsStatus('已自动保存');
    log(`设置已自动保存`);
  }, 500);
}
function showSettingsStatus(text) {
  const el = document.getElementById('settingsStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(_settingsStatusTimer);
  _settingsStatusTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}
async function resetApiBaseUrl() { const button = document.getElementById('resetApiBtn'); setButtonBusy(button, true, '恢复中...'); try { await chrome.storage.local.set({ ...DEFAULT_PREFERENCES }); await initDataSync(); await loadPreferences(); setNote('已恢复默认插件设置', 'success'); log('已恢复默认插件设置'); await refreshDashboard(); } finally { setButtonBusy(button, false); } }
async function testApiConnection() { const button = document.getElementById('testApiBtn'); setButtonBusy(button, true, '测试中...'); try { await initDataSync(); const connected = await dataSync.checkConnection(); _connectionCache = { result: connected, time: Date.now() }; setNote(connected ? '连接成功' : '连接失败，请检查云服务器服务', connected ? 'success' : 'danger'); log(connected ? '后端连接测试成功' : '后端连接测试失败'); } finally { setButtonBusy(button, false); } }
async function exportJson() { const { browsingData = [] } = await chrome.storage.local.get('browsingData'); const blob = new Blob([JSON.stringify(browsingData, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `browsemind-local-${todayString()}.json`; a.click(); URL.revokeObjectURL(url); setNote('本地 JSON 已导出', 'success'); log(`已导出 ${browsingData.length} 条本地记录`); }

async function exportCloudData() {
  const button = document.getElementById('exportCloudBtn');
  setButtonBusy(button, true, '导出中...');
  try {
    await initDataSync();
    if (!(await cachedCheckConnection())) {
      setNote('后端未连接，无法导出云端数据', 'danger');
      log('云端导出失败：后端未连接');
      return;
    }
    await dataSync.initUserId();
    const days = document.getElementById('exportDaysSelect').value;
    const url = `${dataSync.apiBaseUrl}/api/export/${dataSync.userId}?format=json&days=${days}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`导出失败 (${response.status})`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `browsemind-cloud-${todayString()}.json`;
    a.click();
    URL.revokeObjectURL(blobUrl);
    setNote('云端数据已导出', 'success');
    log(`云端数据已导出（${days > 0 ? days + ' 天' : '全部'}）`);
  } catch (error) {
    setNote(`云端导出失败：${error.message}`, 'danger');
    log(`云端导出失败：${error.message}`);
  } finally {
    setButtonBusy(button, false);
  }
}

function initImport() {
  const importBtn = document.getElementById('importBtn');
  const fileInput = document.getElementById('importFileInput');
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleImportFile);
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fileNameEl = document.getElementById('importFileName');
  const importNote = document.getElementById('importNote');
  fileNameEl.textContent = file.name;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // 支持两种格式：纯数组（本地导出）或 { records: [...] }（云端导出）
    let importedRecords = [];
    let importedOverrides = null;
    if (Array.isArray(data)) {
      importedRecords = data;
    } else if (data.records && Array.isArray(data.records)) {
      importedRecords = data.records;
      // 云端导出不包含 classificationOverrides，跳过
    } else {
      throw new Error('无法识别的数据格式');
    }

    if (!importedRecords.length) {
      importNote.textContent = '文件中没有可导入的记录';
      importNote.className = 'note visible';
      setTimeout(() => importNote.classList.remove('visible'), 3000);
      return;
    }

    // 合并策略：本地优先，新数据追加
    const { browsingData = [] } = await chrome.storage.local.get('browsingData');
    const existingKeys = new Set(browsingData.map(r => `${r.url}-${r.visitTime}`));
    let added = 0;
    for (const record of importedRecords) {
      const key = `${record.url}-${record.visitTime}`;
      if (!existingKeys.has(key)) {
        // 补充可能缺失的字段
        if (!record.domain && record.url) {
          try { record.domain = new URL(record.url).hostname.replace(/^www\./, ''); } catch {}
        }
        if (!record.category) record.category = 'other';
        if (!record.date && record.visitTime) {
          record.date = new Date(record.visitTime).toISOString().split('T')[0];
        }
        browsingData.push(record);
        existingKeys.add(key);
        added++;
      }
    }

    await chrome.storage.local.set({ browsingData });
    importNote.textContent = `导入完成：新增 ${added} 条，跳过 ${importedRecords.length - added} 条重复`;
    importNote.className = 'note visible success';
    log(`数据导入完成：+${added} / ${importedRecords.length}`);
    setTimeout(() => importNote.classList.remove('visible'), 5000);
    await refreshDashboard();
  } catch (error) {
    importNote.textContent = `导入失败：${error.message}`;
    importNote.className = 'note visible danger';
    log(`数据导入失败：${error.message}`);
    setTimeout(() => importNote.classList.remove('visible'), 5000);
  } finally {
    e.target.value = '';
  }
}

async function clearLocalData() { if (!confirm('确定清空本地浏览数据吗？此操作不可恢复。')) return; await chrome.storage.local.set({ browsingData: [] }); setNote('本地数据已清空', 'success'); log('本地浏览数据已清空'); await refreshDashboard(); }
function moveSidebarTabFocus(currentTab, direction) {
  const currentIndex = SIDEBAR_TABS.indexOf(currentTab);
  const nextIndex = (currentIndex + direction + SIDEBAR_TABS.length) % SIDEBAR_TABS.length;
  const nextTab = SIDEBAR_TABS[nextIndex];
  const nextButton = document.querySelector(`[data-sidebar-tab="${nextTab}"]`);
  if (nextButton) {
    switchSidebarTab(nextTab);
    nextButton.focus();
  }
}
function bindEvents() { document.getElementById('refreshBtnActions').addEventListener('click', refreshDashboard); document.getElementById('refreshInsightsBtn').addEventListener('click', refreshInsights); document.getElementById('categoryFilterInput').addEventListener('change', renderFilteredDomains); document.getElementById('domainFilterInput').addEventListener('input', () => {
  clearTimeout(domainFilterTimer);
  domainFilterTimer = setTimeout(renderFilteredDomains, 250);
}); document.getElementById('syncBtn').addEventListener('click', syncNow); document.getElementById('aiBtn').addEventListener('click', runAIAnalysis); document.getElementById('createGoalBtn').addEventListener('click', createGoal); document.getElementById('refreshGoalsBtn').addEventListener('click', refreshGoalProgress); document.getElementById('resetApiBtn').addEventListener('click', resetApiBaseUrl); document.getElementById('testApiBtn').addEventListener('click', testApiConnection); document.getElementById('exportJsonBtn').addEventListener('click', exportJson); document.getElementById('exportCloudBtn').addEventListener('click', exportCloudData); document.getElementById('clearLocalBtn').addEventListener('click', clearLocalData); initImport(); document.getElementById('compareBtn').addEventListener('click', runComparison); document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
document.getElementById('themeToggleBtn').addEventListener('click', cycleTheme);
document.querySelectorAll('[data-pref]').forEach(el => {
  const evt = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
  el.addEventListener(evt, autoSaveSettings);
});
document.getElementById('notificationsEnabledInput').addEventListener('change', updateInterventionWarning);
document.getElementById('interventionsEnabledInput').addEventListener('change', updateInterventionWarning);
document.querySelectorAll('[data-sidebar-tab]').forEach(button => { button.addEventListener('click', () => switchSidebarTab(button.dataset.sidebarTab, { focusPanel: true })); button.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); moveSidebarTabFocus(button.dataset.sidebarTab, 1); } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); moveSidebarTabFocus(button.dataset.sidebarTab, -1); } else if (event.key === 'Home') { event.preventDefault(); const firstButton = document.querySelector('[data-sidebar-tab="dashboard"]'); if (firstButton) { switchSidebarTab('dashboard'); firstButton.focus(); } } else if (event.key === 'End') { event.preventDefault(); const lastTab = SIDEBAR_TABS[SIDEBAR_TABS.length - 1]; const lastButton = document.querySelector(`[data-sidebar-tab="${lastTab}"]`); if (lastButton) { switchSidebarTab(lastTab); lastButton.focus(); } } }); }); }

const _dashLoadingMsgs = ['正在唤醒分析引擎...', '整理你的浏览足迹...', '数据马上就绪...'];
let _dashLoadTimer = null;
function startDashLoadingRotation() {
  const el = document.getElementById('statusNote');
  if (!el) return;
  let i = 0;
  _dashLoadTimer = setInterval(() => { i = (i + 1) % _dashLoadingMsgs.length; el.textContent = _dashLoadingMsgs[i]; }, 1800);
}
function stopDashLoadingRotation() { clearInterval(_dashLoadTimer); _dashLoadTimer = null; }

document.addEventListener('DOMContentLoaded', async () => { startDashLoadingRotation(); await loadSidebarState(); bindEvents(); applySidebarState(); await loadTheme(); await switchSidebarTab(activeSidebarTab); await refreshDashboard(); stopDashLoadingRotation(); });
window.addEventListener('resize', () => {
  if (activeSidebarTab === 'dashboard') {
    if (trendChart) trendChart.resize();
    if (hourlyChart) hourlyChart.resize();
  }
});
