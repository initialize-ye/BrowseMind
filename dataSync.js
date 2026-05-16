// BrowseMind 数据同步模块 - 与后端服务通信

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
  analysisDays: 7,
  interventionsEnabled: false,
  focusModeEnabled: false,
  domainAllowlist: '',
  domainBlocklist: '',
  categoryTimeLimits: '',
  interventionCooldownMinutes: 30,
  quietHoursStart: '',
  quietHoursEnd: '',
  focusDurations: '25,45,60',
  dailySummaryEnabled: false,
  dailySummaryHour: 21,
  continuousEntertainmentMinutes: 20,
  learningDropAlertEnabled: false,
  adaptiveThresholdEnabled: false
};

// 模块级缓存：避免每次调用都重新计算 Object.keys
const ALL_PREF_KEYS = Object.keys(DEFAULT_PREFERENCES);

// 统一获取偏好设置（供 popup/dashboard/background 共用）
async function getPreferences() {
  const stored = await chrome.storage.local.get(ALL_PREF_KEYS);
  const defaults = DEFAULT_PREFERENCES;
  return {
    apiBaseUrl: (stored.apiBaseUrl != null && stored.apiBaseUrl !== '') ? stored.apiBaseUrl : defaults.apiBaseUrl,
    autoSyncEnabled: stored.autoSyncEnabled === true || stored.autoSyncEnabled === 'true',
    autoSyncDebounceMs: stored.autoSyncDebounceMs != null ? Number(stored.autoSyncDebounceMs) : defaults.autoSyncDebounceMs,
    autoSyncMinIntervalMs: stored.autoSyncMinIntervalMs != null ? Number(stored.autoSyncMinIntervalMs) : defaults.autoSyncMinIntervalMs,
    dataRetentionDays: stored.dataRetentionDays != null ? Number(stored.dataRetentionDays) : defaults.dataRetentionDays,
    minVisitDurationSeconds: stored.minVisitDurationSeconds != null ? Number(stored.minVisitDurationSeconds) : defaults.minVisitDurationSeconds,
    notificationsEnabled: stored.notificationsEnabled === true || stored.notificationsEnabled === 'true',
    blackholeThresholdMinutes: stored.blackholeThresholdMinutes != null ? Number(stored.blackholeThresholdMinutes) : defaults.blackholeThresholdMinutes,
    analysisDays: stored.analysisDays != null ? Number(stored.analysisDays) : defaults.analysisDays,
    interventionsEnabled: stored.interventionsEnabled === true || stored.interventionsEnabled === 'true',
    focusModeEnabled: stored.focusModeEnabled === true || stored.focusModeEnabled === 'true',
    domainAllowlist: stored.domainAllowlist != null ? stored.domainAllowlist : defaults.domainAllowlist,
    domainBlocklist: stored.domainBlocklist != null ? stored.domainBlocklist : defaults.domainBlocklist,
    categoryTimeLimits: stored.categoryTimeLimits != null ? stored.categoryTimeLimits : defaults.categoryTimeLimits,
    interventionCooldownMinutes: stored.interventionCooldownMinutes != null ? Number(stored.interventionCooldownMinutes) : defaults.interventionCooldownMinutes,
    quietHoursStart: stored.quietHoursStart != null ? stored.quietHoursStart : defaults.quietHoursStart,
    quietHoursEnd: stored.quietHoursEnd != null ? stored.quietHoursEnd : defaults.quietHoursEnd,
    focusDurations: stored.focusDurations != null ? stored.focusDurations : defaults.focusDurations,
    dailySummaryEnabled: stored.dailySummaryEnabled === true || stored.dailySummaryEnabled === 'true',
    dailySummaryHour: stored.dailySummaryHour != null ? Number(stored.dailySummaryHour) : defaults.dailySummaryHour,
    continuousEntertainmentMinutes: stored.continuousEntertainmentMinutes != null ? Number(stored.continuousEntertainmentMinutes) : defaults.continuousEntertainmentMinutes,
    learningDropAlertEnabled: stored.learningDropAlertEnabled === true || stored.learningDropAlertEnabled === 'true',
    adaptiveThresholdEnabled: stored.adaptiveThresholdEnabled === true || stored.adaptiveThresholdEnabled === 'true'
  };
}

function escapeHtml(text) {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 数据验证：确保浏览记录数组有效
function validateBrowsingData(data) {
  if (!Array.isArray(data)) return [];
  return data.filter(r => r && typeof r === 'object' && r.url && r.visitTime).map(r => {
    // 确保 date 字段存在且格式正确
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      try { r.date = new Date(r.visitTime).toISOString().split('T')[0]; } catch { r.date = new Date().toISOString().split('T')[0]; }
    }
    return r;
  });
}

// 压缩浏览记录：移除冗余字段，缩短键名
function compressRecords(records) {
  return records.map(r => {
    const compressed = {};
    if (r.url) compressed.u = r.url;
    if (r.title) compressed.t = r.title;
    if (r.domain) compressed.d = r.domain;
    if (r.category && r.category !== 'other') compressed.c = r.category;
    if (r.visitTime) compressed.v = r.visitTime;
    if (r.duration) compressed.s = r.duration;
    if (r.date) compressed.dt = r.date;
    return compressed;
  });
}

// 解压浏览记录：恢复完整字段名
function decompressRecords(records) {
  return records.map(r => ({
    url: r.u || '',
    title: r.t || '',
    domain: r.d || '',
    category: r.c || 'other',
    visitTime: r.v || 0,
    duration: r.s || 0,
    date: r.dt || ''
  }));
}

// 带重试的 fetch 封装
async function fetchWithRetry(url, options = {}, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (i === maxRetries) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  if (total < 60) return `${total}秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours}小时${remain}分钟` : `${hours}小时`;
}

// 带认证头的 fetch 封装（供 popup/dashboard 直接调用后端 API 时使用）
let _cachedAuthToken = null;
async function authFetch(url, options = {}) {
  if (!_cachedAuthToken) {
    const { authToken } = await chrome.storage.local.get('authToken');
    _cachedAuthToken = authToken || '';
  }
  const headers = { ...(options.headers || {}) };
  if (_cachedAuthToken) headers['X-Auth-Token'] = _cachedAuthToken;
  return fetch(url, { ...options, headers });
}

class DataSync {
  constructor(apiBaseUrl = DEFAULT_API_BASE_URL) {
    this.apiBaseUrl = apiBaseUrl;
    this.userId = null;
    this._initPromise = null; // mutex for concurrent initUserId() calls
    this._authToken = null;
  }

  async _getAuthHeaders() {
    if (!this._authToken) {
      const { authToken } = await chrome.storage.local.get('authToken');
      this._authToken = authToken || '';
    }
    return this._authToken ? { 'X-Auth-Token': this._authToken } : {};
  }

  // 初始化用户ID（带互斥锁，防止并发生成重复ID）
  async initUserId() {
    if (this.userId) return this.userId;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._initUserIdImpl();
    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  async _initUserIdImpl() {
    const { userId } = await chrome.storage.local.get('userId');
    if (userId) {
      this.userId = userId;
    } else {
      this.userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      await chrome.storage.local.set({ userId: this.userId });
    }
    return this.userId;
  }

  // 上传浏览数据到服务器
  async uploadData(records) {
    await this.initUserId();

    try {
      const payload = {
        user_id: this.userId,
        records: records
      };

      console.log(`上传数据: ${records.length} 条记录`);

      const authHeaders = await this._getAuthHeaders();
      const response = await fetchWithRetry(`${this.apiBaseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('上传失败详情:', errorText);
        throw new Error(`上传失败: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('数据上传成功:', result);
      return result;

    } catch (error) {
      console.error('上传数据失败:', error);
      throw error;
    }
  }

  // 从服务器获取分析结果
  async getAnalysis(days = 7) {
    await this.initUserId();

    try {
      const authHeaders = await this._getAuthHeaders();
      const response = await fetch(
        `${this.apiBaseUrl}/api/analysis/${this.userId}?days=${days}`,
        { headers: authHeaders }
      );

      if (!response.ok) {
        throw new Error(`获取分析失败: ${response.status}`);
      }

      const analysis = await response.json();
      return analysis;

    } catch (error) {
      console.error('获取分析失败:', error);
      throw error;
    }
  }

  // 获取统计概览
  async getStats() {
    await this.initUserId();

    try {
      const authHeaders = await this._getAuthHeaders();
      const response = await fetch(`${this.apiBaseUrl}/api/stats/${this.userId}`, { headers: authHeaders });

      if (!response.ok) {
        throw new Error(`获取统计失败: ${response.status}`);
      }

      const stats = await response.json();
      return stats;

    } catch (error) {
      console.error('获取统计失败:', error);
      throw error;
    }
  }

  // 同步本地数据到服务器
  async syncLocalData() {
    try {
      // 同步设置和分类规则
      try {
        const settingsResult = await this.syncSettings();
        console.log('设置同步:', settingsResult.message);
      } catch (e) {
        console.warn('设置同步失败（不影响数据同步）:', e);
      }
      try {
        const rulesResult = await this.syncClassificationRules();
        console.log('分类规则同步:', rulesResult.message);
      } catch (e) {
        console.warn('分类规则同步失败（不影响数据同步）:', e);
      }

      // 获取本地数据和分类覆盖规则
      const { browsingData = [], classificationOverrides = {} } = await chrome.storage.local.get(['browsingData', 'classificationOverrides']);

      if (browsingData.length === 0) {
        console.log('没有需要同步的数据');
        return { success: true, message: '没有需要同步的数据' };
      }

      // 初始化分类器（带用户覆盖规则）
      const classifier = new WebsiteClassifier(classificationOverrides);

      // 转换数据格式并分类（截断超长字段避免后端 422）
      const records = browsingData.map(record => {
        const domain = extractDomain(record.url);
        const title = record.title || '';
        const category = record.category || classifier.classify(domain || '', title, record.url || '');

        // 确保 date 字段格式正确 (YYYY-MM-DD)
        let date = record.date;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          try { date = new Date(record.visitTime).toISOString().split('T')[0]; } catch { date = new Date().toISOString().split('T')[0]; }
        }

        return {
          url: (record.url || '').slice(0, 2048),
          title: title.slice(0, 2000),
          domain: domain ? domain.slice(0, 253) : domain,
          category: (category || '').slice(0, 50),
          visit_time: Math.floor(record.visitTime), // 转换为整数
          duration: Math.floor(record.duration || 0), // 转换为整数
          date
        };
      });

      // 上传到服务器
      const result = await this.uploadData(records);

      // 从服务器拉取数据（补充本地可能缺失的记录）
      try {
        await this.pullFromServer();
      } catch (e) {
        console.warn('拉取服务器数据失败（不影响上传）:', e);
      }

      // 记录最后同步时间
      await chrome.storage.local.set({
        lastSyncTime: Date.now()
      });

      return result;

    } catch (error) {
      console.error('同步失败:', error);
      throw error;
    }
  }

  // extractDomain 已移至 shared.js

  // 从服务器拉取浏览记录，合并到本地
  async pullFromServer() {
    await this.initUserId();
    const authHeaders = await this._getAuthHeaders();
    const response = await fetchWithRetry(
      `${this.apiBaseUrl}/api/records/${this.userId}?limit=5000`,
      { headers: authHeaders }
    );
    if (!response.ok) return;

    const serverRecords = await response.json();
    if (!serverRecords || !serverRecords.length) return;

    const { browsingData = [] } = await chrome.storage.local.get('browsingData');
    const existingKeys = new Set(browsingData.map(r => `${r.url}-${r.visitTime}`));
    let added = 0;

    for (const sr of serverRecords) {
      const visitTime = new Date(sr.visit_time).getTime();
      const key = `${sr.url}-${visitTime}`;
      if (existingKeys.has(key)) continue;

      browsingData.push({
        url: sr.url,
        title: sr.title || '',
        domain: sr.domain || '',
        category: sr.category || 'other',
        visitTime,
        duration: sr.duration || 0,
        date: sr.date || new Date(visitTime).toISOString().split('T')[0]
      });
      existingKeys.add(key);
      added++;
    }

    if (added > 0) {
      await chrome.storage.local.set({ browsingData });
      console.log(`从服务器拉取了 ${added} 条新记录`);
    }
  }

  // 检查服务器连接
  // 连接检查去重：并发调用共享同一个 Promise
  _connectionPromise = null;
  _connectionTime = 0;

  async checkConnection() {
    const now = Date.now();
    // 10 秒内复用上次结果
    if (this._connectionPromise && now - this._connectionTime < 10000) {
      return this._connectionPromise;
    }
    this._connectionTime = now;
    this._connectionPromise = this._doCheckConnection();
    return this._connectionPromise;
  }

  async _doCheckConnection() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${this.apiBaseUrl}/`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timer);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  // 双向同步设置（冲突解决：最后修改时间较新者优先）
  async syncSettings() {
    await this.initUserId();
    const authHeaders = await this._getAuthHeaders();

    // 拉取云端设置
    let cloudData;
    try {
      const resp = await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`, { headers: authHeaders });
      if (!resp.ok) throw new Error('拉取失败');
      cloudData = await resp.json();
    } catch {
      return { action: 'skip', message: '无法拉取云端设置' };
    }

    const cloudSettings = cloudData.settings || {};
    const cloudUpdatedAt = cloudData.updated_at ? new Date(cloudData.updated_at).getTime() : 0;
    const { settingsSyncTime = 0 } = await chrome.storage.local.get('settingsSyncTime');

    // 本地设置
    const localPrefs = await getPreferences();

    if (!cloudUpdatedAt) {
      // 云端无设置，推送本地设置
      const resp = await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(localPrefs)
      });
      if (!resp.ok) return { action: 'skip', message: `推送设置失败: ${resp.status}` };
      await chrome.storage.local.set({ settingsSyncTime: Date.now() });
      return { action: 'push', message: '首次同步：已推送本地设置到云端' };
    }

    if (cloudUpdatedAt > settingsSyncTime) {
      // 云端更新，拉取到本地（合并：云端覆盖本地，但保留本地独有的键）
      const merged = { ...localPrefs, ...cloudSettings };
      await chrome.storage.local.set({ ...merged, settingsSyncTime: Date.now() });
      return { action: 'pull', message: '已从云端拉取最新设置' };
    }

    // 本地更新或相同，推送本地设置
    const resp = await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(localPrefs)
    });
    if (!resp.ok) return { action: 'skip', message: `推送设置失败: ${resp.status}` };
    await chrome.storage.local.set({ settingsSyncTime: Date.now() });
    return { action: 'push', message: '已推送本地设置到云端' };
  }

  // 同步分类规则（双向）
  async syncClassificationRules() {
    await this.initUserId();
    const authHeaders = await this._getAuthHeaders();

    let cloudData;
    try {
      const resp = await fetch(`${this.apiBaseUrl}/api/classification-rules/${this.userId}`, { headers: authHeaders });
      if (!resp.ok) throw new Error('拉取失败');
      cloudData = await resp.json();
    } catch {
      return { action: 'skip', message: '无法拉取云端分类规则' };
    }

    const cloudRules = cloudData.rules || {};
    const cloudUpdatedAt = cloudData.updated_at ? new Date(cloudData.updated_at).getTime() : 0;
    const { rulesSyncTime = 0, classificationOverrides = {} } = await chrome.storage.local.get(['rulesSyncTime', 'classificationOverrides']);

    if (!cloudUpdatedAt) {
      // 云端无规则，推送本地
      const resp = await fetch(`${this.apiBaseUrl}/api/classification-rules/${this.userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(classificationOverrides)
      });
      if (!resp.ok) return { action: 'skip', message: `推送分类规则失败: ${resp.status}` };
      await chrome.storage.local.set({ rulesSyncTime: Date.now() });
      return { action: 'push', message: '首次同步：已推送本地分类规则到云端' };
    }

    if (cloudUpdatedAt > rulesSyncTime) {
      // 云端更新，合并到本地（两边都有的取最新，只一边有的保留）
      const merged = { ...classificationOverrides, ...cloudRules };
      await chrome.storage.local.set({ classificationOverrides: merged, rulesSyncTime: Date.now() });
      return { action: 'pull', message: '已从云端合并分类规则' };
    }

    // 本地更新或相同，推送
    const resp = await fetch(`${this.apiBaseUrl}/api/classification-rules/${this.userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(classificationOverrides)
    });
    if (!resp.ok) return { action: 'skip', message: `推送分类规则失败: ${resp.status}` };
    await chrome.storage.local.set({ rulesSyncTime: Date.now() });
    return { action: 'push', message: '已推送本地分类规则到云端' };
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataSync;
}
