// BrowseMind 数据同步模块 - 与后端服务通信

class DataSync {
  constructor(apiBaseUrl = 'http://119.29.55.112:8000') {
    this.apiBaseUrl = apiBaseUrl;
    this.userId = null;
  }

  // 初始化用户ID
  async initUserId() {
    if (this.userId) return this.userId;

    // 从 storage 获取或生成用户ID
    const { userId } = await chrome.storage.local.get('userId');

    if (userId) {
      this.userId = userId;
    } else {
      // 生成新的用户ID
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
      // 获取本地数据
      const { browsingData = [] } = await chrome.storage.local.get('browsingData');

      if (browsingData.length === 0) {
        console.log('没有需要同步的数据');
        return { success: true, message: '没有需要同步的数据' };
      }

      // 初始化分类器
      const classifier = new WebsiteClassifier();

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
      const response = await fetch(`${this.apiBaseUrl}/`, {
        method: 'GET',
        timeout: 5000
      });

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
