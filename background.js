// BrowseMind 后台服务 - 负责监听标签页活动和记录浏览数据

importScripts('dataProcessor.js', 'dataSync.js');
// getPreferences(), DEFAULT_API_BASE_URL, DEFAULT_PREFERENCES are defined in dataSync.js

const DEBUG = false;
function log(...args) { if (DEBUG) console.log('[BrowseMind]', ...args); }

// 日期工具（本地时间，不能用 toISOString 因为它返回 UTC）
function _todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _toLocalDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// getPreferences 缓存（5 秒 TTL），避免热路径重复读取 storage
let _prefsCache = null;
let _prefsCacheTime = 0;
async function getCachedPreferences() {
  const now = Date.now();
  if (_prefsCache && now - _prefsCacheTime < 5000) return _prefsCache;
  _prefsCache = await getPreferences();
  _prefsCacheTime = now;
  return _prefsCache;
}

// WebsiteClassifier 缓存（overrides/feedback 不变时复用实例）
let _classifierCache = null;
let _classifierKey = '';
function getCachedClassifier(overrides = {}, feedback = {}) {
  const key = JSON.stringify(overrides) + '|' + JSON.stringify(feedback);
  if (_classifierCache && _classifierKey === key) return _classifierCache;
  _classifierCache = new WebsiteClassifier(overrides, feedback);
  _classifierKey = key;
  return _classifierCache;
}

let _autoSyncTimer = null;
let _isAutoSyncing = false;
let _recentRecordKeys = null; // Set-based dedup cache for addBrowsingRecord

// 存储当前活跃标签的信息
let _activeTab = {
  tabId: null,
  url: null,
  title: null,
  startTime: null
};

// 专注会话状态
let _focusSession = {
  active: false,
  startTime: null,
  durationMinutes: 0,
  endTime: null,
  interruptions: 0,
  domains: new Set()
};

// 初始化：加载历史记录 + 创建右键菜单 + 生成认证 token
chrome.runtime.onInstalled.addListener(async () => {
  try {
    log('BrowseMind 已安装');
    // 生成认证 token（首次安装时）
    const { authToken } = await chrome.storage.local.get('authToken');
    if (!authToken) {
      const token = crypto.randomUUID();
      await chrome.storage.local.set({ authToken: token });
      log('已生成认证 token');
    }
    await migrateOrCreateRules();
    collectHistoryData();
    createContextMenus();
  } catch (e) {
    console.warn('onInstalled 处理失败:', e);
  }
});

// 首次启动或升级时：将旧设置迁移为规则，或创建默认规则
async function migrateOrCreateRules() {
  const { rules: rulesJson } = await chrome.storage.local.get('rules');
  if (rulesJson && rulesJson !== '[]') return; // 已有规则，跳过

  const stored = await chrome.storage.local.get([
    'categoryTimeLimits', 'domainBlocklist', 'focusModeEnabled',
    'continuousEntertainmentMinutes', 'interventionsEnabled'
  ]);

  const rules = [];
  const _ruleId = () => 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  // 迁移 categoryTimeLimits → limit 规则
  if (stored.categoryTimeLimits) {
    (stored.categoryTimeLimits || '').split(/[,，\n\r]+/).forEach(pair => {
      const [cat, min] = pair.split(':').map(s => s.trim());
      if (cat && min && !isNaN(Number(min))) {
        rules.push({
          id: _ruleId(), type: 'limit', name: `${WebsiteClassifier.CATEGORY_NAMES[cat] || cat}限制`, enabled: true,
          condition: { type: 'category_duration', category: cat.toLowerCase(), operator: 'gte', value: Number(min) * 60 },
          action: { type: 'notify' }, priority: 0, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
        });
      }
    });
  }

  // 迁移 domainBlocklist → domain_block 规则
  if (stored.domainBlocklist) {
    (stored.domainBlocklist || '').split(/[,，\n\r]+/).forEach(d => {
      const domain = d.trim().toLowerCase().replace(/^\*\./, '');
      if (domain) {
        rules.push({
          id: _ruleId(), type: 'domain_block', name: `阻断 ${domain}`, enabled: true,
          condition: { type: 'domain_visit', domain },
          action: { type: 'block' }, priority: 10, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
        });
      }
    });
  }

  // 迁移 focusModeEnabled → limit 规则（娱乐/社交 0 分钟 = 立即触发）
  if (stored.focusModeEnabled === true || stored.focusModeEnabled === 'true') {
    rules.push({
      id: _ruleId(), type: 'limit', name: '专注模式', enabled: true,
      condition: { type: 'category_duration', category: 'entertainment', operator: 'gte', value: 0 },
      action: { type: 'notify' }, priority: 5, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
    });
  }

  // 迁移 continuousEntertainmentMinutes → limit 规则
  if (stored.continuousEntertainmentMinutes && Number(stored.continuousEntertainmentMinutes) > 0) {
    rules.push({
      id: _ruleId(), type: 'limit', name: '连续娱乐提醒', enabled: true,
      condition: { type: 'continuous_duration', category: 'entertainment', operator: 'gte', value: Number(stored.continuousEntertainmentMinutes) * 60 },
      action: { type: 'notify' }, priority: 3, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
    });
  }

  // 如果没有任何迁移规则，创建默认预置规则
  if (!rules.length) {
    rules.push(
      {
        id: _ruleId(), type: 'limit', name: '每日娱乐限制', enabled: true,
        condition: { type: 'category_duration', category: 'entertainment', operator: 'gte', value: 1800 },
        action: { type: 'notify' }, priority: 0, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
      },
      {
        id: _ruleId(), type: 'limit', name: '连续娱乐提醒', enabled: true,
        condition: { type: 'continuous_duration', category: 'entertainment', operator: 'gte', value: 1200 },
        action: { type: 'notify' }, priority: 3, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
      },
      {
        id: _ruleId(), type: 'goal', name: '每日学习目标', enabled: true,
        condition: { type: 'category_duration', category: 'learning', operator: 'lte', value: 3600 },
        action: { type: 'notify' }, priority: 0, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
      }
    );
  }

  await chrome.storage.local.set({ rules: JSON.stringify(rules) });
  log(`规则迁移完成：创建 ${rules.length} 条规则`);
}

// ==================== 右键菜单 ====================

function createContextMenus() {
  chrome.contextMenus.create({
    id: 'bm-parent',
    title: 'BrowseMind',
    contexts: ['page', 'link']
  });
  chrome.contextMenus.create({
    id: 'bm-allowlist',
    parentId: 'bm-parent',
    title: '将此站点加入白名单',
    contexts: ['page', 'link']
  });
  chrome.contextMenus.create({
    id: 'bm-blocklist',
    parentId: 'bm-parent',
    title: '将此站点加入黑名单',
    contexts: ['page', 'link']
  });
  chrome.contextMenus.create({
    id: 'bm-dashboard',
    parentId: 'bm-parent',
    title: '打开仪表盘',
    contexts: ['page', 'link']
  });
}

function extractDomain(url) {
  try {
    return WebsiteClassifier.normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

async function appendToList(listKey, domain) {
  const stored = await chrome.storage.local.get(listKey);
  const list = (stored[listKey] || '').split(/[,，\n\r]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.includes(domain)) return false;
  list.push(domain);
  await chrome.storage.local.set({ [listKey]: list.join(',') });
  return true;
}

async function addDomainBlockRule(domain) {
  const { rules: rulesJson = '[]' } = await chrome.storage.local.get('rules');
  const rules = JSON.parse(rulesJson);
  if (rules.some(r => r.type === 'domain_block' && r.condition?.domain === domain)) {
    showNotification('info', `${domain} 已在阻断规则中`);
    return;
  }
  rules.push({
    id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    type: 'domain_block', name: `阻断 ${domain}`, enabled: true,
    condition: { type: 'domain_visit', domain },
    action: { type: 'block' }, priority: 10, dailyProgress: 0, lastTriggered: 0, createdAt: new Date().toISOString()
  });
  await chrome.storage.local.set({ rules: JSON.stringify(rules) });
  await syncDynamicRules();
  showNotification('warning', `已添加阻断规则：${domain}`);
}

async function openDashboard() {
  const url = chrome.runtime.getURL('dashboard.html');
  await chrome.tabs.create({ url });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const url = info.linkUrl || info.pageUrl;
    const domain = extractDomain(url);

    switch (info.menuItemId) {
      case 'bm-allowlist':
        if (!domain) return;
        if (await appendToList('domainAllowlist', domain)) {
          showNotification('info', `已将 ${domain} 加入白名单`);
        } else {
          showNotification('info', `${domain} 已在白名单中`);
        }
        break;
      case 'bm-blocklist':
        if (!domain) return;
        await addDomainBlockRule(domain);
        break;
      case 'bm-dashboard':
        openDashboard();
        break;
    }
  } catch (e) {
    console.warn('contextMenu 处理失败:', e);
  }
});

// 一次性读取偏好与分类覆盖（供 saveTabDuration + checkTabIntervention 共用）
async function getSharedContext() {
  try {
    const [preferences, { classificationOverrides = {}, classificationFeedback = {} }] = await Promise.all([
      getCachedPreferences(),
      chrome.storage.local.get(['classificationOverrides', 'classificationFeedback'])
    ]);
    return { preferences, classificationOverrides, classificationFeedback };
  } catch (e) {
    console.warn('getSharedContext 失败，使用默认值:', e);
    return { preferences: { ...DEFAULT_PREFERENCES }, classificationOverrides: {}, classificationFeedback: {} };
  }
}

// 监听标签页激活（用户切换标签）
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const ctx = await getSharedContext();
    await saveTabDuration(ctx);
    const tab = await chrome.tabs.get(activeInfo.tabId);
    startTrackingTab(tab);
    await checkTabIntervention(tab, ctx);
  } catch (e) {
    console.warn('onActivated 处理失败:', e);
  }
});

// 监听标签页更新（URL变化）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    if (changeInfo.status === 'complete' && tab.active) {
      const ctx = await getSharedContext();
      await saveTabDuration(ctx);
      startTrackingTab(tab);
      await checkTabIntervention(tab, ctx);
    }
  } catch (e) {
    console.warn('onUpdated 处理失败:', e);
  }
});

// 监听窗口焦点变化
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  try {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      const ctx = await getSharedContext();
      await saveTabDuration(ctx);
      _activeTab = { tabId: null, url: null, title: null, startTime: null };
    } else {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) {
        const ctx = await getSharedContext();
        startTrackingTab(tab);
        await checkTabIntervention(tab, ctx);
      }
    }
  } catch (e) {
    console.warn('onFocusChanged 处理失败:', e);
  }
});

// 开始追踪标签页
function startTrackingTab(tab) {
  if (!tab.url || tab.url.startsWith('chrome://')) return;

  _activeTab = {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    startTime: Date.now()
  };
}

// 检查当前标签是否需要干预提醒（可接收预读的共享上下文）
async function checkTabIntervention(tab, ctx) {
  try {
    if (!tab.url || tab.url.startsWith('chrome://')) return;
    const preferences = ctx?.preferences || await getPreferences();
    if (!preferences.interventionsEnabled) return;
    const overrides = ctx?.classificationOverrides ?? (await chrome.storage.local.get('classificationOverrides')).classificationOverrides ?? {};
    const feedback = ctx?.classificationFeedback ?? (await chrome.storage.local.get('classificationFeedback')).classificationFeedback ?? {};
    const classifier = getCachedClassifier(overrides, feedback);
    const domain = WebsiteClassifier.normalizeDomain(new URL(tab.url).hostname);
    const category = classifier.classify(domain, tab.title || '', tab.url);

    // 自适应阈值：用户切换到非娱乐站点 = 回应了之前的干预
    if (category !== 'entertainment' && category !== 'social') {
      const { interventionResponseLog = [] } = await chrome.storage.local.get('interventionResponseLog');
      const unanswered = interventionResponseLog.filter(r => r.responded === false);
      if (unanswered.length > 0) {
        const fiveMinAgo = Date.now() - 5 * 60 * 1000;
        unanswered.forEach(r => { if (r.time < fiveMinAgo) r.responded = true; });
        await chrome.storage.local.set({ interventionResponseLog });
      }
    }

    await evaluateRules(domain, category);
  } catch (e) {
    console.error('checkTabIntervention error:', e);
  }
}

// 保存标签页停留时间（可接收预读的共享上下文）
async function saveTabDuration(ctx) {
  if (!_activeTab.startTime || !_activeTab.url) return;

  const preferences = ctx?.preferences || await getPreferences();
  const duration = Math.floor((Date.now() - _activeTab.startTime) / 1000); // 秒
  if (duration < preferences.minVisitDurationSeconds) return;

  const overrides = ctx?.classificationOverrides ?? (await chrome.storage.local.get('classificationOverrides')).classificationOverrides ?? {};
  const feedback = ctx?.classificationFeedback ?? (await chrome.storage.local.get('classificationFeedback')).classificationFeedback ?? {};
  const classifier = getCachedClassifier(overrides, feedback);
  let domain = null;
  try { domain = WebsiteClassifier.normalizeDomain(new URL(_activeTab.url).hostname); } catch {}
  const category = classifier.classify(domain || '', _activeTab.title || '', _activeTab.url);

  const record = {
    url: _activeTab.url,
    title: _activeTab.title,
    domain: domain,
    category: category,
    visitTime: _activeTab.startTime,
    duration: duration,
    date: _toLocalDate(_activeTab.startTime)
  };

  // 存储到 chrome.storage
  await addBrowsingRecord(record);
}

// 构建记录指纹键（5秒窗口内视为同一条）
function recordKey(r) {
  const bucket = Math.floor(r.visitTime / 5000) * 5000;
  return r.url + '|' + bucket;
}

// 初始化记录指纹缓存
async function ensureRecordCache(browsingData) {
  if (!_recentRecordKeys) {
    if (!browsingData) {
      const { browsingData: data = [] } = await chrome.storage.local.get('browsingData');
      browsingData = data;
    }
    _recentRecordKeys = new Set(browsingData.map(recordKey));
  }
}

// 添加浏览记录到存储（O(1) 去重，保留由 cleanOldData alarm 处理）
// 写入缓冲：批量合并多次写入为一次 storage.set
let _pendingRecords = [];
let _flushTimer = null;

async function addBrowsingRecord(record) {
  await ensureRecordCache(null);
  const key = recordKey(record);
  if (_recentRecordKeys.has(key)) return;

  _recentRecordKeys.add(key);
  _pendingRecords.push(record);

  // 50ms 内的多次写入合并为一次
  if (!_flushTimer) {
    _flushTimer = setTimeout(flushPendingRecords, 50);
  }
}

async function flushPendingRecords() {
  _flushTimer = null;
  if (!_pendingRecords.length) return;
  // Swap out before await — new records arriving during the write
  // go into a fresh array and get flushed on the next cycle.
  const toFlush = _pendingRecords;
  _pendingRecords = [];
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  browsingData.push(...toFlush);
  await chrome.storage.local.set({ browsingData });
  // If new records arrived while we were writing, schedule another flush
  if (_pendingRecords.length && !_flushTimer) {
    _flushTimer = setTimeout(flushPendingRecords, 50);
  }
}

// 从 Chrome 历史 API 采集数据，与本地记录合并（按 url+visitTime 去重）
async function collectHistoryData() {
  const preferences = await getPreferences();
  const retentionStart = Date.now() - preferences.dataRetentionDays * 24 * 60 * 60 * 1000;

  // 避免每次 onInstalled 和 alarm 都重复拉取（但允许手动清空数据后重新采集）
  const { lastCollectTime = 0, browsingData: existingData = [] } = await chrome.storage.local.get(['lastCollectTime', 'browsingData']);
  if (lastCollectTime > retentionStart && existingData.length > 0) return;

  const historyItems = await new Promise((resolve) => {
    try {
      chrome.history.search({
        text: '',
        startTime: retentionStart,
        maxResults: 1000,
        maxItems: 1000
      }, (items) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(items || []);
      });
    } catch {
      resolve([]);
    }
  });

  // 初始化分类器，为历史记录补充 domain 和 category
  const { classificationOverrides = {}, classificationFeedback = {} } = await chrome.storage.local.get(['classificationOverrides', 'classificationFeedback']);
  const classifier = getCachedClassifier(classificationOverrides, classificationFeedback);

  const records = historyItems
    .filter(item => item.url && !item.url.startsWith('chrome://'))
    .map(item => {
      let domain = null;
      try { domain = WebsiteClassifier.normalizeDomain(new URL(item.url).hostname); } catch {}
      const category = domain ? classifier.classify(domain, item.title || '', item.url) : 'other';
      return {
        url: item.url,
        title: item.title,
        domain: domain,
        category: category,
        visitTime: item.lastVisitTime,
        duration: 0,
        date: _toLocalDate(item.lastVisitTime)
      };
    });

  // 合并策略：已有的本地记录（含 duration > 0 和 domain/category）优先
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const existingMap = new Map(browsingData.map(r => [`${r.url}-${r.visitTime}`, r]));

  // 仅在 key 不冲突，或历史记录能补充缺失字段时才写入
  for (const hist of records) {
    const key = `${hist.url}-${hist.visitTime}`;
    if (!existingMap.has(key)) {
      existingMap.set(key, hist);
    }
  }

  const unique = Array.from(existingMap.values());
  await chrome.storage.local.set({ browsingData: unique, lastCollectTime: Date.now() });
  log(`已采集 ${records.length} 条历史记录，合并后共 ${unique.length} 条`);
}

// 定期清理旧数据（每小时执行一次）
chrome.alarms.create('cleanOldData', { periodInMinutes: 60 });

// 恢复专注会话状态（service worker 重启后）
chrome.storage.local.get('_activeFocusSession').then(({ _activeFocusSession: s }) => {
  if (s && s.active && s.endTime > Date.now()) {
    _focusSession = { ...s, domains: new Set() };
    chrome.action.setBadgeText({ text: 'F' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    log('已恢复专注会话状态');
  }
});

// ==================== 专注会话 ====================

function startFocusSession(durationMinutes) {
  if (_focusSession.active) {
    endFocusSession(false).catch(e => console.warn('结束旧专注会话失败:', e));
  }
  const now = Date.now();
  _focusSession = {
    active: true,
    startTime: now,
    durationMinutes,
    endTime: now + durationMinutes * 60 * 1000,
    interruptions: 0,
    domains: new Set()
  };
  // 持久化专注会话状态，防止 service worker 重启丢失
  chrome.storage.local.set({ _activeFocusSession: {
    active: true, startTime: now, durationMinutes,
    endTime: _focusSession.endTime, interruptions: 0
  }});
  chrome.alarms.create('_focusSessionEnd', { delayInMinutes: durationMinutes });
  chrome.action.setBadgeText({ text: 'F' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  log(`专注会话开始：${durationMinutes} 分钟`);
}

async function endFocusSession(completed = true) {
  if (!_focusSession.active) return;
  const now = Date.now();
  const actualDuration = Math.floor((now - _focusSession.startTime) / 1000);

  const session = {
    startTime: _focusSession.startTime,
    endTime: now,
    plannedDuration: _focusSession.durationMinutes * 60,
    actualDuration,
    completed,
    interruptions: _focusSession.interruptions,
    domains: Array.from(_focusSession.domains)
  };

  // 保存到本地
  const { focusSessions = [] } = await chrome.storage.local.get('focusSessions');
  focusSessions.push(session);
  await chrome.storage.local.set({ focusSessions });

  _focusSession = { active: false, startTime: null, durationMinutes: 0, endTime: null, interruptions: 0, domains: new Set() };
  chrome.storage.local.remove('_activeFocusSession');
  chrome.alarms.clear('_focusSessionEnd');
  chrome.action.setBadgeText({ text: '' });
  log(`专注会话结束：${completed ? '完成' : '中断'}，实际 ${actualDuration} 秒`);
}

function getFocusStatus() {
  if (!_focusSession.active) return { active: false };
  return {
    active: true,
    startTime: _focusSession.startTime,
    durationMinutes: _focusSession.durationMinutes,
    endTime: _focusSession.endTime,
    remainingSeconds: Math.max(0, Math.floor((_focusSession.endTime - Date.now()) / 1000)),
    interruptions: _focusSession.interruptions
  };
}

function recordFocusInterruption(domain) {
  if (!_focusSession.active) return;
  _focusSession.interruptions++;
  _focusSession.domains.add(domain);
}

// 定期兜底同步浏览数据（每5分钟）
chrome.alarms.create('syncBrowsingData', { periodInMinutes: 5 });

// Service worker 启动时同步阻断规则到 declarativeNetRequest
syncDynamicRules().catch(e => console.warn('syncDynamicRules init failed:', e));

// 每日摘要检查（每小时）
chrome.alarms.create('dailySummary', { periodInMinutes: 60 });

async function cleanOldData() {
  const preferences = await getPreferences();
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const retentionStart = Date.now() - preferences.dataRetentionDays * 24 * 60 * 60 * 1000;
  const filtered = browsingData.filter(r => r.visitTime > retentionStart);
  if (filtered.length !== browsingData.length) {
    await chrome.storage.local.set({ browsingData: filtered });
    log(`清理旧数据：${browsingData.length - filtered.length} 条已移除`);
    // 重置去重缓存，避免已清理记录的 key 阻止重新记录
    _recentRecordKeys = null;
  }
}

async function checkDailySummary() {
  const preferences = await getPreferences();
  if (!preferences.dailySummaryEnabled || !preferences.notificationsEnabled) return;
  if (isInQuietHours(preferences)) return;

  const now = new Date();
  // 使用 >= 而非精确匹配，防止 alarm 偏移导致跳过目标小时
  if (now.getHours() < preferences.dailySummaryHour) return;

  const today = _todayString();
  const { lastDailySummary = '' } = await chrome.storage.local.get('lastDailySummary');
  if (lastDailySummary === today) return;

  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const todayData = browsingData.filter(r => r.date === today);
  if (!todayData.length) return;

  const totalDuration = todayData.reduce((s, r) => s + (r.duration || 0), 0);
  const uniqueDomains = new Set(todayData.map(r => r.domain).filter(Boolean)).size;

  // 分类统计
  const catStats = {};
  for (const r of todayData) {
    const cat = r.category || 'other';
    catStats[cat] = (catStats[cat] || 0) + (r.duration || 0);
  }
  const topCat = Object.entries(catStats).sort((a, b) => b[1] - a[1])[0];
  const topCatText = topCat ? `${WebsiteClassifier.CATEGORY_NAMES[topCat[0]] || topCat[0]} ${Math.round(topCat[1] / 60)}分钟` : '';

  const hours = Math.floor(totalDuration / 3600);
  const minutes = Math.round((totalDuration % 3600) / 60);
  const durationText = hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;

  const message = `今日浏览 ${durationText}，${uniqueDomains} 个站点。${topCatText ? '最多：' + topCatText + '。' : ''}共 ${todayData.length} 次访问。`;

  await showNotification('info', message);
  await chrome.storage.local.set({ lastDailySummary: today });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === 'cleanOldData') {
      cleanOldData().catch(e => console.error('cleanOldData failed:', e));
    } else if (alarm.name === 'syncBrowsingData') {
      syncLocalDataInBackground('alarm').catch(e => console.error('syncBrowsingData failed:', e));
    } else if (alarm.name === '_focusSessionEnd') {
      // 如果 service worker 重启导致状态丢失，从 storage 恢复
      if (!_focusSession.active) {
        const { _activeFocusSession: s } = await chrome.storage.local.get('_activeFocusSession');
        if (s && s.active) _focusSession = { ...s, domains: new Set() };
      }
      endFocusSession(true).catch(e => console.error('endFocusSession failed:', e));
      showNotification('info', '专注会话完成！你做到了。').catch(e => console.error('showNotification failed:', e));
    } else if (alarm.name === 'dailySummary') {
      checkDailySummary().catch(e => console.error('dailySummary failed:', e));
    } else if (alarm.name === 'clearBadge') {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    console.error('alarm handler error:', e);
  }
});

// 检查当前是否在安静时段（支持跨午夜时间范围，如 23:00-07:00）
function isInQuietHours(preferences) {
  const start = preferences.quietHoursStart;
  const end = preferences.quietHoursEnd;
  if (!start || !end || !start.includes(':') || !end.includes(':')) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return false;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // 跨午夜（如 23:00 - 7:00）
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

async function showNotification(type, message) {
  try {
    const preferences = await getPreferences();
    // 安静时段跳过所有通知
    if (isInQuietHours(preferences)) return;
    // 通知系统开关是全局的，干预通知也受此控制
    if (!preferences.notificationsEnabled) {
      console.warn('showNotification: 通知已禁用, 跳过', type, message);
      // 即使通知被禁用，干预类提醒仍设置角标
      if (type === 'warning' || type === 'intervention') {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
        chrome.alarms.create('clearBadge', { delayInMinutes: 5 / 60 });
      }
      return;
    }

    const title =
      type === 'achieved' ? '目标达成' :
      type === 'info' ? 'BrowseMind' :
      type === 'intervention' || type === 'warning' ? '浏览提醒' :
      '时间提醒';

    const priority = preferences.notificationSound === false ? 1 : 2;
    const notificationId = await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority
    });
    log('通知已发送:', notificationId, type, message);

    // 写入通知历史（最多 50 条）
    try {
      const { notificationHistory = '' } = await chrome.storage.local.get('notificationHistory');
      const lines = notificationHistory ? notificationHistory.split('\n') : [];
      lines.push(`${Date.now()}|${type}|${message}`);
      while (lines.length > 50) lines.shift();
      await chrome.storage.local.set({ notificationHistory: lines.join('\n') });
    } catch (e) {
      console.warn('写入通知历史失败:', e);
    }
  } catch (error) {
    console.error('通知发送失败:', error);
    // API 失败时也尝试设置角标作为降级方案
    try {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
      chrome.alarms.create('clearBadge', { delayInMinutes: 5 / 60 });
    } catch {}
  }
}

async function getDataSync() {
  const preferences = await getPreferences();
  return new DataSync(preferences.apiBaseUrl);
}

async function scheduleAutoSync() {
  const preferences = await getPreferences();
  if (!preferences.autoSyncEnabled) return;

  if (_autoSyncTimer) {
    clearTimeout(_autoSyncTimer);
  }

  _autoSyncTimer = setTimeout(() => {
    _autoSyncTimer = null;
    syncLocalDataInBackground('storage-change');
  }, preferences.autoSyncDebounceMs);
}

// 后台同步 — 防并发 + 最小间隔保护（source 标识调用来源，用于日志）
async function syncLocalDataInBackground(source) {
  if (_isAutoSyncing) return;
  _isAutoSyncing = true;

  try {
    const preferences = await getPreferences();
    if (!preferences.autoSyncEnabled) return;

    const { browsingData = [], lastSyncTime } = await chrome.storage.local.get(['browsingData', 'lastSyncTime']);
    if (!browsingData.length) return;

    if (lastSyncTime && Date.now() - lastSyncTime < preferences.autoSyncMinIntervalMs) {
      return;
    }

    const dataSync = await getDataSync();
    const isConnected = await dataSync.checkConnection();
    if (!isConnected) return;

    const result = await dataSync.syncLocalData();
    log('后台自动同步完成:', source, result.message || '成功');
  } catch (error) {
    console.error('后台自动同步失败:', source, error);
  } finally {
    _isAutoSyncing = false;
  }
}

// ==================== 规则引擎 ====================

function parseListString(str) {
  return (str || '').split(/[,，\n\r]+/).map(s => s.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean);
}

// 从 storage 读取规则数组
async function _loadRules() {
  const { rules: rulesJson = '[]' } = await chrome.storage.local.get('rules');
  try { return JSON.parse(rulesJson); } catch { return []; }
}

// 保存规则数组到 storage
async function _saveRules(rules) {
  await chrome.storage.local.set({ rules: JSON.stringify(rules) });
}

// 规则引擎：评估当前域名/分类是否触发规则
async function evaluateRules(domain, category) {
  const preferences = await getCachedPreferences();
  if (!preferences.interventionsEnabled) return;

  // 专注会话打断（独立于规则引擎）
  if (_focusSession.active && (category === 'entertainment' || category === 'social')) {
    recordFocusInterruption(domain);
    await showNotification('warning', `专注会话中！你正在访问${WebsiteClassifier.CATEGORY_NAMES[category]}类站点，已记录打断。`);
  }

  // 全局 allowlist 跳过
  const normalizedDomain = (domain || '').toLowerCase();
  const allowlist = parseListString(preferences.domainAllowlist);
  if (allowlist.some(d => normalizedDomain === d || normalizedDomain.endsWith('.' + d))) return;

  const rules = await _loadRules();
  if (!rules.length) return;

  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const today = _todayString();
  const now = Date.now();

  // 按 priority 降序排列
  const sorted = rules.filter(r => r.enabled).sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const rule of sorted) {
    const cond = rule.condition;
    if (!cond) continue;

    let triggered = false;
    let currentDuration = 0;

    if (cond.type === 'domain_visit' && rule.type === 'domain_block') {
      // 域名匹配
      const ruleDomain = (cond.domain || '').toLowerCase();
      if (normalizedDomain === ruleDomain || normalizedDomain.endsWith('.' + ruleDomain)) {
        triggered = true;
      }
    } else if (cond.type === 'category_duration') {
      // 分类累计时长
      if (cond.category !== category) continue;
      currentDuration = browsingData
        .filter(r => r.date === today && r.category === cond.category)
        .reduce((sum, r) => sum + (r.duration || 0), 0);
      if (cond.operator === 'gte' && currentDuration >= cond.value) triggered = true;
      if (cond.operator === 'lte' && currentDuration < cond.value) triggered = true;
    } else if (cond.type === 'continuous_duration') {
      // 连续浏览时长
      if (cond.category && cond.category !== category) continue;
      const cutoff = now - cond.value * 1000;
      const recent = browsingData.filter(r => r.visitTime > cutoff);
      const totalDur = recent.reduce((s, r) => s + (r.duration || 0), 0);
      if (totalDur >= cond.value) triggered = true;
      currentDuration = totalDur;
    }

    if (!triggered) continue;

    // 冷却检查：limit/goal 类型用 lastTriggered，domain_block 类型用 30 分钟默认
    const cooldownMs = rule.type === 'domain_block' ? 30 * 60 * 1000 : (rule.action?.cooldownMinutes || 30) * 60 * 1000;
    if (rule.lastTriggered && now - rule.lastTriggered < cooldownMs) continue;

    // 更新 lastTriggered
    rule.lastTriggered = now;

    // 执行动作
    const actionType = rule.action?.type || 'notify';
    const catName = WebsiteClassifier.CATEGORY_NAMES[category] || category;
    const durationMin = Math.round(currentDuration / 60);
    const targetMin = cond.value ? Math.round(cond.value / 60) : 0;

    if (rule.type === 'goal') {
      // 目标类型：正向提醒
      if (cond.operator === 'lte') {
        await showNotification('info', `目标"${rule.name}"：今日${catName}已 ${durationMin} 分钟，目标 ${targetMin} 分钟。`);
      }
    } else if (rule.type === 'limit') {
      // 限制类型
      await showNotification('warning', `限制"${rule.name}"：${catName}今日已 ${durationMin} 分钟，超过 ${targetMin} 分钟限制。`);
    } else if (rule.type === 'domain_block') {
      await showNotification('warning', `规则"${rule.name}"：你正在访问 ${domain}。`);
    }

    // 记录干预响应日志（供自适应阈值使用）
    const { interventionResponseLog = [] } = await chrome.storage.local.get('interventionResponseLog');
    interventionResponseLog.push({ ruleId: rule.id, domain, category, time: now, responded: false });
    // 只保留最近 100 条
    if (interventionResponseLog.length > 100) interventionResponseLog.splice(0, interventionResponseLog.length - 100);
    await chrome.storage.local.set({ interventionResponseLog });

    // 阻断或冷却动作
    if (actionType === 'block' || actionType === 'cooldown') {
      try {
        const ruleId = rule.id;
        // 获取当前活动标签并重定向到阻断页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && !tab.url.startsWith('chrome://')) {
          const blockedUrl = chrome.runtime.getURL(`blocked.html?ruleId=${ruleId}&domain=${encodeURIComponent(domain)}`);
          await chrome.tabs.update(tab.id, { url: blockedUrl });
        }
      } catch (e) {
        console.warn('阻断页面跳转失败:', e);
      }
    }
  }

  // 保存完整规则列表（包括未启用的规则）
  await _saveRules(rules);

  // 更新规则进度
  await updateRuleProgress();
}

// 更新规则进度（goal/limit 类型的 dailyProgress）
async function updateRuleProgress() {
  const rules = await _loadRules();
  if (!rules.length) return;

  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const today = _todayString();
  let changed = false;

  for (const rule of rules) {
    if (!rule.condition || rule.condition.type !== 'category_duration') continue;
    const cat = rule.condition.category;
    const progress = browsingData
      .filter(r => r.date === today && r.category === cat)
      .reduce((sum, r) => sum + (r.duration || 0), 0);
    if (rule.dailyProgress !== progress) {
      rule.dailyProgress = progress;
      changed = true;
    }
  }

  if (changed) await _saveRules(rules);
}

// 将 block/cooldown 类型的域名规则同步到 declarativeNetRequest
async function syncDynamicRules() {
  try {
    if (!chrome.declarativeNetRequest) return;
    const rules = await _loadRules();
    const domainRules = rules.filter(r => r.enabled && r.type === 'domain_block' && r.condition?.domain);
    const blockedUrl = chrome.runtime.getURL('blocked.html');

    // 构建 dynamic rules
    const addRules = domainRules.map((rule, i) => ({
      id: i + 1,
      priority: 1,
      action: { type: 'redirect', redirect: { url: `${blockedUrl}?ruleId=${encodeURIComponent(rule.id)}&domain=${encodeURIComponent(rule.condition.domain)}` } },
      condition: { urlFilter: `||${rule.condition.domain}`, resourceTypes: ['main_frame'] }
    }));

    // 获取现有规则并删除
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules.map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    console.warn('同步动态阻断规则失败:', e);
  }
}

// 监听浏览记录变化，实时更新规则进度与自动同步
let _rulesDebounceTimer = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.browsingData) {
    clearTimeout(_rulesDebounceTimer);
    _rulesDebounceTimer = setTimeout(() => {
      updateRuleProgress().catch(e => console.error('updateRuleProgress failed:', e));
    }, 3000);

    scheduleAutoSync();
  }
  // 规则变更时同步阻断规则
  if (namespace === 'local' && changes.rules) {
    syncDynamicRules().catch(e => console.warn('syncDynamicRules failed:', e));
  }
});

// 监听 popup/dashboard 发来的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'showNotification') {
    showNotification(msg.type, msg.message)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  } else if (msg.action === 'startFocus') {
    startFocusSession(msg.durationMinutes);
    sendResponse({ ok: true, status: getFocusStatus() });
  } else if (msg.action === 'stopFocus') {
    endFocusSession(false).then(() => {
      sendResponse({ ok: true, status: getFocusStatus() });
    }).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  } else if (msg.action === 'focusStatus') {
    sendResponse({ ok: true, status: getFocusStatus() });
  } else {
    sendResponse({ ok: false, error: 'Unknown action: ' + msg.action });
  }
});
