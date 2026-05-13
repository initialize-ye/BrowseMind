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

class DataSync {
  constructor(apiBaseUrl = 'http://119.29.55.112:8000') {
    this.apiBaseUrl = apiBaseUrl;
    this.userId = null;
    this._initPromise = null; // mutex for concurrent initUserId() calls
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

      const response = await fetch(`${this.apiBaseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
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
      const response = await fetch(
        `${this.apiBaseUrl}/api/analysis/${this.userId}?days=${days}`
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
      const response = await fetch(`${this.apiBaseUrl}/api/stats/${this.userId}`);

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
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.apiBaseUrl}/`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timer);
      return response.ok;
    } catch (error) {
      console.error('服务器连接失败:', error);
      return false;
    }
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataSync;
}
