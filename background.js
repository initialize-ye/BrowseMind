// BrowseMind 后台服务 - 负责监听标签页活动和记录浏览数据

importScripts('dataProcessor.js', 'dataSync.js');
// getPreferences(), DEFAULT_API_BASE_URL, DEFAULT_PREFERENCES are defined in dataSync.js

let autoSyncTimer = null;
let isAutoSyncing = false;
let _recentRecordKeys = null; // Set-based dedup cache for addBrowsingRecord

// 干预冷却追踪 { key: lastTriggerTime }
const interventionCooldowns = {};

// 存储当前活跃标签的信息
let activeTab = {
  tabId: null,
  url: null,
  title: null,
  startTime: null
};

// 专注会话状态
let focusSession = {
  active: false,
  startTime: null,
  durationMinutes: 0,
  endTime: null,
  interruptions: 0,
  domains: new Set()
};

// 初始化：加载历史记录 + 创建右键菜单 + 生成认证 token
chrome.runtime.onInstalled.addListener(async () => {
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

function extractDomainFromUrl(url) {
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
  const url = info.linkUrl || info.pageUrl;
  const domain = extractDomainFromUrl(url);

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
});

// 一次性读取偏好与分类覆盖（供 saveTabDuration + checkTabIntervention 共用）
async function getSharedContext() {
  const [preferences, { classificationOverrides = {}, classificationFeedback = {} }] = await Promise.all([
    getPreferences(),
    chrome.storage.local.get(['classificationOverrides', 'classificationFeedback'])
  ]);
  return { preferences, classificationOverrides, classificationFeedback };
}

// 监听标签页激活（用户切换标签）
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const ctx = await getSharedContext();
  await saveTabDuration(ctx);
  const tab = await chrome.tabs.get(activeInfo.tabId);
  startTrackingTab(tab);
  await checkTabIntervention(tab, ctx);
});

// 监听标签页更新（URL变化）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    const ctx = await getSharedContext();
    await saveTabDuration(ctx);
    startTrackingTab(tab);
    await checkTabIntervention(tab, ctx);
  }
});

// 监听窗口焦点变化
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await saveTabDuration();
    activeTab = { tabId: null, url: null, title: null, startTime: null };
  } else {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) {
      const ctx = await getSharedContext();
      startTrackingTab(tab);
      await checkTabIntervention(tab, ctx);
    }
  }
});

// 开始追踪标签页
function startTrackingTab(tab) {
  if (!tab.url || tab.url.startsWith('chrome://')) return;

  activeTab = {
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
    const classifier = new WebsiteClassifier(overrides, feedback);
    const domain = WebsiteClassifier.normalizeDomain(new URL(tab.url).hostname);
    const category = classifier.classify(domain, tab.title || '', tab.url);
    await checkInterventions(domain, category);
  } catch (e) {
    console.error('checkTabIntervention error:', e);
  }
}

// 保存标签页停留时间（可接收预读的共享上下文）
async function saveTabDuration(ctx) {
  if (!activeTab.startTime || !activeTab.url) return;

  const preferences = ctx?.preferences || await getPreferences();
  const duration = Math.floor((Date.now() - activeTab.startTime) / 1000); // 秒
  if (duration < preferences.minVisitDurationSeconds) return;

  const overrides = ctx?.classificationOverrides ?? (await chrome.storage.local.get('classificationOverrides')).classificationOverrides ?? {};
  const feedback = ctx?.classificationFeedback ?? (await chrome.storage.local.get('classificationFeedback')).classificationFeedback ?? {};
  const classifier = new WebsiteClassifier(overrides, feedback);
  let domain = null;
  try { domain = WebsiteClassifier.normalizeDomain(new URL(activeTab.url).hostname); } catch {}
  const category = classifier.classify(domain || '', activeTab.title || '', activeTab.url);

  const record = {
    url: activeTab.url,
    title: activeTab.title,
    domain: domain,
    category: category,
    visitTime: activeTab.startTime,
    duration: duration,
    date: new Date(activeTab.startTime).toISOString().split('T')[0]
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
function ensureRecordCache(browsingData) {
  if (!_recentRecordKeys) {
    _recentRecordKeys = new Set(browsingData.map(recordKey));
  }
}

// 添加浏览记录到存储（O(1) 去重，保留由 cleanOldData alarm 处理）
async function addBrowsingRecord(record) {
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');

  ensureRecordCache(browsingData);
  const key = recordKey(record);
  if (_recentRecordKeys.has(key)) return;

  _recentRecordKeys.add(key);
  browsingData.push(record);
  await chrome.storage.local.set({ browsingData });
}

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
  const classifier = new WebsiteClassifier(classificationOverrides, classificationFeedback);

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
        date: new Date(item.lastVisitTime).toISOString().split('T')[0]
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
  const now = Date.now();
  focusSession = {
    active: true,
    startTime: now,
    durationMinutes,
    endTime: now + durationMinutes * 60 * 1000,
    interruptions: 0,
    domains: new Set()
  };
  chrome.alarms.create('focusSessionEnd', { delayInMinutes: durationMinutes });
  chrome.action.setBadgeText({ text: 'F' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  console.log(`专注会话开始：${durationMinutes} 分钟`);
}

async function endFocusSession(completed = true) {
  if (!focusSession.active) return;
  const now = Date.now();
  const actualDuration = Math.floor((now - focusSession.startTime) / 1000);

  const session = {
    startTime: focusSession.startTime,
    endTime: now,
    plannedDuration: focusSession.durationMinutes * 60,
    actualDuration,
    completed,
    interruptions: focusSession.interruptions,
    domains: Array.from(focusSession.domains)
  };

  // 保存到本地
  const { focusSessions = [] } = await chrome.storage.local.get('focusSessions');
  focusSessions.push(session);
  await chrome.storage.local.set({ focusSessions });

  focusSession = { active: false, startTime: null, durationMinutes: 0, endTime: null, interruptions: 0, domains: new Set() };
  chrome.alarms.clear('focusSessionEnd');
  chrome.action.setBadgeText({ text: '' });
  console.log(`专注会话结束：${completed ? '完成' : '中断'}，实际 ${actualDuration} 秒`);
}

function getFocusStatus() {
  if (!focusSession.active) return { active: false };
  return {
    active: true,
    startTime: focusSession.startTime,
    durationMinutes: focusSession.durationMinutes,
    endTime: focusSession.endTime,
    remainingSeconds: Math.max(0, Math.floor((focusSession.endTime - Date.now()) / 1000)),
    interruptions: focusSession.interruptions
  };
}

function recordFocusInterruption(domain) {
  if (!focusSession.active) return;
  focusSession.interruptions++;
  focusSession.domains.add(domain);
}

// 定期更新目标进度（每5分钟）
chrome.alarms.create('updateGoalsProgress', { periodInMinutes: 5 });

// 定期兜底同步浏览数据（每5分钟）
chrome.alarms.create('syncBrowsingData', { periodInMinutes: 5 });

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

chrome.alarms.onAlarm.addListener((alarm) => {
  try {
    if (alarm.name === 'cleanOldData') {
      cleanOldData().catch(e => console.error('cleanOldData failed:', e));
    } else if (alarm.name === 'pruneCooldowns') {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const key of Object.keys(interventionCooldowns)) {
        if (interventionCooldowns[key] < cutoff) delete interventionCooldowns[key];
      }
    } else if (alarm.name === 'updateGoalsProgress') {
      updateGoalsProgress().catch(e => console.error('updateGoalsProgress failed:', e));
    } else if (alarm.name === 'syncBrowsingData') {
      syncLocalDataInBackground('alarm');
    } else if (alarm.name === 'focusSessionEnd') {
      endFocusSession(true);
      showNotification('info', '专注会话完成！你做到了。');
    }
  } catch (e) {
    console.error('alarm handler error:', e);
  }
});

// ==================== 目标监控功能 ====================

async function updateGoalsProgress() {
  try {
    const preferences = await getPreferences();
    const { userId } = await chrome.storage.local.get(['userId']);
    if (!userId) return;

    const baseUrl = preferences.apiBaseUrl;
    const today = new Date().toISOString().split('T')[0];

    const { authToken } = await chrome.storage.local.get('authToken');
    const headers = authToken ? { 'X-Auth-Token': authToken } : {};
    const response = await fetch(baseUrl + '/api/goals/' + userId + '/update-progress?date=' + encodeURIComponent(today), {
      method: 'POST',
      headers
    });

    if (!response.ok) {
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
  } catch (error) {
    console.error('更新目标进度失败:', error);
  }
}

async function showNotification(type, message) {
  try {
    const preferences = await getPreferences();
    // 通知系统开关是全局的，干预通知也受此控制
    if (!preferences.notificationsEnabled) {
      console.warn('showNotification: 通知已禁用, 跳过', type, message);
      // 即使通知被禁用，干预类提醒仍设置角标
      if (type === 'warning' || type === 'intervention') {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
      }
      return;
    }

    const title =
      type === 'achieved' ? '目标达成' :
      type === 'info' ? 'BrowseMind' :
      type === 'intervention' || type === 'warning' ? '浏览提醒' :
      '时间提醒';

    const notificationId = await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority: 2
    });
    console.log('通知已发送:', notificationId, type, message);
  } catch (error) {
    console.error('通知发送失败:', error);
    // API 失败时也尝试设置角标作为降级方案
    try {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
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

  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    syncLocalDataInBackground('storage-change');
  }, preferences.autoSyncDebounceMs);
}

async function syncLocalDataInBackground(source) {
  if (isAutoSyncing) return;
  isAutoSyncing = true;

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
    isAutoSyncing = false;
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

async function checkInterventions(domain, category) {
  const preferences = await getPreferences();
  if (!preferences.interventionsEnabled) {
    console.log('checkInterventions: 跳过（interventionsEnabled=false）');
    return;
  }

  // 专注会话期间访问娱乐/社交站点 — 记录打断并提醒
  if (focusSession.active && (category === 'entertainment' || category === 'social')) {
    recordFocusInterruption(domain);
    const catNames = { entertainment: '娱乐', social: '社交' };
    await showNotification('warning', `专注会话中！你正在访问${catNames[category]}类站点，已记录打断。`);
    return;
  }

  const normalizedDomain = (domain || '').toLowerCase();
  const allowlist = parseListString(preferences.domainAllowlist);
  const blocklist = parseListString(preferences.domainBlocklist);
  const cooldownMs = preferences.interventionCooldownMinutes * 60 * 1000;
  const now = Date.now();

  // 白名单跳过
  if (allowlist.some(d => normalizedDomain === d || normalizedDomain.endsWith('.' + d))) {
    console.log('checkInterventions: ', normalizedDomain, '在白名单中，跳过');
    return;
  }

  // 黑名单提醒
  const blockKey = `block:${normalizedDomain}`;
  if (blocklist.some(d => normalizedDomain === d || normalizedDomain.endsWith('.' + d))) {
    console.log('checkInterventions: ', normalizedDomain, '命中黑名单');
    if (!interventionCooldowns[blockKey] || now - interventionCooldowns[blockKey] > cooldownMs) {
      interventionCooldowns[blockKey] = now;
      await showNotification('warning', `你正在访问黑名单站点：${domain}`);
    } else {
      console.log('checkInterventions: 黑名单冷却中，跳过');
    }
    return;
  }

  // 专注模式提醒（娱乐/社交类）
  if (preferences.focusModeEnabled && (category === 'entertainment' || category === 'social')) {
    console.log('checkInterventions: ', normalizedDomain, '命中专注模式, 分类:', category);
    const focusKey = `focus:${category}`;
    if (!interventionCooldowns[focusKey] || now - interventionCooldowns[focusKey] > cooldownMs) {
      interventionCooldowns[focusKey] = now;
      const catNames = { entertainment: '娱乐', social: '社交' };
      await showNotification('warning', `专注模式已开启，当前正在访问${catNames[category] || category}类站点。`);
    } else {
      console.log('checkInterventions: 专注模式冷却中，跳过');
    }
    return;
  }

  // 分类时长限制提醒
  const timeLimits = parseCategoryTimeLimits(preferences.categoryTimeLimits);
  if (timeLimits[category]) {
    const { browsingData = [] } = await chrome.storage.local.get('browsingData');
    const today = new Date().toISOString().split('T')[0];
    const todayCategoryDuration = browsingData
      .filter(r => r.date === today && r.category === category)
      .reduce((sum, r) => sum + (r.duration || 0), 0);

    if (todayCategoryDuration >= timeLimits[category]) {
      const limitKey = `limit:${category}:${today}`;
      if (!interventionCooldowns[limitKey] || now - interventionCooldowns[limitKey] > cooldownMs) {
        interventionCooldowns[limitKey] = now;
        const catNames = { entertainment: '娱乐', social: '社交', learning: '学习', coding: '编程', tools: '工具' };
        const limitMin = Math.round(timeLimits[category] / 60);
        await showNotification('warning', `${catNames[category] || category}类今日已使用 ${Math.round(todayCategoryDuration / 60)} 分钟，超过 ${limitMin} 分钟限制。`);
      }
    }
  }
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
    showNotification(msg.type, msg.message);
    sendResponse({ ok: true });
  } else if (msg.action === 'startFocus') {
    startFocusSession(msg.durationMinutes);
    sendResponse({ ok: true, status: getFocusStatus() });
  } else if (msg.action === 'stopFocus') {
    endFocusSession(false).then(() => {
      sendResponse({ ok: true, status: getFocusStatus() });
    });
    return true; // async sendResponse
  } else if (msg.action === 'focusStatus') {
    sendResponse({ ok: true, status: getFocusStatus() });
  }
});
