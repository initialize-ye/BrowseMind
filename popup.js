// BrowseMind Popup 脚本 - 展示浏览数据统计（图表增强版）

// 通用确认弹窗（替代原生 confirm）
function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '确认操作');
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-content" style="max-width:340px;text-align:center;"><p id="_confirmMsg" style="margin:0 0 16px;font-size:13px;color:var(--text);"></p><div style="display:flex;gap:8px;justify-content:center;"><button class="action-btn" id="_confirmCancel">取消</button><button class="action-btn primary" id="_confirmOk">确定</button></div></div>`;
    overlay.querySelector('#_confirmMsg').textContent = message;
    document.body.appendChild(overlay);
    overlay.querySelector('#_confirmCancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('#_confirmOk').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    overlay.querySelector('#_confirmOk').focus();
  });
}

let currentChart = null;
let chartData = null;
let attentionChart = null;
let dataSync = null;
// prefersReducedMotion, chartAnimation, todayString, getChartPalette, invalidateChartPalette, CATEGORY_MAP, GOAL_TYPE_NAMES are defined in shared.js
// getPreferences(), DEFAULT_PREFERENCES, escapeHtml are defined in dataSync.js

async function initDataSync(preferences) {
  const prefs = preferences || await getPreferences();
  dataSync = new DataSync(prefs.apiBaseUrl);
  return dataSync;
}

// popup 内轻量 toast 通知（替代 alert）
function notifyPopup(type, message, duration = 3000) {
  let toast = document.getElementById('popupToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'popupToast';
    toast.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:500;opacity:0;transition:opacity 0.2s;pointer-events:none;max-width:90%;text-align:center;';
    document.body.appendChild(toast);
  }
  const colors = { info: 'var(--accent)', warning: 'var(--red)', success: 'var(--green)' };
  toast.style.background = colors[type] || colors.info;
  toast.style.color = '#fff';
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

document.addEventListener('DOMContentLoaded', loadData);
document.getElementById('refreshBtn').addEventListener('click', loadData);
document.getElementById('syncBtn').addEventListener('click', syncToCloud);
document.getElementById('aiAnalysisBtn').addEventListener('click', showAIAnalysis);
document.getElementById('dashboardBtn').addEventListener('click', openDashboard);
document.getElementById('cleanOldBtn').addEventListener('click', cleanOldData);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('addGoalBtn').addEventListener('click', openGoalModal);
document.getElementById('closeGoalModal').addEventListener('click', closeGoalModal);
document.getElementById('saveGoalBtn').addEventListener('click', createGoal);
document.querySelectorAll('.chart-tab').forEach(btn => {
  btn.addEventListener('click', () => switchChart(btn.dataset.chart, btn));
});

// 专注会话
document.getElementById('focusBtn').addEventListener('click', showFocusPicker);
document.getElementById('closeFocusModal').addEventListener('click', closeFocusModal);
document.getElementById('focusDurationModal').addEventListener('click', function(e) { if (e.target === this) closeFocusModal(); });
document.getElementById('focusCustomBtn').addEventListener('click', () => {
  const input = document.getElementById('focusCustomInput');
  const m = parseInt(input.value, 10);
  if (!m || m <= 0 || m > 240) return;
  closeFocusModal();
  startFocusFromPopup(m);
});
document.getElementById('focusStopBtn').addEventListener('click', stopFocusFromPopup);

// 记录搜索
let _recordSearchTimer = null;
document.getElementById('recordSearchInput')?.addEventListener('input', () => {
  clearTimeout(_recordSearchTimer);
  _recordSearchTimer = setTimeout(() => {
    const search = (document.getElementById('recordSearchInput').value || '').toLowerCase().trim();
    const filtered = search
      ? _popupAllRecords.filter(r => (r.domain || '').toLowerCase().includes(search) || (r.title || '').toLowerCase().includes(search))
      : _popupAllRecords;
    renderPopupRecords(filtered.slice(0, search ? 50 : 10));
  }, 200);
});

// 快捷键
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); loadData(); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); syncToCloud(); }
  else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); openDashboard(); }
  else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); showFocusPicker(); }
  else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); showAIAnalysis(); }
  else if (e.key === 'Escape') {
    hideContextMenu();
  }
});

let _popupFocusTimer = null;
let _popupAllRecords = [];

async function showFocusPicker() {
  const preferences = await getPreferences();
  const durations = (preferences.focusDurations || '25,45,60').split(/[,，]/).map(s => parseInt(s.trim())).filter(n => n > 0 && n <= 240);
  const btnContainer = document.getElementById('focusDurationButtons');
  btnContainer.innerHTML = durations.map(m => `<button class="action-btn focus-pick-btn" data-minutes="${m}" style="flex:1;min-width:60px;">${m} 分</button>`).join('');
  btnContainer.querySelectorAll('.focus-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeFocusModal();
      startFocusFromPopup(parseInt(btn.dataset.minutes));
    });
  });
  document.getElementById('focusCustomInput').value = '';
  document.getElementById('focusDurationModal').style.display = 'flex';
  setupModalFocusTrap('focusDurationModal', closeFocusModal);
}

function closeFocusModal() {
  const modal = document.getElementById('focusDurationModal');
  modal.style.display = 'none';
  document.getElementById('focusBtn').dataset.picking = '';
  document.getElementById('focusBtn').textContent = '专注';
}

async function startFocusFromPopup(minutes) {
  await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 2000);
    chrome.runtime.sendMessage({ action: 'startFocus', durationMinutes: minutes }, res => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) console.warn('sendMessage:', chrome.runtime.lastError.message);
      resolve(res);
    });
  });
  loadFocusStatus();
}

async function stopFocusFromPopup() {
  await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 2000);
    chrome.runtime.sendMessage({ action: 'stopFocus' }, res => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) console.warn('sendMessage:', chrome.runtime.lastError.message);
      resolve(res);
    });
  });
  loadFocusStatus();
}

async function loadFocusStatus() {
  let status = { active: false };
  try {
    status = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ active: false }), 2000);
      chrome.runtime.sendMessage({ action: 'focusStatus' }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) { resolve({ active: false }); return; }
        resolve(res?.status || { active: false });
      });
    });
  } catch {}
  const bar = document.getElementById('focusStatusBar');
  const text = document.getElementById('focusStatusText');
  const stopBtn = document.getElementById('focusStopBtn');
  const focusBtn = document.getElementById('focusBtn');

  if (status.active) {
    bar.style.display = 'flex';
    const remaining = status.remainingSeconds;
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    text.textContent = `专注中 ${min}:${String(sec).padStart(2, '0')} · 打断 ${status.interruptions} 次`;
    focusBtn.disabled = true;
    clearTimeout(_popupFocusTimer);
    _popupFocusTimer = setTimeout(loadFocusStatus, 1000);
  } else {
    bar.style.display = 'none';
    focusBtn.disabled = false;
    clearTimeout(_popupFocusTimer);
    _popupFocusTimer = null;
  }
}

// 当前站点追踪
let _siteTrackerTimer = null;
function updateCurrentSite() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const bar = document.getElementById('currentSiteBar');
    const nameEl = document.getElementById('currentSiteName');
    const timeEl = document.getElementById('currentSiteTime');
    if (!bar || !tabs || !tabs[0] || !tabs[0].url) {
      if (bar) bar.style.display = 'none';
      return;
    }
    const tab = tabs[0];
    try {
      const url = new URL(tab.url);
      if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
        bar.style.display = 'none';
        return;
      }
      const domain = url.hostname.replace(/^www\./, '');
      nameEl.textContent = domain;
      bar.style.display = 'flex';

      // 从 background 获取当前标签停留时间
      chrome.runtime.sendMessage({ action: 'focusStatus' }, res => {
        if (chrome.runtime.lastError) return;
        // 显示域名即可，时长由 background 追踪
      });
    } catch {
      bar.style.display = 'none';
    }
  });
}

// 连接状态指示器
async function updateConnectionStatus() {
  const dot = document.getElementById('connStatus');
  const aiBtn = document.getElementById('aiAnalysisBtn');
  if (!dot || !dataSync) return;
  try {
    const connected = await dataSync.checkConnection();
    dot.style.background = connected ? 'var(--green)' : 'var(--red)';
    dot.title = connected ? '已连接后端' : '后端未连接';
    if (aiBtn) {
      aiBtn.disabled = !connected;
      aiBtn.title = connected ? '' : '后端未连接，无法使用 AI 分析';
    }
  } catch {
    dot.style.background = 'var(--red)';
    dot.title = '后端未连接';
    if (aiBtn) { aiBtn.disabled = true; aiBtn.title = '后端未连接，无法使用 AI 分析'; }
  }
}

const loadingMessages = ['正在唤醒分析引擎...', '整理你的浏览足迹...', '数据马上就绪...'];
let _loadingMsgTimer = null;
function startLoadingRotation() {
  const el = document.getElementById('loadingMsg');
  if (!el) return;
  let i = 0;
  _loadingMsgTimer = setInterval(() => { i = (i + 1) % loadingMessages.length; el.textContent = loadingMessages[i]; }, 1800);
}
function stopLoadingRotation() { clearInterval(_loadingMsgTimer); _loadingMsgTimer = null; }

// 弹窗数据加载管线：读取 storage → 分类处理 → 渲染统计/图表/排行 → 加载目标和习惯评分
async function loadData() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const emptyState = document.getElementById('emptyState');

  loading.style.display = 'block';
  content.style.display = 'none';
  emptyState.style.display = 'none';
  startLoadingRotation();

  try {
    const storage = await chrome.storage.local.get(['browsingData', 'classificationOverrides', 'classificationFeedback', 'themeMode', 'accentColor', 'fontSize', 'chartScheme']);
    const preferences = await getPreferences();
    await initDataSync(preferences);
    // 应用主题设置
    const { themeMode = 'light', accentColor = '', fontSize = 'medium', chartScheme = 'default' } = storage;
    const html = document.documentElement;
    if (themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    if (accentColor) applyAccentColor(accentColor);
    if (fontSize !== 'medium') html.setAttribute('data-font-size', fontSize); else html.removeAttribute('data-font-size');
    if (chartScheme !== 'default') html.setAttribute('data-chart-scheme', chartScheme); else html.removeAttribute('data-chart-scheme');
    invalidateChartPalette();
    updateCurrentSite();
    clearInterval(_siteTrackerTimer);
    _siteTrackerTimer = setInterval(updateCurrentSite, 5000);
    const browsingData = validateBrowsingData(storage.browsingData);

    if (browsingData.length === 0) {
      stopLoadingRotation(); loading.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    // 数据处理和分类
    const processor = new DataProcessor(browsingData);
    const cleanedData = processor.clean().getData();

    const classificationOverrides = storage.classificationOverrides || {};
    const classificationFeedback = storage.classificationFeedback || {};
    const classifier = new WebsiteClassifier(classificationOverrides, classificationFeedback);
    const classifiedData = classifier.classifyBatch(cleanedData);

    // 统计分析
    const analyzer = new StatisticsAnalyzer(classifiedData);
    const categoryStats = analyzer.analyzeByCategory();
    const todayStats = analyzer.getTodayStats();
    const hourlyDist = analyzer.getHourlyDistribution();
    const dailyTrend = calculateDailyTrend(classifiedData, preferences.analysisDays);
    // Update analysis window labels
    document.getElementById('categoryStatsLabel').textContent = `${preferences.analysisDays} 天`;
    document.getElementById('weeklyStatsLabel').textContent = `${preferences.analysisDays} 天`;

    // 保存数据供图表使用
    chartData = {
      categoryStats,
      todayStats,
      hourlyDist,
      dailyTrend,
      classifier
    };

    // 计算基础统计（使用已清洗和分类的数据，避免重复计算）
    const stats = calculateStats(classifiedData);

    // 摘要卡片（今日 vs 昨日）
    renderSummaryCard(classifiedData);

    // 更新UI
    updateUI(stats, classifiedData, categoryStats, todayStats, classifier);

    // 绘制默认图表（饼图）
    drawPieChart();

    // 加载目标、高级分析和专注状态
    updateConnectionStatus();
    await loadGoals();
    await loadAdvancedAnalysis();
    await loadFocusStatus();

    // 习惯评分
    try {
      const { focusSessions = [] } = await chrome.storage.local.get('focusSessions');
      const scorer = new HabitScorer(classifiedData, focusSessions);
      const todayScore = scorer.computeDailyScore(todayString());
      const scoreEl = document.getElementById('habitScore');
      if (scoreEl) {
        scoreEl.textContent = todayScore ?? '--';
        if (todayScore !== null) {
          scoreEl.style.color = todayScore >= 70 ? 'var(--green)' : todayScore >= 40 ? 'var(--yellow)' : 'var(--red)';
        }
      }
    } catch (e) { console.warn('习惯评分计算失败:', e); }

    stopLoadingRotation(); loading.style.display = 'none';
    content.style.display = 'block';
    // Batch animation delay writes to avoid forced reflow per element
    const animEls = content.querySelectorAll('.stat-bar, .chart-card, .section');
    animEls.forEach((el, i) => { el.style.animationDelay = `${i * 0.06}s`; });
    requestAnimationFrame(() => { animEls.forEach(el => el.classList.add('fade-in')); });
  } catch (error) {
    console.error('加载数据失败:', error);
    stopLoadingRotation(); loading.style.display = 'none';
    emptyState.style.display = 'block';
    const p = emptyState.querySelector('p:last-child');
    let hint = error.message || '未知错误';
    if (error.message?.includes('QUOTA_BYTES')) {
      hint = '存储空间已满，请在仪表盘清理旧数据';
    } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
      hint = '网络连接异常，请检查网络后重试';
    } else if (error.message?.includes('timeout')) {
      hint = '请求超时，请稍后重试';
    }
    if (p) p.textContent = `加载出错：${hint}`;
  }
}

async function cleanOldData() {
  const btn = document.getElementById('cleanOldBtn');
  try {
    btn.disabled = true;
    btn.textContent = '清理中...';
    const preferences = await getPreferences();
    const { browsingData = [] } = await chrome.storage.local.get('browsingData');
    const retentionStart = Date.now() - preferences.dataRetentionDays * 24 * 60 * 60 * 1000;
    const filtered = browsingData.filter(r => r.visitTime > retentionStart);
    const removed = browsingData.length - filtered.length;
    if (removed === 0) {
      btn.textContent = '无旧数据';
    } else {
      await chrome.storage.local.set({ browsingData: filtered });
      btn.textContent = `已清理 ${removed} 条`;
      loadData();
    }
  } catch (e) {
    btn.textContent = '清理失败';
    console.error('cleanOldData:', e);
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = '清理'; }, 2000);
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

function calculateStats(data) {
  const today = todayString();

  // 今日数据
  const todayData = data.filter(r => r.date === today);
  const todayVisits = todayData.length;
  const todayDuration = todayData.reduce((sum, r) => sum + (r.duration || 0), 0);

  // 当前窗口数据
  const totalVisits = data.length;
  const uniqueSites = new Set(data.map(r => r.domain).filter(Boolean)).size;

  return {
    todayVisits,
    todayDuration,
    totalVisits,
    uniqueSites
  };
}

// 计算每日趋势
// calculateDailyTrend 已移至 shared.js

function updateUI(stats, data, categoryStats, todayStats, classifier) {
  // 更新统计数字
  document.getElementById('todayVisits').textContent = stats.todayVisits;
  document.getElementById('todayDuration').textContent = formatDuration(stats.todayDuration);
  document.getElementById('totalVisits').textContent = stats.totalVisits;
  document.getElementById('uniqueSites').textContent = stats.uniqueSites;

  // 更新分类统计
  updateCategoryStats(categoryStats, classifier);

  // 更新今日分类统计
  updateTodayCategoryStats(todayStats, classifier);

  // 显示最近访问记录
  _popupAllRecords = data.slice().sort((a, b) => b.visitTime - a.visitTime);
  const search = (document.getElementById('recordSearchInput')?.value || '').toLowerCase().trim();
  const filtered = search
    ? _popupAllRecords.filter(r => (r.domain || '').toLowerCase().includes(search) || (r.title || '').toLowerCase().includes(search))
    : _popupAllRecords;
  renderPopupRecords(filtered.slice(0, search ? 50 : 10));
}

function renderPopupRecords(records) {
  const recordsContainer = document.getElementById('recentRecords');
  if (!records.length) {
    recordsContainer.innerHTML = '<div class="empty-state" style="padding:8px;font-size:12px;">没有匹配的记录</div>';
    return;
  }
  recordsContainer.innerHTML = records.map(record => {
    const domain = extractDomain(record.url) || record.url;
    const time = formatTime(record.visitTime);
    const duration = record.duration > 0 ? ` · ${formatDuration(record.duration)}` : '';
    const cat = record.category || 'other';
    return `
      <div class="record-item" data-domain="${escapeHtml(domain)}" data-category="${cat}">
        <div class="record-title">${escapeHtml(record.title || domain)}</div>
        <div class="record-meta">${domain} · ${time}${duration}</div>
      </div>
    `;
  }).join('');
  recordsContainer.querySelectorAll('.record-item').forEach(item => {
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showDomainContextMenu(e, item.dataset.domain, item.dataset.category);
    });
  });
}

// 摘要卡片：今日 vs 昨日
function renderSummaryCard(classifiedData) {
  const card = document.getElementById('summaryCard');
  if (!card) return;
  const today = todayString();
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const todayData = classifiedData.filter(r => r.date === today);
  const yesterdayData = classifiedData.filter(r => r.date === yesterdayStr);
  const todayDuration = todayData.reduce((s, r) => s + (r.duration || 0), 0);
  const yesterdayDuration = yesterdayData.reduce((s, r) => s + (r.duration || 0), 0);
  const todayFocus = todayData.filter(r => r.category === 'learning' || r.category === 'coding').reduce((s, r) => s + (r.duration || 0), 0);
  const focusPct = todayDuration > 0 ? Math.round(todayFocus / todayDuration * 100) : 0;
  const diff = todayDuration - yesterdayDuration;
  const pct = yesterdayDuration > 0 ? Math.round(Math.abs(diff) / yesterdayDuration * 100) : 0;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  const arrowColor = diff > 0 ? 'var(--yellow)' : diff < 0 ? 'var(--green)' : 'var(--muted)';
  card.style.display = 'flex';
  card.innerHTML = `<span style="color:var(--accent);font-weight:700;">学习 ${focusPct}%</span><span style="color:${arrowColor};">${arrow} ${pct}%</span><span>vs 昨日</span><button id="addNoteBtn" style="margin-left:auto;min-height:28px;padding:4px 10px;font-size:11px;" class="ghost">备注</button>`;
  document.getElementById('addNoteBtn')?.addEventListener('click', showNoteInput);
}

// 域名右键菜单
let _contextMenuEl = null;
function showDomainContextMenu(event, domain, currentCategory) {
  hideContextMenu();
  const categories = WebsiteClassifier.CATEGORIES;
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = `position:fixed;left:${Math.min(event.clientX, window.innerWidth - 180)}px;top:${Math.min(event.clientY, window.innerHeight - 220)}px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:0 4px 16px oklch(0% 0 0 / 0.12);z-index:9999;min-width:160px;padding:4px;font-size:12px;`;
  const addItem = (label, onClick, color) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:${color || 'var(--text)'};border-radius:4px;min-height:auto;`;
    btn.addEventListener('click', () => { hideContextMenu(); onClick(); });
    btn.addEventListener('mouseenter', () => btn.style.background = 'var(--surface-2)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
    menu.appendChild(btn);
  };
  addItem(`修改分类 (${WebsiteClassifier.CATEGORY_NAMES[currentCategory] || currentCategory})`, () => showCategoryPickerPopup(domain, currentCategory));
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--line);margin:4px 0;';
  menu.appendChild(sep);
  addItem('添加阻断规则', () => addDomainBlockRule(domain), 'var(--red)');
  addItem('加入白名单', () => addToAllowlist(domain), 'var(--green)');
  document.body.appendChild(menu);
  _contextMenuEl = menu;
  const closeHandler = (e) => { if (!menu.contains(e.target)) { hideContextMenu(); document.removeEventListener('click', closeHandler); } };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}
function hideContextMenu() { if (_contextMenuEl) { _contextMenuEl.remove(); _contextMenuEl = null; } }

function showCategoryPickerPopup(domain, currentCategory) {
  const categories = WebsiteClassifier.CATEGORIES;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:oklch(0% 0 0/0.32);';
  modal.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius-md);padding:20px;max-width:280px;width:100%;"><h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">修改 ${escapeHtml(domain)} 的分类</h3><div style="display:flex;flex-wrap:wrap;gap:6px;">${categories.map(c => `<button class="ghost${c === currentCategory ? ' primary' : ''}" data-cat="${c}" style="min-height:34px;padding:6px 12px;font-size:12px;">${WebsiteClassifier.CATEGORY_NAMES[c]}</button>`).join('')}</div></div>`;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
    const btn = e.target.closest('[data-cat]');
    if (btn) {
      applyCategoryOverride(domain, btn.dataset.cat);
      modal.remove();
    }
  });
  document.body.appendChild(modal);
}

async function applyCategoryOverride(domain, category) {
  const storage = await chrome.storage.local.get(['classificationOverrides']);
  const overrides = storage.classificationOverrides || {};
  overrides[domain] = category;
  await chrome.storage.local.set({ classificationOverrides: overrides });
  loadData();
}

async function addDomainBlockRule(domain) {
  const { rules: rulesJson = '[]' } = await chrome.storage.local.get('rules');
  const rules = JSON.parse(rulesJson);
  // 检查是否已存在
  if (rules.some(r => r.type === 'domain_block' && r.condition?.domain === domain)) {
    notifyPopup('info', `${domain} 已在阻断规则中`);
    return;
  }
  rules.push({
    id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    type: 'domain_block', name: `阻断 ${domain}`, enabled: true,
    condition: { type: 'domain_visit', domain },
    action: { type: 'block' }, priority: 10, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
  });
  await chrome.storage.local.set({ rules: JSON.stringify(rules) });
  notifyPopup('success', `已添加阻断规则：${domain}`);
}

async function addToAllowlist(domain) {
  const { domainAllowlist = '' } = await chrome.storage.local.get('domainAllowlist');
  const list = domainAllowlist.split(/[,，\n\r]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.includes(domain)) {
    list.push(domain);
    await chrome.storage.local.set({ domainAllowlist: list.join(',') });
  }
  notifyPopup('success', `已将 ${domain} 加入白名单`);
}

function showNoteInput() {
  const card = document.getElementById('summaryCard');
  if (!card || card.querySelector('#noteInputArea')) return;
  const area = document.createElement('div');
  area.id = 'noteInputArea';
  area.style.cssText = 'display:flex;gap:var(--space-2);width:100%;margin-top:var(--space-2);';
  area.innerHTML = `<input id="noteInput" type="text" placeholder="记录一下此刻的想法..." style="flex:1;padding:6px 10px;font-size:12px;"><button id="noteSaveBtn" style="min-height:30px;padding:4px 12px;font-size:11px;">保存</button>`;
  card.style.flexWrap = 'wrap';
  card.appendChild(area);
  const input = document.getElementById('noteInput');
  input.focus();
  document.getElementById('noteSaveBtn')?.addEventListener('click', () => addQuickNote(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addQuickNote(input.value); });
}

async function addQuickNote(text) {
  text = (text || '').trim();
  if (!text) return;
  const storage = await chrome.storage.local.get('browsingData');
  const data = storage.browsingData || [];
  data.push({ url: 'note://quick-note', title: text, domain: 'note', category: 'note', visitTime: Date.now(), duration: 0, date: todayString(), isNote: true });
  await chrome.storage.local.set({ browsingData: data });
  const area = document.getElementById('noteInputArea');
  if (area) area.remove();
  notifyPopup('success', '备注已保存');
}

// 更新分类统计
function updateCategoryStats(categoryStats, classifier) {
  const container = document.getElementById('categoryStats');
  if (!categoryStats || categoryStats.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:12px;">暂无分类数据</div>';
    return;
  }
  const categories = classifier.getAllCategories();
  const catColors = getCategoryColors();

  container.innerHTML = categoryStats.map(stat => {
    const categoryInfo = categories[stat.category] || { name: '其他', icon: WebsiteClassifier.SVG.other };
    const percentage = parseFloat(stat.percentage);
    const color = catColors[stat.category] || 'var(--muted)';

    return `
      <div class="category-item">
        <span class="category-dot" style="background:${color}"></span>
        <span class="category-name">${categoryInfo.name}</span>
        <span class="category-meta">${percentage}%</span>
        <div style="flex:0 0 auto;text-align:right;">
          <div class="category-meta">${formatDuration(stat.totalDuration)}</div>
        </div>
      </div>
      <div class="category-bar" style="margin:0 0 4px 17px;">
        <div class="category-bar-fill" style="width: ${percentage}%"></div>
      </div>
    `;
  }).join('');
}

// 更新今日分类统计
function updateTodayCategoryStats(todayStats, classifier) {
  const container = document.getElementById('todayCategoryStats');
  const categories = classifier.getAllCategories();

  if (todayStats.length === 0) {
    container.innerHTML = '<div class="empty-line">今日暂无数据</div>';
    return;
  }

  const catColorsToday = getCategoryColors();
  container.innerHTML = todayStats.slice(0, 5).map(stat => {
    const categoryInfo = categories[stat.category] || { name: '其他', icon: WebsiteClassifier.SVG.other };
    const percentage = parseFloat(stat.percentage);
    const color = catColorsToday[stat.category] || 'var(--muted)';

    return `
      <div class="category-item-compact">
        <span class="category-dot" style="background:${color};width:6px;height:6px;border-radius:50%;flex-shrink:0;"></span>
        <span class="category-name">${categoryInfo.name}</span>
        <span class="category-value">${percentage}%</span>
      </div>
    `;
  }).join('');
}

// 切换图表
function switchChart(type, activeButton) {
  // 更新按钮状态
  document.querySelectorAll('.chart-tab').forEach(btn => {
    btn.classList.remove('active');
  });
  if (activeButton) {
    activeButton.classList.add('active');
  }

  // 绘制对应图表
  if (type === 'pie') {
    drawPieChart();
  } else if (type === 'bar') {
    drawBarChart();
  } else if (type === 'line') {
    drawLineChart();
  }
}

// 绘制饼图 - 分类占比
function drawPieChart() {
  if (!chartData) return;

  const { categoryStats, classifier } = chartData;
  const categories = classifier.getAllCategories();

  // 准备数据
  const labels = categoryStats.map(stat => {
    const info = categories[stat.category] || { name: '其他', icon: WebsiteClassifier.SVG.other };
    return info.name;
  });

  const data = categoryStats.map(stat => stat.totalDuration / 60); // 转换为分钟

  const colors = getChartPalette();

  destroyChart();

  const ctx = document.getElementById('mainChart').getContext('2d');
  currentChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 10,
            font: { size: 11 },
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const minutes = Math.round(context.parsed);
              return ` ${formatDuration(minutes * 60)}`;
            }
          }
        }
      }
    }
  });
}

// 绘制柱状图 - 时间分布
function drawBarChart() {
  if (!chartData) return;

  const colors = getChartPalette();
  const { hourlyDist } = chartData;

  // 准备数据（只显示有数据的小时）
  const activeHours = hourlyDist.filter(h => h.duration > 0);
  const labels = activeHours.map(h => `${h.hour}:00`);
  const data = activeHours.map(h => h.duration / 60); // 转换为分钟

  destroyChart();

  const ctx = document.getElementById('mainChart').getContext('2d');
  currentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '浏览时长（分钟）',
        data: data,
        backgroundColor: colors[0] + 'b3',
        borderRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      normalized: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${formatDuration(context.parsed.y * 60)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 10 }
          }
        },
        x: {
          ticks: {
            font: { size: 10 }
          }
        }
      }
    }
  });
}

// 绘制折线图 - 每日趋势
function drawLineChart() {
  if (!chartData) return;

  const colors = getChartPalette();
  const { dailyTrend } = chartData;

  // 准备数据
  const labels = dailyTrend.map(d => {
    const date = new Date(d.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const durationData = dailyTrend.map(d => d.duration / 60); // 分钟
  const visitsData = dailyTrend.map(d => d.visits);

  destroyChart();

  const ctx = document.getElementById('mainChart').getContext('2d');
  currentChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '浏览时长（分钟）',
          data: durationData,
          borderColor: colors[0],
          backgroundColor: colors[0] + '14',
          tension: 0.35,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: '访问次数',
          data: visitsData,
          borderColor: colors[1],
          backgroundColor: colors[1] + '14',
          tension: 0.35,
          fill: true,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      normalized: true,
      spanGaps: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 8,
            font: { size: 10 },
            usePointStyle: true
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          ticks: { font: { size: 10 } }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 10 } }
        },
        x: {
          ticks: { font: { size: 10 } }
        }
      }
    }
  });
}

// 销毁当前图表
function destroyChart() {
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }
}

// extractDomain 已移至 shared.js

// formatDuration() is defined in dataSync.js (shared with dashboard)

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diff = now - date;

  // 今天
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 7天内
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[date.getDay()] + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 更早
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

// HTML转义 — 使用 dataSync.js 中的 escapeHtml()

// 同步到云端
async function syncToCloud() {
  const syncBtn = document.getElementById('syncBtn');
  const originalText = syncBtn.textContent;

  try {
    if (!dataSync) { await initDataSync(); }
    syncBtn.textContent = '检查连接...';
    syncBtn.disabled = true;

    const isConnected = await dataSync.checkConnection();
    if (!isConnected) {
      notifyPopup('warning', '无法连接服务器，请检查后端服务');
      return;
    }

    syncBtn.textContent = '上传数据...';
    const result = await dataSync.syncLocalData();
    syncBtn.textContent = '同步完成';
    notifyPopup('info', result.message || '同步完成');
    await loadData();

  } catch (error) {
    console.error('同步失败:', error);
    syncBtn.textContent = '同步失败';
    notifyPopup('warning', `同步失败：${error.message}`);
  } finally {
    setTimeout(() => {
      syncBtn.textContent = originalText;
      syncBtn.disabled = false;
    }, 2000);
  }
}

// 显示 AI 分析
let _aiAnalysisRunning = false;
async function showAIAnalysis() {
  if (_aiAnalysisRunning) return;
  _aiAnalysisRunning = true;
  const modal = document.getElementById('aiAnalysisModal');
  const content = document.getElementById('aiAnalysisContent');

  modal.style.display = 'flex';
  setupModalFocusTrap('aiAnalysisModal', closeModal);
  content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>检查连接中...</p></div>';

  try {
    const isConnected = await dataSync.checkConnection();
    if (!isConnected) {
      content.innerHTML = '<p style="color: var(--red); text-align: center;">无法连接到服务器<br>请确保后端服务已启动</p>';
      return;
    }

    content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>准备分析数据...</p></div>';
    await dataSync.initUserId();
    if (!dataSync.userId) { notifyPopup('warning', '用户ID初始化失败'); return; }
    const preferences = await getPreferences();

    content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>AI 正在分析中，请稍候...</p></div>';
    const response = await authFetch(
      `${dataSync.apiBaseUrl}/api/ai-analysis/${dataSync.userId}?days=${preferences.analysisDays}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      let detail = '分析失败';
      try { const err = await response.json(); detail = err.detail || detail; } catch {}
      throw new Error(detail);
    }

    const analysis = await response.json();

    // 显示分析结果
    displayAIAnalysis(analysis);

  } catch (error) {
    console.error('AI 分析失败:', error);
    const isConnection = error.message.includes('连接') || error.message.includes('fetch') || error.message.includes('network');
    content.innerHTML = `
      <p style="color: var(--red); text-align: center;">
        AI 分析失败<br>
        ${escapeHtml(error.message)}<br><br>
        ${error.message.includes('API') ? '请配置 AI_API_KEY 环境变量' : ''}
      </p>
      <div style="margin-top:12px;padding:10px;background:var(--surface-2);border-radius:8px;font-size:12px;text-align:center;">
        <div style="color:var(--muted);margin-bottom:6px;">💡 本地分析仍可用</div>
        <div>仪表盘的「洞察」页面提供本地时间黑洞检测和专注曲线分析，无需后端连接。</div>
        <button onclick="openDashboard()" class="action-btn" style="margin-top:8px;font-size:12px;padding:6px 16px;">打开仪表盘</button>
      </div>
    `;
  } finally {
    _aiAnalysisRunning = false;
  }
}

// 显示 AI 分析结果 — analysis 包含：summary, category_stats, top_domains, issues, suggestions
function displayAIAnalysis(analysis) {
  const content = document.getElementById('aiAnalysisContent');

  // 颜色映射
  const categoryColors = getCategoryColors();
  const categoryNames = WebsiteClassifier.CATEGORY_NAMES;

  // 1. 总结卡片
  let html = `
    <div class="ai-summary-card">
      <div class="ai-summary-label">行为总结</div>
      <p>${escapeHtml(analysis.summary || '暂无总结')}</p>
    </div>
  `;

  // 2. 分类占比条（如果有数据）
  const stats = analysis.category_stats || [];
  if (stats.length > 0) {
    const segments = stats.map(s => {
      const color = categoryColors[s.category] || getChartPalette()[4];
      return `<div class="ai-stacked-segment" style="width:${s.percentage}%;background:${color}"></div>`;
    }).join('');
    const legend = stats.map(s => {
      const color = categoryColors[s.category] || getChartPalette()[4];
      const name = categoryNames[s.category] || s.category;
      return `<span class="ai-legend-item"><span class="ai-legend-dot" style="background:${color}"></span>${name} <span class="ai-legend-pct">${s.percentage}%</span></span>`;
    }).join('');
    html += `
      <div class="ai-bar-chart">
        <div class="ai-bar-chart-title">时间分布</div>
        <div class="ai-stacked-bar">${segments}</div>
        <div class="ai-bar-legend">${legend}</div>
      </div>
    `;
  }

  // 3. 热门网站表格（如果有数据）
  const domains = analysis.top_domains || [];
  if (domains.length > 0) {
    const rows = domains.slice(0, 5).map((d, i) => `
      <tr>
        <td style="color:var(--muted);font-size:11px;">${i + 1}</td>
        <td class="domain-name">${escapeHtml(d.domain)}</td>
        <td>${d.visits} 次</td>
        <td class="domain-dur">${formatDuration(d.totalDuration)}</td>
      </tr>
    `).join('');
    html += `
      <div class="ai-table-wrap">
        <div class="ai-table-title">热门网站 Top 5</div>
        <table class="ai-table">
          <thead><tr><th>#</th><th>网站</th><th>访问</th><th>时长</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // 4. 问题卡片
  const issues = analysis.issues || [];
  const issuesHtml = issues.map(issue =>
    `<li class="ai-issue-card">${escapeHtml(issue)}</li>`
  ).join('') || '<li class="ai-issue-card">暂未发现明显问题。</li>';

  // 5. 建议卡片
  const suggestions = analysis.suggestions || [];
  const suggestionsHtml = suggestions.map(s =>
    `<li class="ai-suggestion-card">${escapeHtml(s)}</li>`
  ).join('') || '<li class="ai-suggestion-card">暂无建议。</li>';

  html += `
    <ul class="ai-card-list">${issuesHtml}</ul>
    <ul class="ai-card-list">${suggestionsHtml}</ul>
  `;

  content.innerHTML = html;
}

// 关闭模态框
function closeModal() {
  const modal = document.getElementById('aiAnalysisModal');
  modal.style.display = 'none';
  document.removeEventListener('keydown', _modalKeyHandler);
  if (modal._returnFocus && typeof modal._returnFocus.focus === 'function') modal._returnFocus.focus();
}

// 点击模态框外部关闭
document.getElementById('aiAnalysisModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('goalModal').addEventListener('click', function(e) {
  if (e.target === this) closeGoalModal();
});

let _modalKeyHandler = null;
function setupModalFocusTrap(modalId, closeFn) {
  const modal = document.getElementById(modalId);
  modal._returnFocus = document.activeElement;
  // 移除上一个模态框的键盘监听器
  if (_modalKeyHandler) document.removeEventListener('keydown', _modalKeyHandler);
  function onKey(e) {
    if (e.key === 'Escape') { closeFn(); return; }
    if (e.key === 'Tab') {
      const focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  _modalKeyHandler = onKey;
  document.addEventListener('keydown', onKey);
  const firstBtn = modal.querySelector('button, input, select, [tabindex]');
  if (firstBtn) setTimeout(() => firstBtn.focus(), 50);
}

function displayAdvancedAnalysisEmptyState(message = '同步云端数据后将显示高级分析结果') {
  const blackholeContainer = document.getElementById('blackholeStats');
  const attentionStatsContainer = document.getElementById('attentionStats');

  blackholeContainer.innerHTML = `<p class="empty-line">${escapeHtml(message)}</p>`;
  attentionStatsContainer.innerHTML = `<p class="empty-line">${escapeHtml(message)}</p>`;

  if (attentionChart) {
    attentionChart.destroy();
    attentionChart = null;
  }
}

// 自动加载高级分析
// 高级分析缓存
let _analysisCache = { data: null, time: 0 };
const ANALYSIS_CACHE_TTL = 60000; // 60 秒

// 高级分析：优先从后端获取，失败时回退到本地 LocalAdvancedAnalyzer
async function loadAdvancedAnalysis() {
  try {
    const isConnected = await dataSync.checkConnection();
    if (isConnected) {
      // 检查缓存
      const now = Date.now();
      if (_analysisCache.data && now - _analysisCache.time < ANALYSIS_CACHE_TTL) {
        displayBlackholes(_analysisCache.data.blackholes);
        displayAttentionCurve(_analysisCache.data.attentionCurve);
        return;
      }

      await dataSync.initUserId();
      if (!dataSync.userId) return;
      const preferences = await getPreferences();
      const response = await authFetch(
        `${dataSync.apiBaseUrl}/api/advanced-analysis/${dataSync.userId}?days=${preferences.analysisDays}&blackhole_threshold=${preferences.blackholeThresholdMinutes}`
      );

      if (response.ok) {
        const analysis = await response.json();
        _analysisCache = { data: analysis, time: now };
        displayBlackholes(analysis.blackholes);
        displayAttentionCurve(analysis.attentionCurve);
        return;
      }

      if (response.status !== 404) {
        let detail = '分析失败';
        try { const err = await response.json(); detail = err.detail || detail; } catch {}
        throw new Error(detail);
      }
    }

    // 后端不可用或无云端数据 — 使用本地离线分析
    const { browsingData = [] } = await chrome.storage.local.get('browsingData');
    if (!browsingData.length) {
      displayAdvancedAnalysisEmptyState('暂无浏览数据，无法进行高级分析');
      return;
    }
    const preferences = await getPreferences();
    const cleanedData = new DataProcessor(browsingData).clean().getData();
    const localAnalyzer = new LocalAdvancedAnalyzer(preferences.blackholeThresholdMinutes);
    const analysis = localAnalyzer.analyzeAll(cleanedData, preferences.blackholeThresholdMinutes);
    displayBlackholes(analysis.blackholes);
    displayAttentionCurve(analysis.attentionCurve);
  } catch (error) {
    console.error('高级分析失败:', error);
    displayAdvancedAnalysisEmptyState('高级分析暂时不可用，请稍后重试');
  }
}

// 显示时间黑洞
function displayBlackholes(blackholes) {
  renderBlackholesToContainer(document.getElementById('blackholeStats'), blackholes, {
    maxItems: 3,
    emptyMsg: '没有时间黑洞 — 你的浏览节奏很好',
    useShortLabels: true
  });
}

// 显示注意力曲线
function displayAttentionCurve(attentionCurve) {
  const statsContainer = document.getElementById('attentionStats');

  // 显示统计信息
  const focusScore = attentionCurve.focusScore;
  const peakHours = attentionCurve.peakHours;
  const recommendations = attentionCurve.recommendations;

  let statsHtml = `
    <div class="attention-stats">
      <div class="attention-stat-item">
        <div class="attention-stat-value">${focusScore}</div>
        <div class="attention-stat-label">专注度分数</div>
      </div>
      <div class="attention-stat-item">
        <div class="attention-stat-value">${peakHours.length}</div>
        <div class="attention-stat-label">高效时段</div>
      </div>
    </div>
  `;

  if (recommendations && recommendations.length > 0) {
    statsHtml += `
      <div style="margin-top: 12px; padding: 10px; background: var(--accent-soft); border-radius: 8px; font-size: 11px; color: var(--muted);">
        ${escapeHtml(recommendations[0])}
      </div>
    `;
  }

  statsContainer.innerHTML = statsHtml;

  // 绘制注意力曲线图
  drawAttentionChart(attentionCurve.hourlyFocus);
}

// 绘制注意力曲线图
function drawAttentionChart(hourlyFocus) {
  // 销毁旧图表
  if (attentionChart) {
    attentionChart.destroy();
    attentionChart = null;
  }

  // 只显示有数据的小时
  const activeHours = hourlyFocus.filter(h => h.totalDuration > 0);
  if (activeHours.length === 0) {
    const statsContainer = document.getElementById('attentionStats');
    statsContainer.innerHTML = '<p class="empty-line">暂无足够数据生成注意力曲线</p>';
    return;
  }

  const labels = activeHours.map(h => `${h.hour}:00`);
  const data = activeHours.map(h => h.score);

  const ctx = document.getElementById('attentionChart').getContext('2d');
  const attColors = getChartPalette();
  attentionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '专注度',
        data: data,
        borderColor: attColors[0],
        backgroundColor: attColors[0] + '14',
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
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` 专注度: ${context.parsed.y.toFixed(1)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { font: { size: 9 } }
        },
        x: {
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

// ==================== 目标管理功能 ====================

// 目标缓存：避免重复请求
let _goalsCache = { data: null, time: 0 };
const GOALS_CACHE_TTL = 30000; // 30 秒

async function loadGoals() {
  try {
    const { userId } = await chrome.storage.local.get('userId');
    if (!userId || !dataSync) return;

    // 检查缓存
    const now = Date.now();
    if (_goalsCache.data && now - _goalsCache.time < GOALS_CACHE_TTL) {
      displayGoals(_goalsCache.data);
      return;
    }

    const isConnected = await dataSync.checkConnection().catch(() => false);
    if (!isConnected) return;

    const today = todayString();
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${userId}?date=${today}&is_active=1`);

    if (!response.ok) {
      console.error('获取目标失败');
      return;
    }

    const goals = await response.json();
    _goalsCache = { data: goals, time: now };
    displayGoals(goals);
  } catch (error) {
    console.error('加载目标失败:', error);
    const container = document.getElementById('goalsContainer');
    if (container) container.innerHTML = '<p class="empty-line">加载目标失败，请稍后重试</p>';
  }
}

function displayGoals(goals) {
  const container = document.getElementById('goalsContainer');

  if (!goals || goals.length === 0) {
    container.innerHTML = '<p class="empty-line">还没有目标 — 设一个小目标开始追踪吧</p>';
    return;
  }

  container.innerHTML = goals.map(goal => {
    const percentage = goal.progress_percentage;
    const isWarning = percentage >= 80;
    const isAchieved = percentage >= 100;

    let statusClass = 'normal';
    let statusText = '进行中';
    if (isAchieved) {
      statusClass = 'achieved';
      statusText = '已完成';
    } else if (isWarning) {
      statusClass = 'warning';
      statusText = '即将超标';
    }

    return `
      <div class="goal-item ${isAchieved ? 'achieved' : ''}">
        <div class="goal-header">
          <span class="goal-type">${escapeHtml(GOAL_TYPE_NAMES[goal.goal_type] || goal.goal_type)}</span>
          <div>
            <span class="goal-status ${statusClass}">${statusText}</span>
            <button class="goal-delete" data-goal-id="${escapeHtml(String(goal.id))}" aria-label="删除目标">×</button>
          </div>
        </div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill ${isWarning ? 'warning' : ''}" style="width: ${Math.min(percentage, 100)}%"></div>
        </div>
        <div class="goal-meta">
          <span>${formatDuration(goal.current_progress)} / ${formatDuration(goal.target_duration)}</span>
          <span>${percentage.toFixed(1)}%</span>
        </div>
      </div>
    `;
  }).join('');

  // 添加删除事件监听
  container.querySelectorAll('.goal-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const goalId = e.target.dataset.goalId;
      deleteGoal(goalId);
    });
  });
}

function openGoalModal() {
  const modal = document.getElementById('goalModal');
  modal.style.display = 'flex';
  _modalKeyHandler = null;
  setupModalFocusTrap('goalModal', closeGoalModal);
}

function closeGoalModal() {
  const modal = document.getElementById('goalModal');
  modal.style.display = 'none';
  document.removeEventListener('keydown', _modalKeyHandler);
  if (modal._returnFocus && typeof modal._returnFocus.focus === 'function') modal._returnFocus.focus();
}

let _savingGoal = false;
async function createGoal() {
  if (_savingGoal) return;
  _savingGoal = true;
  const saveBtn = document.getElementById('saveGoalBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中...'; }
  try {
    const { userId } = await chrome.storage.local.get('userId');
    if (!userId) {
      notifyPopup('warning', '请先同步数据');
      return;
    }

    const goalType = document.getElementById('goalTypeSelect').value;
    const durationMinutes = parseInt(document.getElementById('goalDurationInput').value);

    if (!durationMinutes || durationMinutes <= 0 || durationMinutes > 1440) {
      notifyPopup('warning', '请输入有效的时长（1-1440 分钟）');
      return;
    }

    const today = todayString();

    const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal_type: goalType,
        category: CATEGORY_MAP[goalType],
        target_duration: durationMinutes * 60,
        date: today
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      notifyPopup('warning', error.detail || '创建目标失败');
      return;
    }

    closeGoalModal();
    await loadGoals();
    notifyPopup('success', '目标已创建');
  } catch (error) {
    console.error('保存目标失败:', error);
    notifyPopup('warning', '保存失败，请重试');
  } finally {
    _savingGoal = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '添加目标'; }
  }
}

let _deletingGoal = false;
async function deleteGoal(goalId) {
  if (_deletingGoal) return;
  if (!await showConfirm('确定要删除这个目标吗？')) {
    return;
  }
  _deletingGoal = true;
  try {
    if (!dataSync) { await initDataSync(); }
    const response = await authFetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      notifyPopup('warning', '删除失败');
      return;
    }

    await loadGoals();
  } catch (error) {
    console.error('删除目标失败:', error);
    notifyPopup('warning', '删除失败，请重试');
  } finally {
    _deletingGoal = false;
  }
}


function showNotification(type, message) {
  // MV3 popup 无法直接调用 chrome.notifications，委托 background 代发
  chrome.runtime.sendMessage({ action: 'showNotification', type, message }).catch(() => {});
}
