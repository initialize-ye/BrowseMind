// getPreferences(), DEFAULT_API_BASE_URL, DEFAULT_PREFERENCES, escapeHtml are defined in dataSync.js
// getChartPalette, invalidateChartPalette, prefersReducedMotion, chartAnimation, CATEGORY_MAP, GOAL_TYPE_NAMES, todayString, getGridColor are in shared.js

let palette = getChartPalette();
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
let _chartsRendering = false;
let activeSidebarTab = 'dashboard';
let isSidebarCollapsed = false;
let attentionChart = null;
let habitTrendChart = null;
let currentClassifiedData = [];
let domainFilterTimer = null;
const SIDEBAR_TABS = ['dashboard', 'insights', 'actions', 'goals', 'settings'];

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
  invalidateChartPalette(); // Clear cache before re-reading
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
      const inactiveColor = getComputedStyle(document.documentElement).getPropertyValue('--surface-3').trim() || '#e5e5e5';
      const active = hourlyChart._activeHours || hourlyChart.data.datasets[0].data.map(v => v > 0);
      hourlyChart.data.datasets[0].backgroundColor = active.map(on => on ? accentColor : inactiveColor);
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
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const { themeMode: current = 'light' } = await chrome.storage.local.get('themeMode');
    if (current === 'system') applyTheme('system');
  });
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
  const classMap = { success: 'success', danger: 'danger', warning: 'warning' };
  note.className = `note ${classMap[type] || ''}`;
  note.textContent = message;

  // Also show a toast visible from any tab
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const bgMap = { success: 'var(--green-soft)', danger: 'var(--red-soft)', warning: 'var(--yellow-soft)', info: 'var(--accent-soft)' };
  const colorMap = { success: 'var(--green)', danger: 'var(--red)', warning: 'var(--yellow)', info: 'var(--accent)' };
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
  const { dashboardSidebarCollapsed = false, dashboardActiveSidebarTab = 'dashboard' } = await chrome.storage.local.get(['dashboardSidebarCollapsed', 'dashboardActiveSidebarTab']);
  isSidebarCollapsed = Boolean(dashboardSidebarCollapsed);
  activeSidebarTab = dashboardActiveSidebarTab;
}
function applySidebarState() {
  document.body.classList.toggle('sidebar-collapsed', isSidebarCollapsed);
  const toggleButton = document.getElementById('sidebarToggleBtn');
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', isSidebarCollapsed ? 'false' : 'true');
    toggleButton.setAttribute('aria-label', isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏');
    toggleButton.innerHTML = WebsiteClassifier.UI_ICONS.menu;
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
  // Force layout recalculation after CSS transition (only once, post-transition)
  const layout = document.querySelector('.layout');
  setTimeout(() => {
    if (layout) layout.offsetHeight; // Trigger reflow after transition completes
    if (trendChart) trendChart.resize();
    if (hourlyChart) hourlyChart.resize();
    if (attentionChart) attentionChart.resize();
    requestAnimationFrame(() => {
      if (trendChart) trendChart.resize();
      if (hourlyChart) hourlyChart.resize();
      if (attentionChart) attentionChart.resize();
    });
  }, 320);
}
async function switchSidebarTab(tab, options = {}) {
  if (!SIDEBAR_TABS.includes(tab)) {
    tab = 'dashboard';
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
  try {
    await chrome.storage.local.set({ dashboardActiveSidebarTab: tab });
  } catch (e) {
    console.warn('保存标签状态失败:', e);
  }
  if (tab === 'dashboard') {
    // 重新渲染图表（从其他标签切回时）
    if ((!trendChart || !hourlyChart) && !_chartsRendering) {
      _chartsRendering = true;
      try {
        const storage = await chrome.storage.local.get(['browsingData', 'classificationOverrides', 'classificationFeedback', 'analysisDays']);
        const browsingData = validateBrowsingData(storage.browsingData);
        if (browsingData.length) {
          const processor = new DataProcessor(browsingData);
          const cleanedData = processor.clean().getData();
          const classifier = new WebsiteClassifier(storage.classificationOverrides || {}, storage.classificationFeedback || {});
          const classifiedData = classifier.classifyBatch(cleanedData);
          const analyzer = new StatisticsAnalyzer(classifiedData);
          const analysisDays = Number(storage.analysisDays || DEFAULT_PREFERENCES.analysisDays);
          const dailyTrend = calculateDailyTrend(classifiedData, analysisDays);
          const hourlyDist = analyzer.getHourlyDistribution();
          renderTrendChart(dailyTrend);
          renderHourlyChart(hourlyDist);
        }
      } finally {
        _chartsRendering = false;
      }
    } else if (!_chartsRendering) {
      requestAnimationFrame(() => {
        if (trendChart) trendChart.resize();
        if (hourlyChart) hourlyChart.resize();
      });
    }
  } else {
    // 离开仪表盘标签时销毁图表释放内存
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    if (hourlyChart) { hourlyChart.destroy(); hourlyChart = null; }
  }
  if (tab === 'settings') {
    try { await loadPreferences(); } catch (e) { console.warn('加载设置失败:', e); }
    renderOverrideRules();
  }
  if (tab === 'insights') {
    loadLatestAIAnalysis().catch(() => {});
    loadAdvancedInsights().catch(() => {});
    loadReports().catch(() => {});
    loadFocusStats().catch(() => {});
    loadLeaderboard().catch(() => {});
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
  document.getElementById('quietHoursStartInput').value = preferences.quietHoursStart || '';
  document.getElementById('quietHoursEndInput').value = preferences.quietHoursEnd || '';
  document.getElementById('focusDurationsInput').value = preferences.focusDurations || '25,45,60';
  document.getElementById('dailySummaryEnabledInput').checked = Boolean(preferences.dailySummaryEnabled);
  document.getElementById('dailySummaryHourInput').value = preferences.dailySummaryHour || 21;
  document.getElementById('continuousEntertainmentInput').value = preferences.continuousEntertainmentMinutes || 20;
  document.getElementById('learningDropAlertEnabledInput').checked = Boolean(preferences.learningDropAlertEnabled);
  document.getElementById('adaptiveThresholdEnabledInput').checked = Boolean(preferences.adaptiveThresholdEnabled);
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
    interventionCooldownMinutes: Math.max(1, Number(document.getElementById('interventionCooldownInput').value || 30)),
    quietHoursStart: document.getElementById('quietHoursStartInput').value || '',
    quietHoursEnd: document.getElementById('quietHoursEndInput').value || '',
    focusDurations: document.getElementById('focusDurationsInput').value.trim() || '25,45,60',
    dailySummaryEnabled: document.getElementById('dailySummaryEnabledInput').checked,
    dailySummaryHour: Math.max(0, Math.min(23, Number(document.getElementById('dailySummaryHourInput').value || 21))),
    continuousEntertainmentMinutes: Math.max(5, Math.min(120, Number(document.getElementById('continuousEntertainmentInput').value || 20))),
    learningDropAlertEnabled: document.getElementById('learningDropAlertEnabledInput').checked,
    adaptiveThresholdEnabled: document.getElementById('adaptiveThresholdEnabledInput').checked
  };
}
async function initDataSync() {
  const apiBaseUrl = await getApiBaseUrl();
  if (!dataSync || dataSync.apiBaseUrl !== apiBaseUrl) {
    dataSync = new DataSync(apiBaseUrl);
    _connectionCache = { result: null, time: 0 };
  }
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
  // 记录分类反馈
  await saveClassificationFeedback(domain, category);
}
async function saveClassificationFeedback(domain, category) {
  const { classificationFeedback = {} } = await chrome.storage.local.get('classificationFeedback');
  const key = domain.toLowerCase();
  if (!classificationFeedback[key]) {
    classificationFeedback[key] = { category, count: 0, lastTime: 0 };
  }
  classificationFeedback[key].count++;
  classificationFeedback[key].category = category;
  classificationFeedback[key].lastTime = Date.now();
  await chrome.storage.local.set({ classificationFeedback });
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
      const encDomain = domain.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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
  let todayVisits = 0, todayDuration = 0;
  const domains = new Set();
  for (const r of data) {
    if (r.domain) domains.add(r.domain);
    if (r.date === today) {
      todayVisits++;
      todayDuration += r.duration || 0;
    }
  }
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  document.getElementById('metricTodayVisits').textContent = todayVisits;
  document.getElementById('metricTodayDuration').textContent = formatDuration(todayDuration);
  document.getElementById('metricWeekVisits').textContent = data.length;
  document.getElementById('metricUniqueSites').textContent = domains.size;
}
function renderHabitCard(classifiedData) {
  const card = document.getElementById('habitCard');
  const content = document.getElementById('habitCardContent');
  if (!card || !content) return;
  try {
    const scorer = new HabitScorer(classifiedData);
    const score = scorer.computeDailyScore(todayString());
    const productivity = scorer.computeProductivityIndex(7);
    const recommendation = scorer.getRecommendation(score);
    const scoreColor = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--red)';
    const prodPct = Math.round(productivity * 100);
    content.innerHTML = `<div style="text-align:center;min-width:80px;"><div style="font-size:42px;font-weight:800;letter-spacing:-0.04em;color:${scoreColor};line-height:1;">${score ?? '--'}</div><div style="font-size:11px;color:var(--muted);margin-top:4px;">今日评分</div></div><div style="flex:1;min-width:0;"><div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-2);"><div><span style="font-size:11px;color:var(--muted);">生产力指数</span><div style="font-size:18px;font-weight:700;color:var(--accent);">${prodPct}%</div></div></div><p style="font-size:13px;color:var(--muted);line-height:1.5;">${escapeHtml(recommendation)}</p></div>`;
    card.style.display = '';

    // 渲染 14 天趋势图
    const history = scorer.computeScoreHistory(14);
    renderHabitTrendChart(history);
  } catch (e) {
    console.warn('习惯评分渲染失败:', e);
    card.style.display = 'none';
  }
}
function renderHabitTrendChart(history) {
  const canvas = document.getElementById('habitTrendChart');
  if (!canvas || !history || history.length < 2) { if (canvas) canvas.style.display = 'none'; return; }
  canvas.style.display = '';
  if (habitTrendChart) { habitTrendChart.destroy(); habitTrendChart = null; }
  const ctx = canvas.getContext('2d');
  const labels = history.map(h => h.date.slice(5));
  const data = history.map(h => h.score);
  const palette = getChartPalette();
  habitTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '评分',
        data,
        borderColor: palette[0],
        backgroundColor: palette[0] + '18',
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      plugins: {
        legend: { display: false },
        annotation: undefined
      },
      scales: {
        y: { min: 0, max: 100, grid: { color: getGridColor() }, ticks: { stepSize: 25 } },
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } }
      }
    },
    plugins: [{
      id: 'refLines',
      afterDraw(chart) {
        const { ctx: c, chartArea, scales } = chart;
        const y70 = scales.y.getPixelForValue(70);
        const y40 = scales.y.getPixelForValue(40);
        c.save();
        c.setLineDash([4, 4]);
        c.lineWidth = 1;
        c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--green').trim() || '#22c55e';
        c.beginPath(); c.moveTo(chartArea.left, y70); c.lineTo(chartArea.right, y70); c.stroke();
        c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim() || '#eab308';
        c.beginPath(); c.moveTo(chartArea.left, y40); c.lineTo(chartArea.right, y40); c.stroke();
        c.restore();
      }
    }]
  });
}
let domainTrendChart = null;

function showDomainDetail(domain) {
  const modal = document.getElementById('domainDetailModal');
  const title = document.getElementById('domainDetailTitle');
  const stats = document.getElementById('domainDetailStats');
  const recordsDiv = document.getElementById('domainDetailRecords');
  if (!modal || !currentClassifiedData.length) return;

  const records = currentClassifiedData.filter(r => r.domain === domain).sort((a, b) => (a.visitTime || 0) - (b.visitTime || 0));
  if (!records.length) return;

  const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
  const totalVisits = records.length;
  const firstVisit = records[0].date || '';
  const lastVisit = records[records.length - 1].date || '';
  const catName = CATEGORY_MAP[records[0].category] || '其他';

  title.textContent = domain;
  stats.innerHTML = `<div style="flex:1;min-width:60px;text-align:center;"><div style="font-size:22px;font-weight:700;color:var(--accent);">${formatDuration(totalDuration)}</div><div style="font-size:11px;color:var(--muted);">总时长</div></div><div style="flex:1;min-width:60px;text-align:center;"><div style="font-size:22px;font-weight:700;">${totalVisits}</div><div style="font-size:11px;color:var(--muted);">访问次数</div></div><div style="flex:1;min-width:60px;text-align:center;"><div style="font-size:14px;font-weight:600;">${escapeHtml(catName)}</div><div style="font-size:11px;color:var(--muted);">分类</div></div><div style="flex:1;min-width:60px;text-align:center;"><div style="font-size:13px;">${firstVisit} ~ ${lastVisit}</div><div style="font-size:11px;color:var(--muted);">时间范围</div></div>`;

  // 每日趋势
  const dayMap = {};
  records.forEach(r => { const d = r.date || ''; if (d) dayMap[d] = (dayMap[d] || 0) + (r.duration || 0); });
  const history = Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, dur]) => ({ date, duration: Math.round(dur / 60) }));
  renderDomainTrendChart(history);

  // 最近记录
  recordsDiv.innerHTML = records.slice(-20).reverse().map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${escapeHtml(r.title || r.url || '')}</span><span style="color:var(--muted);white-space:nowrap;margin-left:8px;">${formatDuration(r.duration || 0)}</span></div>`).join('');

  modal.style.display = 'flex';
}

function renderDomainTrendChart(history) {
  const canvas = document.getElementById('domainTrendChart');
  if (!canvas || !history || history.length < 2) { if (canvas) canvas.style.display = 'none'; return; }
  canvas.style.display = '';
  if (domainTrendChart) { domainTrendChart.destroy(); domainTrendChart = null; }
  const ctx = canvas.getContext('2d');
  const palette = getChartPalette();
  domainTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date.slice(5)),
      datasets: [{ label: '分钟', data: history.map(h => h.duration), borderColor: palette[0], backgroundColor: palette[0] + '18', tension: 0.35, fill: true, pointRadius: 3, pointHoverRadius: 5 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: getGridColor() } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } } }
    }
  });
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
const DOMAIN_PAGE_SIZE = 50;
let _allDomains = [];
let _domainPage = 1;

function renderDomainList(domains) {
  _allDomains = domains;
  _domainPage = 1;
  _renderDomainPage();
}

function _renderDomainPage() {
  const container = document.getElementById('domainList');
  if (!_allDomains.length) {
    container.innerHTML = '<div class="empty">暂无站点数据。</div>';
    return;
  }
  const page = _allDomains.slice(0, _domainPage * DOMAIN_PAGE_SIZE);
  container.innerHTML = page.map(domain => {
    const encDomain = (domain.domain || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const encCat = (domain.category || 'other').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<div class="domain-row"><div><div class="domain-name" data-detail-domain="${encDomain}" style="cursor:pointer;" title="点击查看站点详情">${escapeHtml(domain.domain)}</div><div class="domain-meta">${domain.visits} 次访问 · ${escapeHtml(domain.categoryName || '全部分类')}</div></div><div class="domain-meta"><span>${formatDuration(domain.duration)}</span> <button class="ghost" data-correct-domain="${encDomain}" data-correct-cat="${encCat}" style="min-height:28px;padding:2px 8px;font-size:11px;">修改分类</button></div></div>`;
  }).join('');
  if (page.length < _allDomains.length) {
    container.innerHTML += `<div style="text-align:center;padding:10px;"><button class="ghost" id="loadMoreDomains" style="font-size:12px;min-height:32px;">加载更多 (${_allDomains.length - page.length} 条)</button></div>`;
    document.getElementById('loadMoreDomains').addEventListener('click', () => {
      _domainPage++;
      _renderDomainPage();
    });
  }
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
  const inactiveColor = getComputedStyle(document.documentElement).getPropertyValue('--surface-3').trim() || '#e5e5e5';
  const bgColors = activeHours.map(active => active ? accentColor : inactiveColor);
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

// ==================== 图表切换器 ====================
let _dashboardActiveChart = 'trend';
let _dashboardChartSwitcherBound = false;

function switchDashboardChart(chartType) {
  _dashboardActiveChart = chartType;
  const tabs = document.querySelectorAll('#dashboardChartTabs .chart-tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.chart === chartType));
  const desc = document.getElementById('trendChartDesc');
  const titles = { trend: ['趋势', '时长与访问次数'], radar: ['雷达', '本周 vs 上周分类对比'], sunburst: ['层级', '分类 → 域名分布'], scatter: ['散点', '访问时间 vs 停留时长'] };
  const [title, descText] = titles[chartType] || titles.trend;
  document.getElementById('trendChartTitle').textContent = title;
  if (desc) desc.textContent = descText;
  _renderActiveDashboardChart();
}

function _renderActiveDashboardChart() {
  switch (_dashboardActiveChart) {
    case 'radar': renderRadarChart(); break;
    case 'sunburst': renderSunburstChart(); break;
    case 'scatter': renderScatterChart(); break;
    default: if (currentClassifiedData.length) { const analyzer = new StatisticsAnalyzer(currentClassifiedData); renderTrendChart(calculateDailyTrend(currentClassifiedData)); } break;
  }
}

function bindDashboardChartSwitcher() {
  if (_dashboardChartSwitcherBound) return;
  _dashboardChartSwitcherBound = true;
  document.getElementById('dashboardChartTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.chart-tab');
    if (tab) switchDashboardChart(tab.dataset.chart);
  });
  // Date range picker
  const fromInput = document.getElementById('dateRangeFrom');
  const toInput = document.getElementById('dateRangeTo');
  const quickBtns = document.querySelectorAll('[data-range]');
  const applyRange = () => applyDateRange(fromInput.value, toInput.value);
  fromInput?.addEventListener('change', applyRange);
  toInput?.addEventListener('change', applyRange);
  quickBtns.forEach(btn => btn.addEventListener('click', () => {
    const days = btn.dataset.range;
    const to = new Date();
    if (days === 'all') { fromInput.value = ''; toInput.value = ''; }
    else {
      const from = new Date(to); from.setDate(to.getDate() - parseInt(days) + 1);
      fromInput.value = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
      toInput.value = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`;
    }
    applyRange();
  }));
  // Set defaults
  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 6);
  toInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  fromInput.value = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
}

function applyDateRange(from, to) {
  const filtered = currentClassifiedData.filter(r => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
  const analyzer = new StatisticsAnalyzer(filtered);
  renderMetrics(filtered);
  renderCategoryList(analyzer.analyzeByCategory(), new WebsiteClassifier());
  renderFilteredDomains();
  const dailyTrend = calculateDailyTrend(filtered);
  renderTrendChart(dailyTrend);
  renderHourlyChart(analyzer.getHourlyDistribution());
  _renderActiveDashboardChart();
}

function destroyDashboardChart() { if (trendChart) { trendChart.destroy(); trendChart = null; } }

// 雷达图：本周 vs 上周分类对比
function renderRadarChart() {
  destroyDashboardChart();
  const categories = ['learning', 'coding', 'entertainment', 'social', 'tools', 'other'];
  const catLabels = ['学习', '编程', '娱乐', '社交', '工具', '其他'];
  const today = new Date();
  const toStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const thisWeekStart = new Date(today); thisWeekStart.setDate(today.getDate() - 6);
  const lastWeekStart = new Date(today); lastWeekStart.setDate(today.getDate() - 13);
  const lastWeekEnd = new Date(today); lastWeekEnd.setDate(today.getDate() - 7);
  const sumByCat = (data, from, to) => {
    const fromStr = toStr(from), toStr2 = toStr(to);
    const filtered = data.filter(r => r.date >= fromStr && r.date <= toStr2);
    const total = filtered.reduce((s, r) => s + (r.duration || 0), 0) || 1;
    return categories.map(c => {
      const catDur = filtered.filter(r => r.category === c).reduce((s, r) => s + (r.duration || 0), 0);
      return Math.round(catDur / total * 100);
    });
  };
  const thisData = sumByCat(currentClassifiedData, thisWeekStart, today);
  const lastData = sumByCat(currentClassifiedData, lastWeekStart, lastWeekEnd);
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'radar',
    data: { labels: catLabels, datasets: [
      { label: '本周', data: thisData, borderColor: palette[0], backgroundColor: palette[0] + '26', pointBackgroundColor: palette[0] },
      { label: '上周', data: lastData, borderColor: palette[1], backgroundColor: palette[1] + '1a', pointBackgroundColor: palette[1] }
    ]},
    options: { responsive: true, maintainAspectRatio: false, animation: chartAnimation, scales: { r: { beginAtZero: true, max: 100, ticks: { display: false }, grid: { color: getGridColor() }, pointLabels: { font: { size: 11 } } } }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } } }
  });
}

// 嵌套环形图：分类 → 域名层级
function renderSunburstChart() {
  destroyDashboardChart();
  const categories = ['learning', 'coding', 'entertainment', 'social', 'tools', 'other'];
  const catTotals = {};
  const domainByCat = {};
  currentClassifiedData.forEach(r => {
    const c = r.category || 'other';
    catTotals[c] = (catTotals[c] || 0) + (r.duration || 0);
    if (!domainByCat[c]) domainByCat[c] = {};
    domainByCat[c][r.domain] = (domainByCat[c][r.domain] || 0) + (r.duration || 0);
  });
  const innerLabels = [], innerData = [], innerColors = [];
  const outerLabels = [], outerData = [], outerColors = [];
  categories.forEach((c, i) => {
    if (!catTotals[c]) return;
    innerLabels.push(c);
    innerData.push(Math.round(catTotals[c] / 60));
    innerColors.push(palette[i]);
    const domains = Object.entries(domainByCat[c] || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    domains.forEach(([domain, dur]) => {
      outerLabels.push(domain);
      outerData.push(Math.round(dur / 60));
      // Slightly desaturated version of parent color
      outerColors.push(palette[i] + 'aa');
    });
  });
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: [...innerLabels, ...outerLabels], datasets: [
      { data: innerData, backgroundColor: innerColors, weight: 2 },
      { data: outerData, backgroundColor: outerColors, weight: 1 }
    ]},
    options: { responsive: true, maintainAspectRatio: false, animation: chartAnimation, cutout: '30%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, font: { size: 10 } } }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed} 分钟` } } } }
  });
}

// 散点图：访问时间 vs 停留时长
function renderScatterChart() {
  destroyDashboardChart();
  const catColorMap = { learning: palette[0], coding: palette[1], entertainment: palette[2], social: palette[3], tools: palette[4], other: palette[5] };
  const datasets = [];
  const grouped = {};
  currentClassifiedData.forEach(r => {
    const c = r.category || 'other';
    if (!grouped[c]) grouped[c] = [];
    const hour = new Date(r.visitTime).getHours() + new Date(r.visitTime).getMinutes() / 60;
    grouped[c].push({ x: Math.round(hour * 10) / 10, y: Math.round((r.duration || 0) / 60) });
  });
  Object.entries(grouped).forEach(([cat, points]) => {
    datasets.push({ label: cat, data: points, backgroundColor: (catColorMap[cat] || palette[5]) + '99', pointRadius: 3 });
  });
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: { responsive: true, maintainAspectRatio: false, animation: chartAnimation, scales: { x: { min: 0, max: 24, title: { display: true, text: '小时' }, grid: { color: getGridColor() } }, y: { beginAtZero: true, title: { display: true, text: '分钟' }, grid: { color: getGridColor() } } }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x}时, ${ctx.parsed.y}分钟` } } } }
  });
}

// ==================== 活跃热力图（GitHub 贡献图风格） ====================
function renderHeatmap(browsingData) {
  const grid = document.getElementById('heatmapGrid');
  const labelsEl = document.getElementById('heatmapLabels');
  const tip = document.getElementById('heatmapTip');
  if (!grid) return;

  // Aggregate duration by date
  const dailyDuration = {};
  for (const r of browsingData) {
    const d = r.date || (r.visitTime ? (() => { const dt = new Date(r.visitTime); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; })() : null);
    if (d) dailyDuration[d] = (dailyDuration[d] || 0) + (r.duration || 0);
  }

  // Build 26 weeks — start from Monday ~26 weeks ago
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const daysBack = 26 * 7 + (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - daysBack + 1);

  // 自适应单元格尺寸：固定 2px gap，单元格填满剩余空间
  const scrollEl = document.getElementById('heatmapScroll');
  const containerWidth = scrollEl ? scrollEl.clientWidth - 26 : 600;
  const weeks = 26;
  const hmGap = 2;
  let hmSize = Math.floor((containerWidth - (weeks - 1) * hmGap) / weeks);
  hmSize = Math.max(8, Math.min(15, hmSize));
  grid.style.setProperty('--hm-size', hmSize + 'px');
  grid.style.setProperty('--hm-gap', hmGap + 'px');
  labelsEl.style.setProperty('--hm-size', hmSize + 'px');
  labelsEl.style.setProperty('--hm-gap', hmGap + 'px');

  // Duration scale
  let maxDuration = 60;
  for (const d of Object.values(dailyDuration)) {
    if (d > maxDuration) maxDuration = d;
  }

  // Day labels (Mon, Wed, Fri)
  const dayLabels = ['', '一', '', '三', '', '五', ''];
  labelsEl.innerHTML = dayLabels.map(l => `<span>${l}</span>`).join('');

  // Build cells + track month boundaries
  const cells = [];
  const monthPositions = [];
  let lastMonth = -1;
  let currentDate = new Date(startDate);
  let colIndex = 0;

  while (currentDate <= today) {
    const dateStr = toLocalDate(currentDate.getTime());
    const duration = dailyDuration[dateStr] || 0;
    let level = 0;
    if (duration > 0) {
      const ratio = duration / maxDuration;
      level = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    }
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    cell.dataset.level = level;
    cell.dataset.date = dateStr;
    cell.dataset.duration = duration;
    cells.push(cell);

    // Month label on first Monday of each new month
    const m = currentDate.getMonth();
    if (m !== lastMonth && currentDate.getDay() === 1) {
      const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
      monthPositions.push({ col: colIndex, label: monthNames[m] });
      lastMonth = m;
    }
    if (currentDate.getDay() === 0) colIndex++;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  grid.innerHTML = '';
  grid.append(...cells);

  // Render month labels (positioned absolutely over the grid)
  const monthsEl = document.getElementById('heatmapMonths');
  if (monthsEl) {
    monthsEl.innerHTML = '';
    const cellStep = hmSize + hmGap;
    monthPositions.forEach(({ col, label }) => {
      const span = document.createElement('span');
      span.textContent = label;
      span.style.left = (col * cellStep) + 'px';
      monthsEl.appendChild(span);
    });
  }

  // Screen reader summary
  const summaryEl = document.getElementById('heatmapSummary');
  if (summaryEl) {
    const allDurations = Object.values(dailyDuration);
    const activeDays = allDurations.filter(d => d > 0).length;
    const maxDay = Object.entries(dailyDuration).sort((a, b) => b[1] - a[1])[0];
    const avgDuration = activeDays > 0 ? Math.round(allDurations.reduce((s, d) => s + d, 0) / activeDays) : 0;
    summaryEl.textContent = `过去 26 周共 ${activeDays} 天有浏览活动，平均每日 ${formatDuration(avgDuration)}${maxDay ? '，最活跃日 ' + maxDay[0] + ' ' + formatDuration(maxDay[1]) : ''}`;
  }

  // GitHub-style tooltip
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const monthFull = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  grid.onmousemove = (e) => {
    const cell = e.target.closest('.heatmap-cell');
    if (!cell) { tip.classList.remove('visible'); return; }
    const dateStr = cell.dataset.date;
    const d = new Date(dateStr + 'T00:00:00');
    const dur = Number(cell.dataset.duration);
    const label = dur > 0 ? `<span class="tip-count">${formatDuration(dur)}</span> 浏览时间` : '无浏览数据';
    const dateLabel = `${weekdays[d.getDay()]}，${monthFull[d.getMonth()]}${d.getDate()}日`;
    tip.innerHTML = `${label}<br><span class="tip-date">${dateLabel}</span>`;
    tip.style.left = e.clientX + 12 + 'px';
    tip.style.top = e.clientY - 40 + 'px';
    tip.classList.add('visible');
  };
  grid.onmouseleave = () => tip.classList.remove('visible');
}

// ==================== 浏览历史时间线 ====================
let _timelineData = [];
let _timelineTimer = null;
let _timelineView = 'list';
let timelineChart = null;

function renderTimeline(browsingData) {
  _timelineData = browsingData.slice().sort((a, b) => (b.visitTime || 0) - (a.visitTime || 0));
  _applyTimelineFilter();
}

function _applyTimelineFilter() {
  const list = document.getElementById('timelineList');
  const countEl = document.getElementById('timelineCount');
  if (!list) return;

  const search = (document.getElementById('timelineSearch')?.value || '').toLowerCase().trim().slice(0, 200);
  const category = document.getElementById('timelineCategory')?.value || 'all';
  const dateFrom = document.getElementById('timelineDateFrom')?.value || '';
  const dateTo = document.getElementById('timelineDateTo')?.value || '';

  let filtered = _timelineData;

  if (search) {
    filtered = filtered.filter(r =>
      (r.domain || '').toLowerCase().includes(search) ||
      (r.title || '').toLowerCase().includes(search)
    );
  }
  if (category !== 'all') {
    filtered = filtered.filter(r => (r.category || 'other') === category);
  }
  if (dateFrom) {
    filtered = filtered.filter(r => (r.date || '') >= dateFrom);
  }
  if (dateTo) {
    filtered = filtered.filter(r => (r.date || '') <= dateTo);
  }

  const p = getChartPalette(); // Cached — avoids 6 getComputedStyle calls per filter
  const catColors = {
    learning: p[0] || '#6366f1',
    coding: p[1] || '#34d399',
    entertainment: p[2] || '#fbbf24',
    social: p[3] || '#f87171',
    tools: p[4] || '#a1a1aa',
    other: p[5] || '#818cf8'
  };

  const MAX_DISPLAY = 200;
  const display = filtered.slice(0, MAX_DISPLAY);
  countEl.textContent = filtered.length > 0 ? `显示 ${display.length} / ${filtered.length} 条记录` : '';

  if (!display.length) {
    list.innerHTML = `<div class="timeline-empty">${filtered.length === 0 && _timelineData.length > 0 ? '没有匹配的记录' : '暂无浏览数据'}</div>`;
    document.getElementById('timelineChartWrap').style.display = 'none';
    return;
  }

  const timeFmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  list.innerHTML = display.map(r => {
    const cat = r.category || 'other';
    const color = catColors[cat] || catColors.other;
    const time = r.visitTime ? timeFmt.format(new Date(r.visitTime)) : '';
    const dur = r.duration ? formatDuration(r.duration) : '';
    return `<div class="timeline-item" role="listitem" tabindex="0" aria-label="${escapeHtml(r.domain || '')} ${r.date || ''} ${time}${dur ? ' ' + dur : ''}"><div><div class="timeline-item-domain">${escapeHtml(r.domain || '')}</div><div class="timeline-item-title">${escapeHtml(r.title || '')}</div></div><div class="timeline-item-meta"><span class="timeline-cat-dot" style="background:${color}"></span>${r.date || ''} ${time}${dur ? ' · ' + dur : ''}</div></div>`;
  }).join('');

  // 切换列表/甘特图视图
  const listWrap = document.getElementById('timelineList');
  const chartWrap = document.getElementById('timelineChartWrap');
  if (_timelineView === 'chart') {
    listWrap.style.display = 'none';
    chartWrap.style.display = '';
    renderTimelineChart(display, catColors);
  } else {
    listWrap.style.display = '';
    chartWrap.style.display = 'none';
  }
}

function _debounceTimeline() {
  clearTimeout(_timelineTimer);
  _timelineTimer = setTimeout(_applyTimelineFilter, 250);
}

function renderTimelineChart(records, catColors) {
  const canvas = document.getElementById('timelineChart');
  if (!canvas || !records.length) return;
  if (timelineChart) { timelineChart.destroy(); timelineChart = null; }

  // 按时间排序，取前 80 条避免图表过密
  const sorted = records.slice().sort((a, b) => (a.visitTime || 0) - (b.visitTime || 0)).slice(0, 80);

  const datasets = [];
  const labels = sorted.map((r, i) => {
    const d = r.domain || '';
    return d.length > 18 ? d.slice(0, 16) + '…' : d;
  });

  // 每条记录是一个 floating bar: [startMinuteOfDay, endMinuteOfDay]
  const data = sorted.map(r => {
    const d = new Date(r.visitTime || 0);
    const startMin = d.getHours() * 60 + d.getMinutes();
    const durMin = Math.max(1, Math.round((r.duration || 0) / 60));
    return [startMin, startMin + durMin];
  });

  const bgColors = sorted.map(r => catColors[r.category || 'other'] || catColors.other);

  const ctx = canvas.getContext('2d');
  canvas.height = Math.max(160, sorted.length * 18 + 40);

  timelineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: bgColors.map(c => c + 'cc'),
        borderColor: bgColors,
        borderWidth: 1,
        borderSkipped: false,
        barPercentage: 0.7,
        categoryPercentage: 0.9
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const r = sorted[ctx.dataIndex];
              const [s, e] = ctx.raw;
              const sh = Math.floor(s / 60), sm = s % 60;
              const eh = Math.floor(e / 60), em = e % 60;
              return `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')} - ${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')} (${formatDuration(r.duration || 0)})`;
            }
          }
        }
      },
      scales: {
        x: {
          min: 0,
          max: 1440,
          grid: { color: getGridColor() },
          ticks: {
            stepSize: 120,
            callback(v) { return `${String(Math.floor(v / 60)).padStart(2, '0')}:00`; }
          }
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 10 }, autoSkip: true, maxTicksLimit: 30 }
        }
      }
    }
  });
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
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/advanced-analysis/${dataSync.userId}?days=${preferences.analysisDays}&blackhole_threshold=${preferences.blackholeThresholdMinutes}`);
    if (response.ok) {
      const analysis = await response.json();
      renderBlackholes(analysis.blackholes);
      renderAttentionCurve(analysis.attention_curve);
      return;
    }
    if (response.status !== 404) {
      const error = await response.json().catch(() => ({}));
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
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/analysis/${dataSync.userId}/compare?period1=${p1}&period2=${p2}`);
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
  if (!data || !data.period1 || !data.period2) { container.innerHTML = '<div class="goal-card"><p class="muted">对比数据不可用。</p></div>'; return; }
  const p1Dur = data.period1.total_duration || 0;
  const p2Dur = data.period2.total_duration || 0;
  const absDiff = p1Dur - p2Dur;
  const absIcon = absDiff > 0 ? '+' : '';

  // 百分比：对比期数据太少时显示绝对值而非百分比
  let pctText = '';
  let pctColor = 'var(--muted)';
  if (p2Dur < 60) {
    pctText = '—';
  } else {
    const pct = data.duration_change_pct ?? 0;
    const capped = Math.max(-999, Math.min(999, pct));
    pctText = `${capped > 0 ? '+' : ''}${Math.round(capped)}%`;
    pctColor = capped > 5 ? 'var(--red)' : capped < -5 ? 'var(--green)' : 'var(--muted)';
  }

  let html = `<div class="insight-cards">
    <div class="insight-card"><span>时长变化</span><strong style="color:${pctColor}">${pctText}</strong><small>${absIcon}${formatDuration(Math.abs(absDiff))}</small></div>
    <div class="insight-card"><span>近 ${p1Days} 天</span><strong>${data.period1.total_visits}</strong><small>${formatDuration(p1Dur)}</small></div>
    <div class="insight-card"><span>${p2Days} 天前</span><strong>${data.period2.total_visits}</strong><small>${formatDuration(p2Dur)}</small></div>
  </div>`;

  // 分类占比变化（仅显示有变化的）
  const cats = Object.entries(data.category_changes || {})
    .filter(([, info]) => Math.abs(info.delta) >= 1)
    .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta));
  if (cats.length) {
    html += '<div style="margin-top:14px;">';
    for (const [cat, info] of cats) {
      const catName = escapeHtml(WebsiteClassifier.CATEGORY_NAMES[cat] || cat);
      const deltaColor = info.delta > 0 ? 'var(--red)' : info.delta < 0 ? 'var(--green)' : 'var(--muted)';
      const arrow = info.delta > 0 ? '↑' : info.delta < 0 ? '↓' : '';
      html += `<div class="domain-row"><div><div class="domain-name">${catName}</div><div class="domain-meta">${p1Days}天 ${info.period1_pct}% · ${p2Days}天前 ${info.period2_pct}%</div></div><div style="color:${deltaColor};font-weight:600;font-size:13px;">${arrow} ${Math.abs(info.delta)}%</div></div>`;
    }
    html += '</div>';
  }

  // 新增/消失域名
  const newD = (data.new_domains || []).slice(0, 10);
  const goneD = (data.disappeared_domains || []).slice(0, 10);
  if (newD.length || goneD.length) {
    html += '<div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    if (newD.length) {
      html += `<div><div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--green);">新增 (${newD.length})</div><div style="font-size:11px;color:var(--muted);line-height:1.6;">${newD.map(d => escapeHtml(d)).join('<br>')}</div></div>`;
    } else {
      html += '<div></div>';
    }
    if (goneD.length) {
      html += `<div><div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--muted);">消失 (${goneD.length})</div><div style="font-size:11px;color:var(--muted);line-height:1.6;">${goneD.map(d => escapeHtml(d)).join('<br>')}</div></div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

// ==================== 专注会话 ====================

let _focusTimer = null;

async function loadFocusStats() {
  // 查询当前会话状态
  let status = { active: false };
  try {
    status = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ active: false }), 2000);
      chrome.runtime.sendMessage({ action: 'focusStatus' }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) console.warn('focusStatus:', chrome.runtime.lastError.message);
        resolve(res?.status || { active: false });
      });
    });
  } catch {}
  renderFocusSessionInfo(status);

  // 统计今日专注时长
  const { focusSessions = [] } = await chrome.storage.local.get('focusSessions');
  const today = todayString();
  const todaySessions = focusSessions.filter(s => {
    const dt = new Date(s.startTime);
    const d = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return d === today;
  });
  const todayMinutes = Math.round(todaySessions.reduce((sum, s) => sum + (s.completed ? s.actualDuration : 0), 0) / 60);
  document.getElementById('focusTodayTime').textContent = todayMinutes;

  // 计算连续天数
  const streak = calculateFocusStreak(focusSessions);
  document.getElementById('focusStreak').textContent = streak;

  // 最近会话历史
  renderFocusHistory(focusSessions.slice(-5).reverse());
}

function calculateFocusStreak(sessions) {
  if (!sessions.length) return 0;
  const toLocalDate = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const completedDates = new Set(
    sessions.filter(s => s.completed).map(s => toLocalDate(s.startTime))
  );
  let streak = 0;
  const d = new Date();
  while (true) {
    const dateStr = toLocalDate(d);
    if (completedDates.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function renderFocusSessionInfo(status) {
  const infoEl = document.getElementById('focusSessionInfo');
  const startBtn = document.getElementById('focusStartBtn');

  if (status.active) {
    const remaining = status.remainingSeconds;
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    infoEl.style.display = 'block';
    infoEl.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><span>专注中 — 剩余 <strong>${min}:${String(sec).padStart(2, '0')}</strong> · 打断 ${status.interruptions} 次</span><button id="focusStopBtn" class="danger" style="font-size:11px;padding:4px 10px;">停止</button></div>`;
    startBtn.disabled = true;
    startBtn.textContent = '专注中...';

    document.getElementById('focusStopBtn').addEventListener('click', stopFocusSession);

    // 倒计时
    clearTimeout(_focusTimer);
    _focusTimer = setTimeout(loadFocusStats, 1000);
  } else {
    infoEl.style.display = 'none';
    startBtn.disabled = false;
    startBtn.textContent = '开始专注';
    clearTimeout(_focusTimer);
    _focusTimer = null;
  }
}

function renderFocusHistory(sessions) {
  const container = document.getElementById('focusHistory');
  if (!sessions.length) {
    container.innerHTML = '';
    return;
  }
  const html = sessions.map(s => {
    const start = new Date(s.startTime);
    const timeStr = `${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')}`;
    const dur = Math.round(s.actualDuration / 60);
    const status = s.completed ? '<span style="color:var(--green);">完成</span>' : '<span style="color:var(--red);">中断</span>';
    return `<div class="domain-row"><div><div class="domain-name">${timeStr} · ${dur} 分钟</div><div class="domain-meta">打断 ${s.interruptions} 次</div></div>${status}</div>`;
  }).join('');
  container.innerHTML = `<div style="font-size:12px;font-weight:600;margin-bottom:6px;">最近会话</div>${html}`;
}

async function showFocusDurationPicker() {
  const preferences = await getPreferences();
  const durations = (preferences.focusDurations || '25,45,60').split(/[,，]/).map(s => parseInt(s.trim())).filter(n => n > 0 && n <= 240);
  const infoEl = document.getElementById('focusSessionInfo');
  infoEl.style.display = 'block';
  infoEl.innerHTML = `<div style="font-size:12px;margin-bottom:8px;">选择专注时长</div><div class="button-row compact">${durations.map(m => `<button class="ghost focus-duration-pick" data-minutes="${m}" style="font-size:12px;">${m} 分钟</button>`).join('')}</div>`;
  infoEl.querySelectorAll('.focus-duration-pick').forEach(btn => {
    btn.addEventListener('click', () => startFocusSession(parseInt(btn.dataset.minutes)));
  });
}

async function startFocusSession(minutes) {
  await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'startFocus', durationMinutes: minutes }, resolve);
  });
  await loadFocusStats();
  setNote(`专注会话开始：${minutes} 分钟`, 'success');
  log(`专注会话开始：${minutes} 分钟`);
}

async function stopFocusSession() {
  await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'stopFocus' }, resolve);
  });
  await loadFocusStats();
  setNote('专注会话已停止', 'info');
  log('专注会话已手动停止');
}

async function loadReports(reportType) {
  try {
    await initDataSync();
    if (!(await cachedCheckConnection())) {
      renderReports([]);
      return;
    }
    await dataSync.initUserId();
    const filter = reportType || document.getElementById('reportTypeFilter')?.value || '';
    const typeParam = filter ? `&report_type=${encodeURIComponent(filter)}` : '';
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/reports/${dataSync.userId}?limit=10${typeParam}`);
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
    if (!(await cachedCheckConnection())) {
      container.innerHTML = '<div class="empty">后端未连接，无法加载 AI 分析。</div>';
      return;
    }
    await dataSync.initUserId();
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/reports/${dataSync.userId}?limit=1`);
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
    await loadFocusStats();
    await loadLeaderboard();
    setNote('洞察已刷新', 'success');
    log('洞察页已刷新');
  } catch (error) {
    setNote(`洞察刷新失败：${error.message}`, 'danger');
    log(`洞察刷新失败：${error.message}`);
  } finally {
    setButtonBusy(button, false);
  }
}

// ==================== 排行榜 ====================
async function loadLeaderboard() {
  const container = document.getElementById('leaderboardContent');
  try {
    await initDataSync();
    if (!(await cachedCheckConnection())) {
      container.innerHTML = '<div class="empty">后端未连接，无法加载排行榜。</div>';
      return;
    }
    await dataSync.initUserId();
    const sortBy = document.getElementById('leaderboardSort')?.value || 'learning_duration';
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/leaderboard?sort_by=${sortBy}&limit=20&user_id=${encodeURIComponent(dataSync.userId)}`);
    if (!response.ok) {
      container.innerHTML = '<div class="empty">加载排行榜失败。</div>';
      return;
    }
    const data = await response.json();
    renderLeaderboard(data.entries || [], sortBy);
  } catch (error) {
    console.error('排行榜加载失败:', error);
    container.innerHTML = '<div class="empty">加载排行榜失败。</div>';
  }
}

function renderLeaderboard(entries, sortBy) {
  const container = document.getElementById('leaderboardContent');
  if (!entries.length) {
    container.innerHTML = '<div class="empty">暂无排行数据，点击"加入排行"成为第一位参与者。</div>';
    return;
  }
  const labels = { learning_duration: '学习时长', focus_duration: '专注时长', total_duration: '总浏览时长' };
  const valueLabel = labels[sortBy] || '时长';

  let html = `<table class="leaderboard-table"><thead><tr><th class="lb-rank">#</th><th>用户</th><th style="text-align:right">${escapeHtml(valueLabel)}</th></tr></thead><tbody>`;
  for (const entry of entries) {
    const rankClass = entry.rank <= 3 ? ` top-${entry.rank}` : '';
    const youClass = entry._isYou ? ' lb-you' : '';
    const value = formatDuration(entry[sortBy] || 0);
    html += `<tr class="${youClass}"><td class="lb-rank${rankClass}">${entry.rank}</td><td class="lb-name">${escapeHtml(entry.display_name)}${entry._isYou ? ' (你)' : ''}</td><td class="lb-value">${value}</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function joinLeaderboard() {
  const button = document.getElementById('leaderboardJoinBtn');
  setButtonBusy(button, true, '加入中...');
  try {
    await initDataSync();
    if (!(await cachedCheckConnection())) {
      setNote('后端未连接，无法加入排行榜', 'warning');
      return;
    }
    await dataSync.initUserId();
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/leaderboard/${dataSync.userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: '匿名用户' })
    });
    if (!response.ok) {
      setNote('加入排行榜失败', 'danger');
      return;
    }
    setNote('已加入排行榜', 'success');
    log('已加入学习排行榜');
    await loadLeaderboard();
  } catch (error) {
    setNote(`加入排行榜失败：${error.message}`, 'danger');
  } finally {
    setButtonBusy(button, false);
  }
}

async function loadAnalytics() {
  const storage = await chrome.storage.local.get(['browsingData', 'classificationOverrides', 'classificationFeedback', 'analysisDays']);
  const browsingData = validateBrowsingData(storage.browsingData);
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
  const classificationFeedback = storage.classificationFeedback || {};
  const classifier = new WebsiteClassifier(classificationOverrides, classificationFeedback);
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
  renderHabitCard(classifiedData);
  renderHeatmap(classifiedData);
  renderTimeline(classifiedData);
  const topCategoryText = categoryStats[0] ? `${classifier.getCategoryInfo(categoryStats[0].category).name}占比最高，约 ${Number(categoryStats[0].percentage).toFixed(1)}%。` : '分类数据正在积累。';
  return { count: classifiedData.length, topCategoryText };
}

async function refreshDashboard() {
  const preferences = await loadPreferences();
  await initDataSync();
  const { userId, lastSyncTime } = await chrome.storage.local.get(['userId', 'lastSyncTime']);
  let analytics;
  try {
    analytics = await loadAnalytics();
  } catch (e) {
    console.warn('loadAnalytics 失败:', e);
    analytics = { count: 0, topCategoryText: '数据加载失败。' };
    // Still render heatmap/timeline with raw storage data
    try {
      const { browsingData = [] } = await chrome.storage.local.get('browsingData');
      if (browsingData.length) {
        renderHeatmap(browsingData);
        renderTimeline(browsingData);
      }
    } catch (_) {}
  }
  const connected = await cachedCheckConnection();
  const syncText = lastSyncTime ? `上次同步：${new Date(lastSyncTime).toLocaleString('zh-CN')}` : '尚未同步。';
  const days = preferences.analysisDays;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const connDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${connected ? 'var(--green)' : 'var(--red)'};vertical-align:middle;margin-right:4px;"></span>`;
  document.getElementById('statusNote').innerHTML = `${connDot}${connected ? '云服务器连接正常' : '后端未连接'} · 已载入 ${analytics.count} 条本地记录 · ${syncText} · 分析窗口 ${days} 天`;
  document.getElementById('analysisWindowDesc').textContent = `${greeting} — 查看最近 ${days} 天的访问、分类、时段和高频站点。`;
  document.getElementById('weekVisitsLabel').textContent = `${days} 天访问`;
  document.getElementById('trendChartTitle').textContent = `${days} 天趋势`;

  // 并行加载独立模块
  const tasks = [loadGoals()];
  if (activeSidebarTab === 'insights') {
    tasks.push(loadAdvancedInsights(), loadReports(), loadLatestAIAnalysis(), loadFocusStats(), loadLeaderboard());
  }
  await Promise.allSettled(tasks);

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
  try { const preferences = await getPreferences(); await initDataSync(); if (!(await cachedCheckConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); log('开始 AI 分析...'); const response = await authFetch(`${dataSync.apiBaseUrl}/api/ai-analysis/${dataSync.userId}?days=${preferences.analysisDays}`, { method: 'POST' }); if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || 'AI 分析失败'); } const analysis = await response.json(); renderAIAnalysis(analysis); await loadReports(); setNote(`AI 分析完成：${analysis.summary}`, 'success'); log(`AI 总结：${analysis.summary}`); await switchSidebarTab('insights', { focusPanel: true }); } catch (error) { setNote(`AI 分析失败：${error.message}`, 'danger'); log(`AI 分析失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function createGoal() {
  const button = document.getElementById('createGoalBtn');
  setButtonBusy(button, true, '添加中...');
  try { await initDataSync(); if (!(await cachedCheckConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); const goalType = document.getElementById('goalTypeSelect').value; const durationMinutes = parseInt(document.getElementById('goalDurationInput').value, 10); if (!durationMinutes || durationMinutes <= 0 || durationMinutes > 1440) throw new Error('请输入有效的目标时长（1-1440 分钟）'); const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal_type: goalType, category: CATEGORY_MAP[goalType], target_duration: durationMinutes * 60, date: todayString() }) }); if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || '创建目标失败'); } setNote('目标已添加', 'success'); log(`已添加目标：${GOAL_TYPE_NAMES[goalType]} ${durationMinutes} 分钟`); await loadGoals(); } catch (error) { setNote(`创建目标失败：${error.message}`, 'danger'); log(`创建目标失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function loadGoals() {
  const list = document.getElementById('goalList');
  try { await initDataSync(); if (!(await cachedCheckConnection())) { list.innerHTML = '<div class="goal-card"><div><strong>云服务器未连接</strong><p class="muted">连接后可管理目标。</p></div></div>'; return; } await dataSync.initUserId(); const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}?date=${todayString()}&is_active=1`); if (!response.ok) throw new Error('获取目标失败'); const goals = await response.json(); if (!goals.length) { list.innerHTML = '<div class="goal-card"><div><strong>还没有目标</strong><p class="muted">设一个今日目标，看看自己能走多远。</p></div></div>'; return; } list.innerHTML = goals.map(goal => { const pct = Number(goal.progress_percentage || 0); const achieved = pct >= 100; const warning = pct >= 80 && !achieved; const barClass = achieved ? 'achieved' : (warning ? 'warning' : ''); const safeGoalType = escapeHtml(GOAL_TYPE_NAMES[goal.goal_type] || goal.goal_type);
const safeGoalId = escapeHtml(String(goal.id));
return `<div class="goal-card ${achieved ? 'achieved' : ''}"><div><strong>${safeGoalType}</strong><p class="muted">${formatDuration(goal.current_progress)} / ${formatDuration(goal.target_duration)} · ${pct.toFixed(1)}%${achieved ? ' <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;"><path d="M9 12l2 2 4-4"/></svg>' : ''}</p></div><div class="button-row compact"><button class="secondary" data-goal-edit-id="${safeGoalId}" data-goal-duration="${Math.round(goal.target_duration / 60)}">编辑</button><button class="ghost" data-goal-disable-id="${safeGoalId}">停用</button><button class="danger" data-goal-id="${safeGoalId}">删除</button></div><div class="bar-track"><div class="bar-fill ${barClass}" style="width: ${Math.min(pct, 100)}%"></div></div></div>`; }).join(''); list.querySelectorAll('[data-goal-id]').forEach(button => button.addEventListener('click', () => deleteGoal(button.dataset.goalId))); list.querySelectorAll('[data-goal-disable-id]').forEach(button => button.addEventListener('click', () => deactivateGoal(button.dataset.goalDisableId))); list.querySelectorAll('[data-goal-edit-id]').forEach(button => button.addEventListener('click', () => editGoalDuration(button.dataset.goalEditId, button.dataset.goalDuration))); } catch (error) { list.innerHTML = `<div class="goal-card"><div><strong>加载失败</strong><p class="muted">${error.message}</p></div></div>`; }
}
async function refreshGoalProgress() {
  const button = document.getElementById('refreshGoalsBtn');
  setButtonBusy(button, true, '刷新中...');
  try { await initDataSync(); if (!(await cachedCheckConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}/update-progress?date=${encodeURIComponent(todayString())}`, { method: 'POST' }); if (!response.ok) throw new Error('刷新目标进度失败'); setNote('目标进度已刷新', 'success'); log('目标进度已刷新'); await loadGoals(); } catch (error) { setNote(`目标刷新失败：${error.message}`, 'danger'); log(`目标刷新失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function editGoalDuration(goalId, currentMinutes) {
  const editBtn = document.querySelector(`[data-goal-edit-id="${goalId}"]`);
  if (!editBtn) return;
  const row = editBtn.closest('.button-row');
  if (!row) return;
  row.innerHTML = `<input type="number" min="1" max="1440" value="${currentMinutes}" style="width:70px;min-height:32px;padding:4px 8px;font-size:12px;" aria-label="新的目标时长（分钟）"><button class="secondary" style="font-size:12px;min-height:32px;padding:4px 10px;" data-goal-save-id="${goalId}">保存</button><button class="ghost" style="font-size:12px;min-height:32px;padding:4px 10px;" data-goal-cancel>取消</button>`;
  const input = row.querySelector('input');
  input.focus();
  input.select();
  row.querySelector('[data-goal-save-id]').addEventListener('click', async () => {
    const minutes = Number(input.value);
    if (!minutes || minutes <= 0 || minutes > 1440) { setNote('请输入有效的目标时长（1-1440 分钟）', 'danger'); return; }
    try { await initDataSync(); const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_duration: Math.round(minutes * 60) }) }); if (!response.ok) throw new Error('编辑失败'); setNote('目标已更新', 'success'); log(`已更新目标 #${goalId}`); await loadGoals(); } catch (error) { setNote(`目标编辑失败：${error.message}`, 'danger'); log(`目标编辑失败：${error.message}`); }
  });
  row.querySelector('[data-goal-cancel]').addEventListener('click', () => loadGoals());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') row.querySelector('[data-goal-save-id]').click();
    if (e.key === 'Escape') loadGoals();
  });
}
async function deactivateGoal(goalId) {
  showGoalConfirm('确定停用这个目标吗？停用后不会继续统计今日进度。', async () => {
    try { await initDataSync(); const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: 0 }) }); if (!response.ok) throw new Error('停用失败'); setNote('目标已停用', 'success'); log(`已停用目标 #${goalId}`); await loadGoals(); } catch (error) { setNote(`目标停用失败：${error.message}`, 'danger'); log(`目标停用失败：${error.message}`); }
  });
}
async function deleteGoal(goalId) {
  showGoalConfirm('确定删除这个目标吗？', async () => {
    try { await initDataSync(); const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'DELETE' }); if (!response.ok) throw new Error('删除失败'); setNote('目标已删除', 'success'); log(`已删除目标 #${goalId}`); await loadGoals(); } catch (error) { setNote(`删除目标失败：${error.message}`, 'danger'); log(`删除目标失败：${error.message}`); }
  });
}
function showGoalConfirm(message, onConfirm) {
  let backdrop = document.getElementById('goalConfirmBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'goalConfirmBackdrop';
    backdrop.style.cssText = 'display:none;position:fixed;inset:0;z-index:9997;background:oklch(0% 0 0 / 0.32);';
    document.body.appendChild(backdrop);
  }
  let dialog = document.getElementById('goalConfirmDialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'goalConfirmDialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9998;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:0 12px 40px rgba(0,0,0,.18);padding:20px;min-width:260px;max-width:340px;';
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<p style="font-size:14px;line-height:1.6;margin-bottom:16px;color:var(--text);">${escapeHtml(message)}</p><div class="button-row compact" style="justify-content:flex-end;"><button class="ghost" id="goalConfirmCancel" style="font-size:12px;min-height:32px;padding:4px 14px;">取消</button><button class="danger" id="goalConfirmOk" style="font-size:12px;min-height:32px;padding:4px 14px;">确定</button></div>`;
  backdrop.style.display = 'block';
  dialog.style.display = 'block';
  const trigger = document.activeElement;
  function close() {
    backdrop.style.display = 'none';
    dialog.style.display = 'none';
    document.removeEventListener('keydown', onKey);
    backdrop.removeEventListener('click', close);
    if (trigger && typeof trigger.focus === 'function') trigger.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      const focusable = dialog.querySelectorAll('button:not([disabled])');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.getElementById('goalConfirmCancel').addEventListener('click', close);
  document.getElementById('goalConfirmOk').addEventListener('click', () => { close(); onConfirm(); });
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  dialog.querySelector('#goalConfirmOk').focus();
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

async function generateShareCard() {
  const { browsingData = [], classificationOverrides = {}, classificationFeedback = {} } = await chrome.storage.local.get(['browsingData', 'classificationOverrides', 'classificationFeedback']);
  if (!browsingData.length) { setNote('暂无数据，无法生成分享卡片', 'danger'); return; }

  const classifier = new WebsiteClassifier(classificationOverrides, classificationFeedback);
  const processor = new DataProcessor(browsingData);
  const cleanedData = processor.clean().getData();
  const classifiedData = classifier.classifyBatch(cleanedData);
  const analyzer = new StatisticsAnalyzer(classifiedData);

  // 最近 7 天数据
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekData = classifiedData.filter(r => r.visitTime > sevenDaysAgo);
  const totalDuration = weekData.reduce((s, r) => s + (r.duration || 0), 0);
  const uniqueDomains = new Set(weekData.map(r => r.domain).filter(Boolean)).size;

  // 分类统计
  const catStats = {};
  for (const r of weekData) {
    const cat = r.category || 'other';
    catStats[cat] = (catStats[cat] || 0) + (r.duration || 0);
  }

  // 创建 Canvas
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');

  // 背景
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--surface').trim() || '#1a1a2e';
  const text = cs.getPropertyValue('--text').trim() || '#e8e8e8';
  const muted = cs.getPropertyValue('--muted').trim() || '#888';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 600, 400);

  // 标题
  ctx.fillStyle = text;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('BrowseMind', 24, 40);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText(`最近 7 天浏览摘要 · ${todayString()}`, 24, 60);

  // 关键数据
  ctx.fillStyle = text;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(formatDuration(totalDuration), 24, 110);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText('总浏览时长', 24, 128);

  ctx.fillStyle = text;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(String(uniqueDomains), 200, 110);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText('独立站点', 200, 128);

  ctx.fillStyle = text;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(String(weekData.length), 340, 110);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = muted;
  ctx.fillText('访问次数', 340, 128);

  // 分类饼图
  const cats = Object.entries(catStats).sort((a, b) => b[1] - a[1]);
  const sharePalette = [1,2,3,4,5,6].map(i => cs.getPropertyValue(`--chart-${i}`).trim());
  const pieX = 480, pieY = 220, pieR = 70;
  let startAngle = -Math.PI / 2;
  const totalCat = cats.reduce((s, [, d]) => s + d, 0) || 1;

  for (let i = 0; i < cats.length; i++) {
    const [cat, duration] = cats[i];
    const sliceAngle = (duration / totalCat) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(pieX, pieY);
    ctx.arc(pieX, pieY, pieR, startAngle, startAngle + sliceAngle);
    ctx.fillStyle = sharePalette[i % sharePalette.length];
    ctx.fill();
    startAngle += sliceAngle;
  }

  // 饼图标签
  let labelY = 160;
  for (let i = 0; i < Math.min(cats.length, 6); i++) {
    const [cat, duration] = cats[i];
    const catName = WebsiteClassifier.CATEGORY_NAMES[cat] || cat;
    const pct = Math.round(duration / totalCat * 100);
    ctx.fillStyle = sharePalette[i % sharePalette.length];
    ctx.fillRect(24, labelY - 8, 10, 10);
    ctx.fillStyle = text;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${catName} ${pct}%`, 40, labelY);
    labelY += 20;
  }

  // 品牌标识
  ctx.fillStyle = muted;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('browsemind.app', 24, 385);

  // 导出
  canvas.toBlob(blob => {
    if (!blob) { setNote('分享卡片生成失败', 'danger'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `browsemind-share-${todayString()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setNote('分享卡片已生成', 'success');
    log('分享卡片已生成并下载');
  }, 'image/png');
}

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
    const response = await authFetch(url);
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
});
// Timeline filters
document.getElementById('timelineSearch')?.addEventListener('input', _debounceTimeline);
document.getElementById('timelineCategory')?.addEventListener('change', _applyTimelineFilter);
document.getElementById('timelineDateFrom')?.addEventListener('change', _applyTimelineFilter);
document.getElementById('timelineDateTo')?.addEventListener('change', _applyTimelineFilter);
// 时间线视图切换
document.getElementById('timelineViewTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-timeline-view]');
  if (!btn) return;
  _timelineView = btn.dataset.timelineView;
  document.querySelectorAll('#timelineViewTabs .chart-tab').forEach(t => t.classList.toggle('active', t.dataset.timelineView === _timelineView));
  _applyTimelineFilter();
});
document.getElementById('syncBtn').addEventListener('click', syncNow); document.getElementById('aiBtn').addEventListener('click', runAIAnalysis); document.getElementById('createGoalBtn').addEventListener('click', createGoal); document.getElementById('refreshGoalsBtn').addEventListener('click', refreshGoalProgress); document.getElementById('resetApiBtn').addEventListener('click', resetApiBaseUrl); document.getElementById('testApiBtn').addEventListener('click', testApiConnection); document.getElementById('exportJsonBtn').addEventListener('click', exportJson); document.getElementById('exportCloudBtn').addEventListener('click', exportCloudData); document.getElementById('shareCardBtn').addEventListener('click', generateShareCard); document.getElementById('clearLocalBtn').addEventListener('click', clearLocalData); initImport(); document.getElementById('compareBtn').addEventListener('click', runComparison); document.getElementById('focusStartBtn').addEventListener('click', showFocusDurationPicker); document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar); document.getElementById('reportTypeFilter').addEventListener('change', () => loadReports()); document.getElementById('leaderboardJoinBtn').addEventListener('click', joinLeaderboard); document.getElementById('leaderboardRefreshBtn').addEventListener('click', loadLeaderboard); document.getElementById('leaderboardSort').addEventListener('change', loadLeaderboard);
document.getElementById('themeToggleBtn').addEventListener('click', cycleTheme);
// 站点详情：事件委托
document.getElementById('domainList')?.addEventListener('click', (e) => {
  const el = e.target.closest('[data-detail-domain]');
  if (el) showDomainDetail(el.dataset.detailDomain);
});
document.getElementById('closeDomainDetail')?.addEventListener('click', () => { document.getElementById('domainDetailModal').style.display = 'none'; });
document.getElementById('domainDetailModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });
document.querySelectorAll('[data-pref]').forEach(el => {
  const evt = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
  el.addEventListener(evt, autoSaveSettings);
});
document.getElementById('notificationsEnabledInput').addEventListener('change', updateInterventionWarning);
document.getElementById('interventionsEnabledInput').addEventListener('change', updateInterventionWarning);
document.querySelectorAll('[data-sidebar-tab]').forEach(button => { button.addEventListener('click', () => switchSidebarTab(button.dataset.sidebarTab, { focusPanel: true }).catch(e => console.error('切换标签失败:', e))); button.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); moveSidebarTabFocus(button.dataset.sidebarTab, 1); } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); moveSidebarTabFocus(button.dataset.sidebarTab, -1); } else if (event.key === 'Home') { event.preventDefault(); const firstButton = document.querySelector('[data-sidebar-tab="dashboard"]'); if (firstButton) { switchSidebarTab('dashboard'); firstButton.focus(); } } else if (event.key === 'End') { event.preventDefault(); const lastTab = SIDEBAR_TABS[SIDEBAR_TABS.length - 1]; const lastButton = document.querySelector(`[data-sidebar-tab="${lastTab}"]`); if (lastButton) { switchSidebarTab(lastTab); lastButton.focus(); } } }); }); }

const _dashLoadingMsgs = ['正在唤醒分析引擎...', '整理你的浏览足迹...', '数据马上就绪...'];
let _dashLoadTimer = null;
function startDashLoadingRotation() {
  const el = document.getElementById('statusNote');
  if (!el) return;
  let i = 0;
  _dashLoadTimer = setInterval(() => { i = (i + 1) % _dashLoadingMsgs.length; el.textContent = _dashLoadingMsgs[i]; }, 1800);
}
function stopDashLoadingRotation() { clearInterval(_dashLoadTimer); _dashLoadTimer = null; }

document.addEventListener('DOMContentLoaded', async () => {
  try {
    startDashLoadingRotation();
    await loadSidebarState();
    if (activeSidebarTab === 'actions') activeSidebarTab = 'dashboard';
    bindEvents();
    bindDashboardChartSwitcher();
    applySidebarState();
    await loadTheme();
    await switchSidebarTab(activeSidebarTab);
    await refreshDashboard();
  } catch (e) {
    console.error('仪表盘初始化失败:', e);
  } finally {
    stopDashLoadingRotation();
  }
});

// 快捷键
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  const tabMap = { '1': 'dashboard', '2': 'insights', '3': 'actions', '4': 'goals', '5': 'settings' };
  if (tabMap[e.key]) { e.preventDefault(); switchSidebarTab(tabMap[e.key]); }
  else if (e.key === '/') { e.preventDefault(); document.getElementById('timelineSearch')?.focus(); }
  else if (e.key === 'Escape') { document.activeElement?.blur(); }
});
// Debounced resize handler to avoid excessive chart.resize() calls during window drag
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (activeSidebarTab === 'dashboard') {
      if (trendChart) trendChart.resize();
      if (hourlyChart) hourlyChart.resize();
    }
    if (attentionChart) attentionChart.resize();
  }, 150);
});
window.addEventListener('beforeunload', () => {
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  if (hourlyChart) { hourlyChart.destroy(); hourlyChart = null; }
  if (attentionChart) { attentionChart.destroy(); attentionChart = null; }
  if (habitTrendChart) { habitTrendChart.destroy(); habitTrendChart = null; }
  if (domainTrendChart) { domainTrendChart.destroy(); domainTrendChart = null; }
  if (timelineChart) { timelineChart.destroy(); timelineChart = null; }
  clearTimeout(_focusTimer);
  clearTimeout(_autoSaveTimer);
  clearTimeout(_timelineTimer);
  clearTimeout(domainFilterTimer);
  clearTimeout(_settingsStatusTimer);
  clearInterval(_dashLoadTimer);
  clearInterval(_cacheCleanupInterval);
});

// 定期清理过期缓存（每 5 分钟）
const _cacheCleanupInterval = setInterval(() => {
  _connectionCache = { result: null, time: 0 };
  // 清理过大的域名列表缓存
  if (_allDomains.length > 500) {
    _allDomains = _allDomains.slice(0, 200);
    _domainPage = 1;
  }
}, 5 * 60 * 1000);
