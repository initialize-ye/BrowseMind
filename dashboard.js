// DEFAULT_API_BASE_URL and DEFAULT_PREFERENCES are defined in dataSync.js
const palette = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#5f6368', '#9aa0a6'];
const categoryMap = { daily_learning: 'learning', daily_entertainment: 'entertainment', daily_coding: 'coding', daily_social: 'social' };
const goalTypeNames = { daily_learning: '每日学习时长', daily_entertainment: '每日娱乐时长限制', daily_coding: '每日编程时长', daily_social: '每日社交时长限制' };
let dataSync = null;
let trendChart = null;
let hourlyChart = null;
let activeSidebarTab = 'actions';
let isSidebarCollapsed = false;
let attentionChart = null;
let currentClassifiedData = [];
let domainFilterTimer = null;
const SIDEBAR_TABS = ['dashboard', 'insights', 'actions', 'goals', 'settings'];

function todayString() { return new Date().toISOString().split('T')[0]; }
function formatDuration(seconds) {
  const total = Math.floor(seconds || 0);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours}h ${remain}m` : `${hours}h`;
}
function log(message) {
  const box = document.getElementById('logBox');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const lines = box.textContent.split('\n');
  if (lines.length > 200) lines.length = 200;
  box.textContent = `[${time}] ${message}\n${lines.join('\n')}`;
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
  const bgMap = { success: 'var(--green-soft)', danger: 'var(--red-soft)', info: 'var(--blue-soft)' };
  const colorMap = { success: 'var(--green)', danger: 'var(--red)', info: 'var(--blue)' };
  toast.style.cssText = `pointer-events:auto;margin-bottom:8px;padding:12px 16px;border-radius:var(--radius-sm);background:${bgMap[type] || bgMap.info};color:${colorMap[type] || colorMap.info};font-size:13px;line-height:1.5;box-shadow:var(--shadow);opacity:0;transition:opacity .2s ease;`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
async function getPreferences() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_PREFERENCES));
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    apiBaseUrl: stored.apiBaseUrl || DEFAULT_API_BASE_URL,
    analysisDays: Number(stored.analysisDays || DEFAULT_PREFERENCES.analysisDays),
    blackholeThresholdMinutes: Number(stored.blackholeThresholdMinutes || DEFAULT_PREFERENCES.blackholeThresholdMinutes),
    autoSyncDebounceMs: Number(stored.autoSyncDebounceMs || DEFAULT_PREFERENCES.autoSyncDebounceMs),
    autoSyncMinIntervalMs: Number(stored.autoSyncMinIntervalMs || DEFAULT_PREFERENCES.autoSyncMinIntervalMs),
    dataRetentionDays: Number(stored.dataRetentionDays || DEFAULT_PREFERENCES.dataRetentionDays),
    minVisitDurationSeconds: Number(stored.minVisitDurationSeconds || DEFAULT_PREFERENCES.minVisitDurationSeconds)
  };
}
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
    toggleButton.textContent = isSidebarCollapsed ? '☷' : '☰';
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
  setTimeout(() => {
    if (trendChart) trendChart.resize();
    if (hourlyChart) hourlyChart.resize();
  }, 240);
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
  document.querySelectorAll('[data-sidebar-panel]').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.sidebarPanel === tab);
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
    renderOverrideRules();
  }
}
function applyPreferencesToForm(preferences) {
  document.getElementById('apiBaseUrlInput').value = preferences.apiBaseUrl;
  document.getElementById('autoSyncEnabledInput').checked = Boolean(preferences.autoSyncEnabled);
  document.getElementById('notificationsEnabledInput').checked = Boolean(preferences.notificationsEnabled);
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
      const info = categories[category] || { name: '其他', icon: '📦' };
      return `<div class="domain-row"><div><div class="domain-name">${escapeHtml(domain)}</div><div class="domain-meta">${info.icon} ${escapeHtml(info.name)}</div></div><button class="danger" data-override-remove="${escapeHtml(domain)}">移除</button></div>`;
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
  picker.style.display = 'block';
  picker.innerHTML = `<div class="picker-header"><strong>修改分类：${escapeHtml(domain)}</strong><button class="ghost" id="closePickerBtn" style="min-height:32px;padding:4px 10px;">取消</button></div>` +
    Object.entries(categories).map(([key, info]) =>
      `<button class="picker-option${key === currentCategory ? ' active' : ''}" data-pick-cat="${key}">${info.icon} ${escapeHtml(info.name)}</button>`
    ).join('');
  document.getElementById('closePickerBtn').addEventListener('click', () => { picker.style.display = 'none'; });
  picker.querySelectorAll('[data-pick-cat]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newCat = btn.dataset.pickCat;
      await saveClassificationOverride(domain, newCat);
      picker.style.display = 'none';
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
    container.innerHTML = '<div class="empty">还没有足够数据生成分类。</div>';
    return;
  }
  const categories = classifier.getAllCategories();
  container.innerHTML = categoryStats.map((stat, index) => {
    const info = categories[stat.category] || { name: '其他', icon: '◇' };
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
  container.innerHTML = domains.map(domain => `<div class="domain-row"><div><div class="domain-name">${escapeHtml(domain.domain)}</div><div class="domain-meta">${domain.visits} 次访问 · ${escapeHtml(domain.categoryName || '全部分类')}</div></div><div class="domain-meta"><span>${formatDuration(domain.duration)}</span> <button class="ghost" data-correct-domain="${escapeHtml(domain.domain)}" data-correct-cat="${domain.category || 'other'}" style="min-height:28px;padding:2px 8px;font-size:11px;">修改分类</button></div></div>`).join('');
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
  if (trendChart) trendChart.destroy();
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dailyTrend.map(item => { const date = new Date(item.date); return `${date.getMonth() + 1}/${date.getDate()}`; }),
      datasets: [
        { label: '时长（分钟）', data: dailyTrend.map(item => Math.round((item.duration || 0) / 60)), borderColor: '#1a73e8', backgroundColor: 'rgba(26,115,232,.10)', tension: .36, fill: true, yAxisID: 'y' },
        { label: '访问次数', data: dailyTrend.map(item => item.visits), borderColor: '#34a853', backgroundColor: 'rgba(52,168,83,.10)', tension: .36, fill: true, yAxisID: 'y1' }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(32,33,36,.08)' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }, x: { grid: { display: false } } } }
  });
}
function renderHourlyChart(hourlyDist) {
  if (hourlyChart) hourlyChart.destroy();
  const active = hourlyDist.filter(item => item.duration > 0);
  const ctx = document.getElementById('hourlyChart').getContext('2d');
  hourlyChart = new Chart(ctx, { type: 'bar', data: { labels: active.map(item => `${item.hour}:00`), datasets: [{ label: '分钟', data: active.map(item => Math.round(item.duration / 60)), backgroundColor: active.map((_, index) => palette[index % palette.length]), borderRadius: 8 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(32,33,36,.08)' } }, x: { grid: { display: false } } } } });
}
function renderBlackholes(blackholes) {
  const container = document.getElementById('blackholeStats');
  if (!blackholes || !blackholes.top_blackholes || !blackholes.top_blackholes.length) {
    container.innerHTML = '<div class="empty">没有发现明显时间黑洞。</div>';
    return;
  }
  const items = blackholes.top_blackholes.slice(0, 5).map(item => `<div class="domain-row"><div><div class="domain-name">${escapeHtml(item.domain)}</div><div class="domain-meta">${item.long_sessions_count} 次长访问 · 最长 ${formatDuration(item.longest_session)}</div></div><div class="domain-meta">${formatDuration(item.total_duration)}</div></div>`).join('');
  container.innerHTML = `<div class="status-note danger">浪费时间占比 ${Number(blackholes.waste_percentage || 0).toFixed(1)}% · 共 ${formatDuration(blackholes.total_wasted_time)}</div>${items}`;
}
function renderAttentionCurve(attentionCurve) {
  const statsContainer = document.getElementById('attentionStats');
  if (!attentionCurve || !attentionCurve.hourly_focus) {
    statsContainer.innerHTML = '<div class="empty">暂无足够数据生成专注曲线。</div>';
    return;
  }
  const recommendation = attentionCurve.recommendations && attentionCurve.recommendations[0] ? `<div class="status-note">${escapeHtml(attentionCurve.recommendations[0])}</div>` : '';
  statsContainer.innerHTML = `<div class="metric-grid"><div class="metric"><span>专注分数</span><strong>${Math.round(attentionCurve.focus_score || 0)}</strong></div><div class="metric"><span>高效时段</span><strong>${(attentionCurve.peak_hours || []).length}</strong></div></div>${recommendation}`;
  if (attentionChart) attentionChart.destroy();
  const activeHours = attentionCurve.hourly_focus.filter(item => item.total_duration > 0);
  if (!activeHours.length) return;
  const ctx = document.getElementById('attentionChart').getContext('2d');
  attentionChart = new Chart(ctx, { type: 'line', data: { labels: activeHours.map(item => `${item.hour}:00`), datasets: [{ label: '专注度', data: activeHours.map(item => item.score), borderColor: '#1a73e8', backgroundColor: 'rgba(26,115,232,.10)', tension: .36, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(32,33,36,.08)' } }, x: { grid: { display: false } } } } });
}
function renderAIAnalysis(analysis) {
  const container = document.getElementById('aiAnalysisResult');
  const issues = (analysis.issues || []).map(issue => `<li>${escapeHtml(issue)}</li>`).join('') || '<li>暂未发现明显问题。</li>';
  const suggestions = (analysis.suggestions || []).map(suggestion => `<li>${escapeHtml(suggestion)}</li>`).join('') || '<li>暂无建议。</li>';
  container.innerHTML = `<div class="setting-row"><div><strong>行为总结</strong><p class="muted">${escapeHtml(analysis.summary || '暂无总结。')}</p></div></div><div class="inline-grid"><div><strong>发现的问题</strong><ul class="muted">${issues}</ul></div><div><strong>优化建议</strong><ul class="muted">${suggestions}</ul></div></div>`;
}
function renderReports(reports) {
  const container = document.getElementById('reportList');
  if (!reports || !reports.length) {
    container.innerHTML = '<div class="empty">暂无历史报告。</div>';
    return;
  }
  const typeLabels = { ai_analysis: 'AI 分析', ai_7d: '7 天 AI 分析', ai_14d: '14 天 AI 分析', ai_30d: '30 天 AI 分析' };
  container.innerHTML = reports.slice(0, 5).map(report => {
    const typeLabel = typeLabels[report.report_type] || report.report_type || '';
    return `<div class="domain-row"><div><div class="domain-name">${escapeHtml(report.report_date || report.created_at || '未知日期')}${typeLabel ? ` <span style="font-weight:400;color:var(--muted);font-size:11px;">${escapeHtml(typeLabel)}</span>` : ''}</div><div class="domain-meta">${escapeHtml(report.ai_summary || '无总结')}</div></div><div class="domain-meta">${formatDuration(report.total_duration)}</div></div>`;
  }).join('');
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
  if (!(await dataSync.checkConnection())) {
    renderAdvancedEmpty('后端未连接，暂时无法加载高级分析。');
    return;
  }
  await dataSync.initUserId();
  const response = await fetch(`${dataSync.apiBaseUrl}/api/advanced-analysis/${dataSync.userId}?days=${preferences.analysisDays}&blackhole_threshold=${preferences.blackholeThresholdMinutes}`);
  if (response.status === 404) {
    renderAdvancedEmpty('云端数据正在准备中，同步后再刷新洞察。');
    return;
  }
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || '高级分析失败');
  }
  const analysis = await response.json();
  renderBlackholes(analysis.blackholes);
  renderAttentionCurve(analysis.attention_curve);
}
async function loadReports() {
  await initDataSync();
  if (!(await dataSync.checkConnection())) {
    renderReports([]);
    return;
  }
  await dataSync.initUserId();
  const response = await fetch(`${dataSync.apiBaseUrl}/api/reports/${dataSync.userId}?limit=5`);
  if (!response.ok) throw new Error('历史报告加载失败');
  renderReports(await response.json());
}
async function refreshInsights() {
  const button = document.getElementById('refreshInsightsBtn');
  setButtonBusy(button, true, '刷新中...');
  try {
    await loadAdvancedInsights();
    await loadReports();
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
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
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
  const { classificationOverrides = {} } = await chrome.storage.local.get('classificationOverrides');
  const classifier = new WebsiteClassifier(classificationOverrides);
  const classifiedData = classifier.classifyBatch(cleanedData);
  const analyzer = new StatisticsAnalyzer(classifiedData);
  const categoryStats = analyzer.analyzeByCategory();
  const hourlyDist = analyzer.getHourlyDistribution();
  const { analysisDays } = await getPreferences();
  const dailyTrend = calculateDailyTrend(classifiedData, analysisDays);
  currentClassifiedData = classifiedData;
  renderMetrics(classifiedData);
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
  const connected = await dataSync.checkConnection();
  const syncText = lastSyncTime ? `上次同步：${new Date(lastSyncTime).toLocaleString('zh-CN')}` : '尚未同步。';
  const days = preferences.analysisDays;
  document.getElementById('statusNote').textContent = `${connected ? '云服务器连接正常。' : '无法连接云服务器。'} 已载入 ${analytics.count} 条本地记录。${analytics.topCategoryText} ${syncText} 当前分析窗口：${days} 天。`;
  document.getElementById('analysisWindowDesc').textContent = `查看最近 ${days} 天的访问、分类、时段和高频站点。`;
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
  try { const preferences = await getPreferences(); await initDataSync(); if (!(await dataSync.checkConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); log('开始 AI 分析...'); const response = await fetch(`${dataSync.apiBaseUrl}/api/ai-analysis/${dataSync.userId}?days=${preferences.analysisDays}`, { method: 'POST' }); if (!response.ok) { const error = await response.json(); throw new Error(error.detail || 'AI 分析失败'); } const analysis = await response.json(); renderAIAnalysis(analysis); await loadReports(); setNote(`AI 分析完成：${analysis.summary}`, 'success'); log(`AI 总结：${analysis.summary}`); await switchSidebarTab('insights', { focusPanel: true }); } catch (error) { setNote(`AI 分析失败：${error.message}`, 'danger'); log(`AI 分析失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function createGoal() {
  const button = document.getElementById('createGoalBtn');
  setButtonBusy(button, true, '添加中...');
  try { await initDataSync(); if (!(await dataSync.checkConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); const goalType = document.getElementById('goalTypeSelect').value; const durationMinutes = parseInt(document.getElementById('goalDurationInput').value, 10); if (!durationMinutes || durationMinutes <= 0) throw new Error('请输入有效的目标时长'); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal_type: goalType, category: categoryMap[goalType], target_duration: durationMinutes * 60, date: todayString() }) }); if (!response.ok) { const error = await response.json(); throw new Error(error.detail || '创建目标失败'); } setNote('目标已添加', 'success'); log(`已添加目标：${goalTypeNames[goalType]} ${durationMinutes} 分钟`); await loadGoals(); } catch (error) { setNote(`创建目标失败：${error.message}`, 'danger'); log(`创建目标失败：${error.message}`); } finally { setButtonBusy(button, false); }
}
async function loadGoals() {
  const list = document.getElementById('goalList');
  try { await initDataSync(); if (!(await dataSync.checkConnection())) { list.innerHTML = '<div class="goal-card"><div><strong>云服务器未连接</strong><p class="muted">连接后可管理目标。</p></div></div>'; return; } await dataSync.initUserId(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}?date=${todayString()}&is_active=1`); if (!response.ok) throw new Error('获取目标失败'); const goals = await response.json(); if (!goals.length) { list.innerHTML = '<div class="goal-card"><div><strong>暂无目标</strong><p class="muted">添加一个今日目标开始追踪。</p></div></div>'; return; } list.innerHTML = goals.map(goal => `<div class="goal-card"><div><strong>${goalTypeNames[goal.goal_type] || goal.goal_type}</strong><p class="muted">${formatDuration(goal.current_progress)} / ${formatDuration(goal.target_duration)} · ${Number(goal.progress_percentage || 0).toFixed(1)}%</p></div><div class="button-row compact"><button class="secondary" data-goal-edit-id="${goal.id}" data-goal-duration="${Math.round(goal.target_duration / 60)}">编辑</button><button class="ghost" data-goal-disable-id="${goal.id}">停用</button><button class="danger" data-goal-id="${goal.id}">删除</button></div></div>`).join(''); list.querySelectorAll('[data-goal-id]').forEach(button => button.addEventListener('click', () => deleteGoal(button.dataset.goalId))); list.querySelectorAll('[data-goal-disable-id]').forEach(button => button.addEventListener('click', () => deactivateGoal(button.dataset.goalDisableId))); list.querySelectorAll('[data-goal-edit-id]').forEach(button => button.addEventListener('click', () => editGoalDuration(button.dataset.goalEditId, button.dataset.goalDuration))); } catch (error) { list.innerHTML = `<div class="goal-card"><div><strong>加载失败</strong><p class="muted">${error.message}</p></div></div>`; }
}
async function refreshGoalProgress() {
  const button = document.getElementById('refreshGoalsBtn');
  setButtonBusy(button, true, '刷新中...');
  try { await initDataSync(); if (!(await dataSync.checkConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}/update-progress?date=${encodeURIComponent(todayString())}`, { method: 'POST' }); if (!response.ok) throw new Error('刷新目标进度失败'); setNote('目标进度已刷新', 'success'); log('目标进度已刷新'); await loadGoals(); } catch (error) { setNote(`目标刷新失败：${error.message}`, 'danger'); log(`目标刷新失败：${error.message}`); } finally { setButtonBusy(button, false); }
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
async function saveApiBaseUrl() { const button = document.getElementById('saveApiBtn'); setButtonBusy(button, true, '保存中...'); try { const preferences = readPreferencesFromForm(); await chrome.storage.local.set(preferences); await initDataSync(); setNote('插件设置已保存', 'success'); log(`设置已保存：${preferences.apiBaseUrl}`); await refreshDashboard(); } finally { setButtonBusy(button, false); } }
async function resetApiBaseUrl() { const button = document.getElementById('resetApiBtn'); setButtonBusy(button, true, '恢复中...'); try { await chrome.storage.local.set({ ...DEFAULT_PREFERENCES }); await initDataSync(); await loadPreferences(); setNote('已恢复默认插件设置', 'success'); log('已恢复默认插件设置'); await refreshDashboard(); } finally { setButtonBusy(button, false); } }
async function testApiConnection() { const button = document.getElementById('testApiBtn'); setButtonBusy(button, true, '测试中...'); try { await initDataSync(); const connected = await dataSync.checkConnection(); setNote(connected ? '连接成功' : '连接失败，请检查云服务器服务', connected ? 'success' : 'danger'); log(connected ? '后端连接测试成功' : '后端连接测试失败'); } finally { setButtonBusy(button, false); } }
async function exportJson() { const { browsingData = [] } = await chrome.storage.local.get('browsingData'); const blob = new Blob([JSON.stringify(browsingData, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `browsemind-${todayString()}.json`; a.click(); URL.revokeObjectURL(url); setNote('JSON 已导出', 'success'); log(`已导出 ${browsingData.length} 条本地记录`); }
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
function bindEvents() { document.getElementById('refreshBtn').addEventListener('click', refreshDashboard); document.getElementById('refreshBtnActions').addEventListener('click', refreshDashboard); document.getElementById('refreshInsightsBtn').addEventListener('click', refreshInsights); document.getElementById('categoryFilterInput').addEventListener('change', renderFilteredDomains); document.getElementById('domainFilterInput').addEventListener('input', () => {
  clearTimeout(domainFilterTimer);
  domainFilterTimer = setTimeout(renderFilteredDomains, 250);
}); document.getElementById('syncBtn').addEventListener('click', syncNow); document.getElementById('aiBtn').addEventListener('click', runAIAnalysis); document.getElementById('createGoalBtn').addEventListener('click', createGoal); document.getElementById('refreshGoalsBtn').addEventListener('click', refreshGoalProgress); document.getElementById('saveApiBtn').addEventListener('click', saveApiBaseUrl); document.getElementById('resetApiBtn').addEventListener('click', resetApiBaseUrl); document.getElementById('testApiBtn').addEventListener('click', testApiConnection); document.getElementById('exportJsonBtn').addEventListener('click', exportJson); document.getElementById('clearLocalBtn').addEventListener('click', clearLocalData); document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar); document.querySelectorAll('[data-sidebar-tab]').forEach(button => { button.addEventListener('click', () => switchSidebarTab(button.dataset.sidebarTab, { focusPanel: true })); button.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); moveSidebarTabFocus(button.dataset.sidebarTab, 1); } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); moveSidebarTabFocus(button.dataset.sidebarTab, -1); } else if (event.key === 'Home') { event.preventDefault(); const firstButton = document.querySelector('[data-sidebar-tab="dashboard"]'); if (firstButton) { switchSidebarTab('dashboard'); firstButton.focus(); } } else if (event.key === 'End') { event.preventDefault(); const lastTab = SIDEBAR_TABS[SIDEBAR_TABS.length - 1]; const lastButton = document.querySelector(`[data-sidebar-tab="${lastTab}"]`); if (lastButton) { switchSidebarTab(lastTab); lastButton.focus(); } } }); }); }

document.addEventListener('DOMContentLoaded', async () => { await loadSidebarState(); bindEvents(); applySidebarState(); await switchSidebarTab(activeSidebarTab); await refreshDashboard(); });
window.addEventListener('resize', () => {
  if (activeSidebarTab === 'dashboard') {
    if (trendChart) trendChart.resize();
    if (hourlyChart) hourlyChart.resize();
  }
});
