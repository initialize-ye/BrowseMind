// BrowseMind 后台服务 - 负责监听标签页活动和记录浏览数据

importScripts('dataProcessor.js', 'dataSync.js');
// getPreferences(), DEFAULT_API_BASE_URL, DEFAULT_PREFERENCES are defined in dataSync.js

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

// 干预冷却追踪 { key: lastTriggerTime }
const _interventionCooldowns = {};

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
    console.log('BrowseMind 已安装');
    // 生成认证 token（首次安装时）
    const { authToken } = await chrome.storage.local.get('authToken');
    if (!authToken) {
      const token = crypto.randomUUID();
      await chrome.storage.local.set({ authToken: token });
      console.log('已生成认证 token');
    }
    collectHistoryData();
    createContextMenus();
  } catch (e) {
    console.warn('onInstalled 处理失败:', e);
  }
});

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
        if (await appendToList('domainBlocklist', domain)) {
          showNotification('warning', `已将 ${domain} 加入黑名单`);
        } else {
          showNotification('info', `${domain} 已在黑名单中`);
        }
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

    await checkInterventions(domain, category);
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
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  browsingData.push(..._pendingRecords);
  _pendingRecords = [];
  await chrome.storage.local.set({ browsingData });
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
  console.log(`已采集 ${records.length} 条历史记录，合并后共 ${unique.length} 条`);
}

// 定期清理旧数据（每小时执行一次）
chrome.alarms.create('cleanOldData', { periodInMinutes: 60 });

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
  chrome.alarms.create('_focusSessionEnd', { delayInMinutes: durationMinutes });
  chrome.action.setBadgeText({ text: 'F' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  console.log(`专注会话开始：${durationMinutes} 分钟`);
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
  const { _focusSessions = [] } = await chrome.storage.local.get('_focusSessions');
  _focusSessions.push(session);
  await chrome.storage.local.set({ _focusSessions });

  _focusSession = { active: false, startTime: null, durationMinutes: 0, endTime: null, interruptions: 0, domains: new Set() };
  chrome.alarms.clear('_focusSessionEnd');
  chrome.action.setBadgeText({ text: '' });
  console.log(`专注会话结束：${completed ? '完成' : '中断'}，实际 ${actualDuration} 秒`);
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

// 定期更新目标进度（每5分钟）
chrome.alarms.create('updateGoalsProgress', { periodInMinutes: 5 });

// 定期兜底同步浏览数据（每5分钟）
chrome.alarms.create('syncBrowsingData', { periodInMinutes: 5 });

// 每日摘要检查（每小时）
chrome.alarms.create('dailySummary', { periodInMinutes: 60 });

async function cleanOldData() {
  const preferences = await getPreferences();
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const retentionStart = Date.now() - preferences.dataRetentionDays * 24 * 60 * 60 * 1000;
  const filtered = browsingData.filter(r => r.visitTime > retentionStart);
  if (filtered.length !== browsingData.length) {
    await chrome.storage.local.set({ browsingData: filtered });
    console.log(`清理旧数据：${browsingData.length - filtered.length} 条已移除`);
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

chrome.alarms.onAlarm.addListener((alarm) => {
  try {
    if (alarm.name === 'cleanOldData') {
      cleanOldData().catch(e => console.error('cleanOldData failed:', e));
    } else if (alarm.name === 'pruneCooldowns') {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const key of Object.keys(_interventionCooldowns)) {
        if (_interventionCooldowns[key] < cutoff) delete _interventionCooldowns[key];
      }
    } else if (alarm.name === 'updateGoalsProgress') {
      updateGoalsProgress().catch(e => console.error('updateGoalsProgress failed:', e));
    } else if (alarm.name === 'syncBrowsingData') {
      syncLocalDataInBackground('alarm').catch(e => console.error('syncBrowsingData failed:', e));
    } else if (alarm.name === '_focusSessionEnd') {
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

// ==================== 目标监控功能 ====================

// 更新目标进度 — 瞬时错误(502/503/504)自动重试最多 2 次
async function updateGoalsProgress() {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const preferences = await getPreferences();
      const { userId } = await chrome.storage.local.get(['userId']);
      if (!userId) return;

      const baseUrl = preferences.apiBaseUrl;
      const today = _todayString();

      const { authToken } = await chrome.storage.local.get('authToken');
      const headers = authToken ? { 'X-Auth-Token': authToken } : {};
      const response = await fetch(baseUrl + '/api/goals/' + userId + '/update-progress?date=' + encodeURIComponent(today), {
        method: 'POST',
        headers
      });

      if (!response.ok) {
        // 瞬时错误（502/503/504）重试
        if ([502, 503, 504].includes(response.status) && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        const errorText = await response.text();
        console.error('更新目标进度失败:', response.status, errorText);
        return;
      }

      const result = await response.json();

      // 处理通知
      if (result.data && result.data.notifications) {
        result.data.notifications.forEach(notif => {
          showNotification(notif.type, notif.message);
        });
      }
      return;
    } catch (error) {
      // 网络错误重试
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      console.error('更新目标进度失败:', error);
    }
  }
}

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
    console.log('通知已发送:', notificationId, type, message);

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
    console.log('后台自动同步完成:', source, result.message || '成功');
  } catch (error) {
    console.error('后台自动同步失败:', source, error);
  } finally {
    _isAutoSyncing = false;
  }
}

// 定期清理过期的干预冷却记录（每天一次）
chrome.alarms.create('pruneCooldowns', { periodInMinutes: 1440 });

// ==================== 主动干预 ====================

function parseListString(str) {
  return (str || '').split(/[,，\n\r]+/).map(s => s.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean);
}

function parseCategoryTimeLimits(str) {
  // Format: "entertainment:30,social:20" (minutes)
  const limits = {};
  (str || '').split(/[,，\n\r]+/).forEach(pair => {
    const [cat, min] = pair.split(':').map(s => s.trim());
    if (cat && min && !isNaN(Number(min))) {
      limits[cat.toLowerCase()] = Number(min) * 60; // convert to seconds
    }
  });
  return limits;
}

// 干预检查（按优先级）：专注会话打断 > 黑名单 > 专注模式 > 分类时限 > 持续娱乐 > 学习下降
async function checkInterventions(domain, category) {
  const preferences = await getCachedPreferences();
  if (!preferences.interventionsEnabled) return;

  let interventionFired = false;

  // 预读 browsingData，避免后续 3 次重复读取
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const today = _todayString();

  // 专注会话期间访问娱乐/社交站点 — 记录打断并提醒
  if (_focusSession.active && (category === 'entertainment' || category === 'social')) {
    recordFocusInterruption(domain);
    await showNotification('warning', `专注会话中！你正在访问${WebsiteClassifier.CATEGORY_NAMES[category]}类站点，已记录打断。`);
    interventionFired = true;
  }

  const normalizedDomain = (domain || '').toLowerCase();
  const allowlist = parseListString(preferences.domainAllowlist);
  const blocklist = parseListString(preferences.domainBlocklist);
  const cooldownMs = preferences.interventionCooldownMinutes * 60 * 1000;
  const now = Date.now();

  // 白名单跳过
  if (allowlist.some(d => normalizedDomain === d || normalizedDomain.endsWith('.' + d))) return;

  // 黑名单提醒
  const blockKey = `block:${normalizedDomain}`;
  if (blocklist.some(d => normalizedDomain === d || normalizedDomain.endsWith('.' + d))) {
    if (!_interventionCooldowns[blockKey] || now - _interventionCooldowns[blockKey] > cooldownMs) {
      _interventionCooldowns[blockKey] = now;
      await showNotification('warning', `你正在访问黑名单站点：${domain}`);
      interventionFired = true;
    }
  }

  // 专注模式提醒（娱乐/社交类）
  if (preferences.focusModeEnabled && (category === 'entertainment' || category === 'social')) {
    const focusKey = `focus:${category}`;
    if (!_interventionCooldowns[focusKey] || now - _interventionCooldowns[focusKey] > cooldownMs) {
      _interventionCooldowns[focusKey] = now;
      await showNotification('warning', `专注模式已开启，当前正在访问${WebsiteClassifier.CATEGORY_NAMES[category] || category}类站点。`);
      interventionFired = true;
    }
  }

  // 分类时长限制提醒
  const timeLimits = parseCategoryTimeLimits(preferences.categoryTimeLimits);
  if (timeLimits[category]) {
    const todayCategoryDuration = browsingData
      .filter(r => r.date === today && r.category === category)
      .reduce((sum, r) => sum + (r.duration || 0), 0);

    if (todayCategoryDuration >= timeLimits[category]) {
      const limitKey = `limit:${category}:${today}`;
      if (!_interventionCooldowns[limitKey] || now - _interventionCooldowns[limitKey] > cooldownMs) {
        _interventionCooldowns[limitKey] = now;
        const limitMin = Math.round(timeLimits[category] / 60);
        await showNotification('warning', `${WebsiteClassifier.CATEGORY_NAMES[category] || category}类今日已使用 ${Math.round(todayCategoryDuration / 60)} 分钟，超过 ${limitMin} 分钟限制。`);
        interventionFired = true;
      }
    }
  }

  // 自定义分类阈值提醒
  if (preferences.customThresholds) {
    const customLimits = parseCategoryTimeLimits(preferences.customThresholds);
    const notifyCats = (preferences.notifyCategories || '').split(/[,，\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const catsToCheck = Object.keys(customLimits);
    for (const cat of catsToCheck) {
      const todayCatDuration = browsingData
        .filter(r => r.date === today && r.category === cat)
        .reduce((sum, r) => sum + (r.duration || 0), 0);
      if (todayCatDuration >= customLimits[cat]) {
        const custKey = `custom:${cat}:${today}`;
        if (!_interventionCooldowns[custKey] || now - _interventionCooldowns[custKey] > cooldownMs) {
          _interventionCooldowns[custKey] = now;
          const limitMin = Math.round(customLimits[cat] / 60);
          await showNotification('warning', `${WebsiteClassifier.CATEGORY_NAMES[cat] || cat}类今日已使用 ${Math.round(todayCatDuration / 60)} 分钟，超过自定义阈值 ${limitMin} 分钟。`);
          interventionFired = true;
        }
      }
    }
  }

  // 连续娱乐检测
  if (category === 'entertainment' || category === 'social') {
    const thresholdMin = preferences.continuousEntertainmentMinutes || 20;
    const contKey = `continuous:${thresholdMin}`;
    if (!_interventionCooldowns[contKey] || now - _interventionCooldowns[contKey] > cooldownMs) {
      const cutoff = now - thresholdMin * 60 * 1000;
      const recent = browsingData.filter(r => r.visitTime > cutoff).sort((a, b) => a.visitTime - b.visitTime);
      if (recent.length >= 2) {
        const allDistracting = recent.every(r => r.category === 'entertainment' || r.category === 'social');
        const totalDur = recent.reduce((s, r) => s + (r.duration || 0), 0);
        if (allDistracting && totalDur >= thresholdMin * 60) {
          _interventionCooldowns[contKey] = now;
          await showNotification('intervention', `你已连续浏览娱乐/社交内容 ${Math.round(totalDur / 60)} 分钟，休息一下吧！`);
          interventionFired = true;
        }
      }
    }
  }

  // 学习效率下降检测
  if (preferences.learningDropAlertEnabled && (category === 'learning' || category === 'coding')) {
    const today = _todayString();
    const dropKey = `learningDrop:${today}`;
    if (!_interventionCooldowns[dropKey]) {
      const now2 = new Date();
      const currentHour = now2.getHours();
      const yesterday = _toLocalDate(now2 - 86400000);
      const focusCats = new Set(['learning', 'coding']);
      const todayFocus = browsingData.filter(r => r.date === today && focusCats.has(r.category) && new Date(r.visitTime).getHours() <= currentHour).reduce((s, r) => s + (r.duration || 0), 0);
      const yesterdayFocus = browsingData.filter(r => r.date === yesterday && focusCats.has(r.category) && new Date(r.visitTime).getHours() <= currentHour).reduce((s, r) => s + (r.duration || 0), 0);
      if (yesterdayFocus > 1800 && todayFocus < yesterdayFocus * 0.4) {
        _interventionCooldowns[dropKey] = now;
        await showNotification('info', `学习时间较昨日同时段下降超过 60%，保持专注！`);
        interventionFired = true;
      }
    }
  }

  // 自适应阈值：仅在干预实际触发时记录
  if (interventionFired) {
    const log = await trackInterventionResponse(category);
    checkAdaptiveThreshold(preferences, log);
  }
}

// 自适应阈值 — 记录每次干预触发后用户是否切换回非娱乐站点
async function trackInterventionResponse(category) {
  if (category !== 'entertainment' && category !== 'social') return null;
  const { interventionResponseLog = [] } = await chrome.storage.local.get('interventionResponseLog');
  // 只保留最近 30 条
  if (interventionResponseLog.length > 30) interventionResponseLog.splice(0, interventionResponseLog.length - 30);
  interventionResponseLog.push({ time: Date.now(), category, responded: false });
  await chrome.storage.local.set({ interventionResponseLog });
  return interventionResponseLog;
}

// 自适应阈值：连续 7 次忽略干预后发送建议通知，24 小时冷却
async function checkAdaptiveThreshold(preferences, interventionResponseLog) {
  if (!preferences.adaptiveThresholdEnabled) return;
  if (!interventionResponseLog) {
    const data = await chrome.storage.local.get('interventionResponseLog');
    interventionResponseLog = data.interventionResponseLog || [];
  }
  if (interventionResponseLog.length < 7) return;

  // 检查最近 7 条未响应的干预
  const recent = interventionResponseLog.slice(-7);
  const allUnanswered = recent.every(r => r.responded === false);
  if (!allUnanswered) return;

  const key = 'adaptive:threshold';
  const now = Date.now();
  if (_interventionCooldowns[key] && now - _interventionCooldowns[key] < 24 * 60 * 60 * 1000) return;
  _interventionCooldowns[key] = now;

  await showNotification('info', '你已连续 7 次忽略了提醒，是否需要提高提醒阈值或调整提醒方式？');
  // 清空日志避免重复触发
  await chrome.storage.local.set({ interventionResponseLog: [] });
}

// 监听浏览记录变化，实时检查目标与自动同步
let _goalsDebounceTimer = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.browsingData) {
    clearTimeout(_goalsDebounceTimer);
    _goalsDebounceTimer = setTimeout(() => {
      updateGoalsProgress().catch(e => console.error('updateGoalsProgress failed:', e));
    }, 3000);

    scheduleAutoSync();
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
