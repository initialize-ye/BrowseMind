const DEFAULT_API_BASE_URL = 'http://119.29.55.112:8000';
const DEFAULT_PREFERENCES = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  autoSyncEnabled: true,
  autoSyncDebounceMs: 15000,
  autoSyncMinIntervalMs: 2 * 60 * 1000,
  dataRetentionDays: 7,
  minVisitDurationSeconds: 3,
  notificationsEnabled: true,
  blackholeThresholdMinutes: 30,
  analysisDays: 7
};
const palette = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#5f6368', '#9aa0a6'];
const categoryMap = { daily_learning: 'learning', daily_entertainment: 'entertainment', daily_coding: 'coding', daily_social: 'social' };
const goalTypeNames = { daily_learning: '每日学习时长', daily_entertainment: '每日娱乐时长限制', daily_coding: '每日编程时长', daily_social: '每日社交时长限制' };
let dataSync = null;
let trendChart = null;
let hourlyChart = null;
let activeSidebarTab = 'actions';
let isSidebarCollapsed = false;

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
  box.textContent = `[${time}] ${message}\n${box.textContent}`;
}
function setNote(message, type = 'info') {
  const note = document.getElementById('operationNote');
  note.style.display = 'block';
  note.className = `note ${type === 'success' ? 'success' : type === 'danger' ? 'danger' : ''}`;
  note.textContent = message;
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
async function switchSidebarTab(tab) {
  activeSidebarTab = tab;
  document.querySelectorAll('[data-sidebar-tab]').forEach(button => {
    const isActive = button.dataset.sidebarTab === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('[data-sidebar-panel]').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.sidebarPanel === tab);
  });
  await chrome.storage.local.set({ dashboardActiveSidebarTab: tab });
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
    analysisDays: Math.max(1, Number(document.getElementById('analysisDaysInput').value || 7))
  };
}
async function initDataSync() {
  const apiBaseUrl = await getApiBaseUrl();
  dataSync = new DataSync(apiBaseUrl);
  return dataSync;
}

function calculateDailyTrend(data) {
  const dailyStats = {};
  data.forEach(record => {
    const date = record.date;
    if (!dailyStats[date]) dailyStats[date] = { date, visits: 0, duration: 0 };
    dailyStats[date].visits++;
    dailyStats[date].duration += record.duration || 0;
  });
  return Object.values(dailyStats).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-7);
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
  container.innerHTML = domains.map(domain => `<div class="domain-row"><div><div class="domain-name">${escapeHtml(domain.domain)}</div><div class="domain-meta">${domain.visits} 次访问</div></div><div class="domain-meta">${formatDuration(domain.duration)}</div></div>`).join('');
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

async function loadAnalytics() {
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  if (!browsingData.length) {
    renderMetrics([]);
    renderCategoryList([], new WebsiteClassifier());
    renderDomainList([]);
    renderTrendChart([]);
    renderHourlyChart([]);
    return { count: 0, topCategoryText: '暂无本地浏览数据。' };
  }
  const processor = new DataProcessor(browsingData);
  const cleanedData = processor.clean().getData();
  const classifier = new WebsiteClassifier();
  const classifiedData = classifier.classifyBatch(cleanedData);
  const analyzer = new StatisticsAnalyzer(classifiedData);
  const categoryStats = analyzer.analyzeByCategory();
  const hourlyDist = analyzer.getHourlyDistribution();
  const dailyTrend = calculateDailyTrend(classifiedData);
  const topDomains = calculateTopDomains(classifiedData);
  renderMetrics(classifiedData);
  renderCategoryList(categoryStats, classifier);
  renderDomainList(topDomains);
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
  document.getElementById('statusNote').textContent = `${connected ? '云服务器连接正常。' : '无法连接云服务器。'} 已载入 ${analytics.count} 条本地记录。${analytics.topCategoryText} ${syncText} 当前分析窗口：${preferences.analysisDays} 天。`;
  await loadGoals();
  log(`刷新完成：${analytics.count} 条记录，用户 ${userId ? userId.slice(0, 10) + '…' : '未生成'}`);
}
async function syncNow() {
  try { await initDataSync(); log('开始同步本地数据...'); const result = await dataSync.syncLocalData(); setNote(result.message || '同步完成', 'success'); log(`同步完成：${result.message || '成功'}`); await refreshDashboard(); } catch (error) { setNote(`同步失败：${error.message}`, 'danger'); log(`同步失败：${error.message}`); }
}
async function runAIAnalysis() {
  try { const preferences = await getPreferences(); await initDataSync(); if (!(await dataSync.checkConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); log('开始 AI 分析...'); const response = await fetch(`${dataSync.apiBaseUrl}/api/ai-analysis/${dataSync.userId}?days=${preferences.analysisDays}`, { method: 'POST' }); if (!response.ok) { const error = await response.json(); throw new Error(error.detail || 'AI 分析失败'); } const analysis = await response.json(); setNote(`AI 分析完成：${analysis.summary}`, 'success'); log(`AI 总结：${analysis.summary}`); } catch (error) { setNote(`AI 分析失败：${error.message}`, 'danger'); log(`AI 分析失败：${error.message}`); }
}
async function createGoal() {
  try { await initDataSync(); if (!(await dataSync.checkConnection())) throw new Error('无法连接后端服务'); await dataSync.initUserId(); const goalType = document.getElementById('goalTypeSelect').value; const durationMinutes = parseInt(document.getElementById('goalDurationInput').value, 10); if (!durationMinutes || durationMinutes <= 0) throw new Error('请输入有效的目标时长'); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal_type: goalType, category: categoryMap[goalType], target_duration: durationMinutes * 60, date: todayString() }) }); if (!response.ok) { const error = await response.json(); throw new Error(error.detail || '创建目标失败'); } setNote('目标已添加', 'success'); log(`已添加目标：${goalTypeNames[goalType]} ${durationMinutes} 分钟`); await loadGoals(); } catch (error) { setNote(`创建目标失败：${error.message}`, 'danger'); log(`创建目标失败：${error.message}`); }
}
async function loadGoals() {
  const list = document.getElementById('goalList');
  try { await initDataSync(); if (!(await dataSync.checkConnection())) { list.innerHTML = '<div class="goal-card"><div><strong>云服务器未连接</strong><p class="muted">连接后可管理目标。</p></div></div>'; return; } await dataSync.initUserId(); const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}?date=${todayString()}&is_active=1`); if (!response.ok) throw new Error('获取目标失败'); const goals = await response.json(); if (!goals.length) { list.innerHTML = '<div class="goal-card"><div><strong>暂无目标</strong><p class="muted">添加一个今日目标开始追踪。</p></div></div>'; return; } list.innerHTML = goals.map(goal => `<div class="goal-card"><div><strong>${goalTypeNames[goal.goal_type] || goal.goal_type}</strong><p class="muted">${formatDuration(goal.current_progress)} / ${formatDuration(goal.target_duration)} · ${goal.progress_percentage.toFixed(1)}%</p></div><button class="danger" data-goal-id="${goal.id}">删除</button></div>`).join(''); list.querySelectorAll('[data-goal-id]').forEach(button => button.addEventListener('click', () => deleteGoal(button.dataset.goalId))); } catch (error) { list.innerHTML = `<div class="goal-card"><div><strong>加载失败</strong><p class="muted">${error.message}</p></div></div>`; }
}
async function deleteGoal(goalId) {
  if (!confirm('确定删除这个目标吗？')) return;
  try { const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'DELETE' }); if (!response.ok) throw new Error('删除失败'); setNote('目标已删除', 'success'); log(`已删除目标 #${goalId}`); await loadGoals(); } catch (error) { setNote(`删除目标失败：${error.message}`, 'danger'); log(`删除目标失败：${error.message}`); }
}
async function saveApiBaseUrl() { const preferences = readPreferencesFromForm(); await chrome.storage.local.set(preferences); await initDataSync(); setNote('插件设置已保存', 'success'); log(`设置已保存：${preferences.apiBaseUrl}`); await refreshDashboard(); }
async function resetApiBaseUrl() { await chrome.storage.local.set({ ...DEFAULT_PREFERENCES }); await initDataSync(); await loadPreferences(); setNote('已恢复默认插件设置', 'success'); log('已恢复默认插件设置'); await refreshDashboard(); }
async function testApiConnection() { await initDataSync(); const connected = await dataSync.checkConnection(); setNote(connected ? '连接成功' : '连接失败，请检查云服务器服务', connected ? 'success' : 'danger'); log(connected ? '后端连接测试成功' : '后端连接测试失败'); }
async function exportJson() { const { browsingData = [] } = await chrome.storage.local.get('browsingData'); const blob = new Blob([JSON.stringify(browsingData, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `browsemind-${todayString()}.json`; a.click(); URL.revokeObjectURL(url); setNote('JSON 已导出', 'success'); log(`已导出 ${browsingData.length} 条本地记录`); }
async function clearLocalData() { if (!confirm('确定清空本地浏览数据吗？此操作不可恢复。')) return; await chrome.storage.local.set({ browsingData: [] }); setNote('本地数据已清空', 'success'); log('本地浏览数据已清空'); await refreshDashboard(); }
function bindEvents() { document.getElementById('refreshBtn').addEventListener('click', refreshDashboard); document.getElementById('syncBtn').addEventListener('click', syncNow); document.getElementById('aiBtn').addEventListener('click', runAIAnalysis); document.getElementById('createGoalBtn').addEventListener('click', createGoal); document.getElementById('saveApiBtn').addEventListener('click', saveApiBaseUrl); document.getElementById('resetApiBtn').addEventListener('click', resetApiBaseUrl); document.getElementById('testApiBtn').addEventListener('click', testApiConnection); document.getElementById('exportJsonBtn').addEventListener('click', exportJson); document.getElementById('clearLocalBtn').addEventListener('click', clearLocalData); document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar); document.querySelectorAll('[data-sidebar-tab]').forEach(button => button.addEventListener('click', () => switchSidebarTab(button.dataset.sidebarTab))); }

document.addEventListener('DOMContentLoaded', async () => { await loadSidebarState(); bindEvents(); applySidebarState(); await switchSidebarTab(activeSidebarTab); await refreshDashboard(); });
