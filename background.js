// BrowseMind 后台服务 - 负责监听标签页活动和记录浏览数据

importScripts('dataProcessor.js', 'dataSync.js');
// DEFAULT_API_BASE_URL and DEFAULT_PREFERENCES are defined in dataSync.js

let autoSyncTimer = null;
let isAutoSyncing = false;

// 干预冷却追踪 { key: lastTriggerTime }
const interventionCooldowns = {};

async function getPreferences() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_PREFERENCES));
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    apiBaseUrl: stored.apiBaseUrl || DEFAULT_API_BASE_URL,
    autoSyncDebounceMs: Number(stored.autoSyncDebounceMs || DEFAULT_PREFERENCES.autoSyncDebounceMs),
    autoSyncMinIntervalMs: Number(stored.autoSyncMinIntervalMs || DEFAULT_PREFERENCES.autoSyncMinIntervalMs),
    dataRetentionDays: Number(stored.dataRetentionDays || DEFAULT_PREFERENCES.dataRetentionDays),
    minVisitDurationSeconds: Number(stored.minVisitDurationSeconds || DEFAULT_PREFERENCES.minVisitDurationSeconds),
    analysisDays: Number(stored.analysisDays || DEFAULT_PREFERENCES.analysisDays),
    blackholeThresholdMinutes: Number(stored.blackholeThresholdMinutes || DEFAULT_PREFERENCES.blackholeThresholdMinutes),
    interventionCooldownMinutes: Number(stored.interventionCooldownMinutes || DEFAULT_PREFERENCES.interventionCooldownMinutes)
  };
}

// 存储当前活跃标签的信息
let activeTab = {
  tabId: null,
  url: null,
  title: null,
  startTime: null
};

// 初始化：加载历史记录
chrome.runtime.onInstalled.addListener(() => {
  console.log('BrowseMind 已安装');
  collectHistoryData();
});

// 监听标签页激活（用户切换标签）
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // 保存上一个标签的停留时间
  await saveTabDuration();

  // 获取新激活标签的信息
  const tab = await chrome.tabs.get(activeInfo.tabId);
  startTrackingTab(tab);
  checkTabIntervention(tab);
});

// 监听标签页更新（URL变化）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    await saveTabDuration();
    startTrackingTab(tab);
    checkTabIntervention(tab);
  }
});

// 监听窗口焦点变化
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // 用户离开浏览器
    await saveTabDuration();
    activeTab = { tabId: null, url: null, title: null, startTime: null };
  } else {
    // 用户返回浏览器，重新追踪当前标签
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) startTrackingTab(tab);
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

// 检查当前标签是否需要干预提醒
async function checkTabIntervention(tab) {
  try {
    if (!tab.url || tab.url.startsWith('chrome://')) return;
    const { classificationOverrides = {} } = await chrome.storage.local.get('classificationOverrides');
    const classifier = new WebsiteClassifier(classificationOverrides);
    const domain = WebsiteClassifier.normalizeDomain(new URL(tab.url).hostname);
    const category = classifier.classify(domain, tab.title || '', tab.url);
    await checkInterventions(domain, category);
  } catch {
    // ignore intervention check errors
  }
}

// 保存标签页停留时间
async function saveTabDuration() {
  if (!activeTab.startTime || !activeTab.url) return;

  const preferences = await getPreferences();
  const duration = Math.floor((Date.now() - activeTab.startTime) / 1000); // 秒
  if (duration < preferences.minVisitDurationSeconds) return;

  const record = {
    url: activeTab.url,
    title: activeTab.title,
    visitTime: activeTab.startTime,
    duration: duration,
    date: new Date(activeTab.startTime).toISOString().split('T')[0]
  };

  // 存储到 chrome.storage
  await addBrowsingRecord(record);
}

// 添加浏览记录到存储
async function addBrowsingRecord(record) {
  const preferences = await getPreferences();
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');

  const exists = browsingData.some(r =>
    r.url === record.url && Math.abs(r.visitTime - record.visitTime) < 5000
  );

  if (!exists) {
    browsingData.push(record);

    const retentionStart = Date.now() - preferences.dataRetentionDays * 24 * 60 * 60 * 1000;
    const filteredData = browsingData.filter(r => r.visitTime > retentionStart);

    await chrome.storage.local.set({ browsingData: filteredData });
    console.log('记录已保存:', record);
  }
}

async function collectHistoryData() {
  const preferences = await getPreferences();
  const retentionStart = Date.now() - preferences.dataRetentionDays * 24 * 60 * 60 * 1000;

  // 避免每次 onInstalled 和 alarm 都重复拉取
  const { lastCollectTime = 0 } = await chrome.storage.local.get('lastCollectTime');
  if (lastCollectTime > retentionStart) return;

  const historyItems = await new Promise((resolve, reject) => {
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

  const records = historyItems
    .filter(item => item.url && !item.url.startsWith('chrome://'))
    .map(item => ({
      url: item.url,
      title: item.title,
      visitTime: item.lastVisitTime,
      duration: 0,
      date: new Date(item.lastVisitTime).toISOString().split('T')[0]
    }));

  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const merged = [...browsingData, ...records];

  const unique = Array.from(
    new Map(merged.map(r => [`${r.url}-${r.visitTime}`, r])).values()
  );

  await chrome.storage.local.set({ browsingData: unique, lastCollectTime: Date.now() });
  console.log(`已采集 ${records.length} 条历史记录`);
}

// 定期清理旧数据（每小时执行一次）
chrome.alarms.create('cleanOldData', { periodInMinutes: 60 });

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
  if (alarm.name === 'cleanOldData') {
    cleanOldData();
  } else if (alarm.name === 'pruneCooldowns') {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const key of Object.keys(interventionCooldowns)) {
      if (interventionCooldowns[key] < cutoff) delete interventionCooldowns[key];
    }
  } else if (alarm.name === 'updateGoalsProgress') {
    updateGoalsProgress();
  } else if (alarm.name === 'syncBrowsingData') {
    syncLocalDataInBackground('alarm');
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

    const response = await fetch(baseUrl + '/api/goals/' + userId + '/update-progress?date=' + encodeURIComponent(today), {
      method: 'POST'
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
  const preferences = await getPreferences();
  if (!preferences.notificationsEnabled) return;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: type === 'achieved' ? '🎉 目标达成' : '⚠️ 时间提醒',
    message: message,
    priority: 2
  });
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
  if (!preferences.interventionsEnabled || !preferences.notificationsEnabled) return;

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
    if (!interventionCooldowns[blockKey] || now - interventionCooldowns[blockKey] > cooldownMs) {
      interventionCooldowns[blockKey] = now;
      showNotification('warning', `你正在访问黑名单站点：${domain}`);
    }
    return;
  }

  // 专注模式提醒（娱乐/社交类）
  if (preferences.focusModeEnabled && (category === 'entertainment' || category === 'social')) {
    const focusKey = `focus:${category}`;
    if (!interventionCooldowns[focusKey] || now - interventionCooldowns[focusKey] > cooldownMs) {
      interventionCooldowns[focusKey] = now;
      const catNames = { entertainment: '娱乐', social: '社交' };
      showNotification('warning', `专注模式已开启，当前正在访问${catNames[category] || category}类站点。`);
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
        showNotification('warning', `${catNames[category] || category}类今日已使用 ${Math.round(todayCategoryDuration / 60)} 分钟，超过 ${limitMin} 分钟限制。`);
      }
    }
  }
}

// 监听浏览记录变化，实时检查目标与自动同步
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.browsingData) {
    setTimeout(() => {
      updateGoalsProgress();
    }, 1000);

    scheduleAutoSync();
  }
});
