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
  interventionCooldownMinutes: 30
};

// 模块级缓存：避免每次调用都重新计算 Object.keys
const ALL_PREF_KEYS = Object.keys(DEFAULT_PREFERENCES);

// 统一获取偏好设置（供 popup/dashboard/background 共用）
async function getPreferences() {
  const stored = await chrome.storage.local.get(ALL_PREF_KEYS);
  const defaults = DEFAULT_PREFERENCES;
  return {
    apiBaseUrl: (stored.apiBaseUrl != null && stored.apiBaseUrl !== '') ? stored.apiBaseUrl : defaults.apiBaseUrl,
    autoSyncEnabled: stored.autoSyncEnabled != null ? stored.autoSyncEnabled : defaults.autoSyncEnabled,
    autoSyncDebounceMs: stored.autoSyncDebounceMs != null ? Number(stored.autoSyncDebounceMs) : defaults.autoSyncDebounceMs,
    autoSyncMinIntervalMs: stored.autoSyncMinIntervalMs != null ? Number(stored.autoSyncMinIntervalMs) : defaults.autoSyncMinIntervalMs,
    dataRetentionDays: stored.dataRetentionDays != null ? Number(stored.dataRetentionDays) : defaults.dataRetentionDays,
    minVisitDurationSeconds: stored.minVisitDurationSeconds != null ? Number(stored.minVisitDurationSeconds) : defaults.minVisitDurationSeconds,
    notificationsEnabled: stored.notificationsEnabled != null ? stored.notificationsEnabled : defaults.notificationsEnabled,
    blackholeThresholdMinutes: stored.blackholeThresholdMinutes != null ? Number(stored.blackholeThresholdMinutes) : defaults.blackholeThresholdMinutes,
    analysisDays: stored.analysisDays != null ? Number(stored.analysisDays) : defaults.analysisDays,
    interventionsEnabled: stored.interventionsEnabled != null ? stored.interventionsEnabled : defaults.interventionsEnabled,
    focusModeEnabled: stored.focusModeEnabled != null ? stored.focusModeEnabled : defaults.focusModeEnabled,
    domainAllowlist: stored.domainAllowlist != null ? stored.domainAllowlist : defaults.domainAllowlist,
    domainBlocklist: stored.domainBlocklist != null ? stored.domainBlocklist : defaults.domainBlocklist,
    categoryTimeLimits: stored.categoryTimeLimits != null ? stored.categoryTimeLimits : defaults.categoryTimeLimits,
    interventionCooldownMinutes: stored.interventionCooldownMinutes != null ? Number(stored.interventionCooldownMinutes) : defaults.interventionCooldownMinutes
  };
}

function escapeHtml(text) {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(seconds) {
  const total = Math.floor(seconds || 0);
  if (total < 60) return `${total}秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours}小时${remain}分钟` : `${hours}小时`;
}

// 带认证头的 fetch 封装（供 popup/dashboard 直接调用后端 API 时使用）
async function authFetch(url, options = {}) {
  const { authToken } = await chrome.storage.local.get('authToken');
  const headers = { ...(options.headers || {}) };
  if (authToken) headers['X-Auth-Token'] = authToken;
  return fetch(url, { ...options, headers });
}

class DataSync {
  constructor(apiBaseUrl = 'http://119.29.55.112:8000') {
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

      console.log('准备上传数据:', {
        user_id: this.userId,
        records_count: records.length,
        sample_record: records[0]
      });

      const authHeaders = await this._getAuthHeaders();
      const response = await fetch(`${this.apiBaseUrl}/api/upload`, {
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
      // 同步设置
      try {
        const settingsResult = await this.syncSettings();
        console.log('设置同步:', settingsResult.message);
      } catch (e) {
        console.warn('设置同步失败（不影响数据同步）:', e);
      }

      // 获取本地数据和分类覆盖规则
      const { browsingData = [], classificationOverrides = {} } = await chrome.storage.local.get(['browsingData', 'classificationOverrides']);

      if (browsingData.length === 0) {
        console.log('没有需要同步的数据');
        return { success: true, message: '没有需要同步的数据' };
      }

      // 初始化分类器（带用户覆盖规则）
      const classifier = new WebsiteClassifier(classificationOverrides);

      // 转换数据格式并分类
      const records = browsingData.map(record => {
        const domain = this.extractDomain(record.url);
        const title = record.title || '';
        const category = record.category || classifier.classify(domain || '', title, record.url || '');

        return {
          url: record.url,
          title: title,
          domain: domain,
          category: category,
          visit_time: Math.floor(record.visitTime), // 转换为整数
          duration: Math.floor(record.duration || 0), // 转换为整数
          date: record.date
        };
      });

      // 上传到服务器
      const result = await this.uploadData(records);

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

  // 提取域名
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return WebsiteClassifier.normalizeDomain(urlObj.hostname);
    } catch {
      return null;
    }
  }

  // 检查服务器连接
  async checkConnection() {
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
      console.error('服务器连接失败:', error.message || error);
      return false;
    }
  }

  // 上传设置到云端
  async pushSettings(preferences) {
    await this.initUserId();
    const authHeaders = await this._getAuthHeaders();
    const response = await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(preferences)
    });
    if (!response.ok) throw new Error(`推送设置失败: ${response.status}`);
    return response.json();
  }

  // 从云端拉取设置
  async pullSettings() {
    await this.initUserId();
    const response = await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`);
    if (!response.ok) throw new Error(`拉取设置失败: ${response.status}`);
    return response.json();
  }

  // 双向同步设置（冲突解决：最后修改时间较新者优先）
  async syncSettings() {
    await this.initUserId();
    const authHeaders = await this._getAuthHeaders();

    // 拉取云端设置
    let cloudData;
    try {
      const resp = await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`);
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
      await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(localPrefs)
      });
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
    await fetch(`${this.apiBaseUrl}/api/settings/${this.userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(localPrefs)
    });
    await chrome.storage.local.set({ settingsSyncTime: Date.now() });
    return { action: 'push', message: '已推送本地设置到云端' };
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataSync;
}
