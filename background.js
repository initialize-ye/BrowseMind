// BrowseMind 后台服务 - 负责监听标签页活动和记录浏览数据

importScripts('dataProcessor.js', 'dataSync.js');

const DEFAULT_API_BASE_URL = 'http://119.29.55.112:8000';
const AUTO_SYNC_DEBOUNCE_MS = 15000;
const AUTO_SYNC_MIN_INTERVAL_MS = 2 * 60 * 1000;

let autoSyncTimer = null;
let isAutoSyncing = false;

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
});

// 监听标签页更新（URL变化）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    await saveTabDuration();
    startTrackingTab(tab);
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

// 保存标签页停留时间
async function saveTabDuration() {
  if (!activeTab.startTime || !activeTab.url) return;

  const duration = Math.floor((Date.now() - activeTab.startTime) / 1000); // 秒
  if (duration < 3) return; // 忽略少于3秒的访问

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
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');

  // 检查是否已存在相同URL和时间的记录（避免重复）
  const exists = browsingData.some(r =>
    r.url === record.url && Math.abs(r.visitTime - record.visitTime) < 5000
  );

  if (!exists) {
    browsingData.push(record);

    // 只保留最近7天的数据
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filteredData = browsingData.filter(r => r.visitTime > sevenDaysAgo);

    await chrome.storage.local.set({ browsingData: filteredData });
    console.log('记录已保存:', record);
  }
}

// 采集历史记录（最近7天）
async function collectHistoryData() {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  chrome.history.search({
    text: '',
    startTime: sevenDaysAgo,
    maxResults: 1000
  }, async (historyItems) => {
    const records = historyItems
      .filter(item => item.url && !item.url.startsWith('chrome://'))
      .map(item => ({
        url: item.url,
        title: item.title,
        visitTime: item.lastVisitTime,
        duration: 0, // 历史记录无法获取停留时间
        date: new Date(item.lastVisitTime).toISOString().split('T')[0]
      }));

    // 合并到现有数据
    const { browsingData = [] } = await chrome.storage.local.get('browsingData');
    const merged = [...browsingData, ...records];

    // 去重
    const unique = Array.from(
      new Map(merged.map(r => [`${r.url}-${r.visitTime}`, r])).values()
    );

    await chrome.storage.local.set({ browsingData: unique });
    console.log(`已采集 ${records.length} 条历史记录`);
  });
}

// 定期清理旧数据（每小时执行一次）
chrome.alarms.create('cleanOldData', { periodInMinutes: 60 });

// 定期更新目标进度（每5分钟）
chrome.alarms.create('updateGoalsProgress', { periodInMinutes: 5 });

// 定期兜底同步浏览数据（每5分钟）
chrome.alarms.create('syncBrowsingData', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanOldData') {
    collectHistoryData(); // 重新采集并自动清理旧数据
  } else if (alarm.name === 'updateGoalsProgress') {
    updateGoalsProgress();
  } else if (alarm.name === 'syncBrowsingData') {
    syncLocalDataInBackground('alarm');
  }
});

// ==================== 目标监控功能 ====================

async function updateGoalsProgress() {
  try {
    const { userId, apiBaseUrl } = await chrome.storage.local.get(['userId', 'apiBaseUrl']);
    if (!userId) return;

    const baseUrl = apiBaseUrl || 'http://119.29.55.112:8000';
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

function showNotification(type, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: type === 'achieved' ? '🎉 目标达成' : '⚠️ 时间提醒',
    message: message,
    priority: 2
  });
}

async function getDataSync() {
  const { apiBaseUrl } = await chrome.storage.local.get('apiBaseUrl');
  return new DataSync(apiBaseUrl || DEFAULT_API_BASE_URL);
}

function scheduleAutoSync() {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    syncLocalDataInBackground('storage-change');
  }, AUTO_SYNC_DEBOUNCE_MS);
}

async function syncLocalDataInBackground(source) {
  if (isAutoSyncing) return;

  try {
    const { browsingData = [], lastSyncTime } = await chrome.storage.local.get(['browsingData', 'lastSyncTime']);
    if (!browsingData.length) return;

    if (lastSyncTime && Date.now() - lastSyncTime < AUTO_SYNC_MIN_INTERVAL_MS) {
      return;
    }

    isAutoSyncing = true;
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

// 监听浏览记录变化，实时检查目标与自动同步
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.browsingData) {
    setTimeout(() => {
      updateGoalsProgress();
    }, 1000);

    scheduleAutoSync();
  }
});
