// BrowseMind 数据处理模块 - 清洗、分类、统计

/**
 * 数据清洗：提取域名、去重、分组
 */
class DataProcessor {
  constructor(rawData) {
    this.rawData = rawData;
    this.processedData = [];
  }

  // 提取域名
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return null;
    }
  }

  // 清洗数据
  clean() {
    this.processedData = this.rawData
      .filter(record => record.url && !record.url.startsWith('chrome://'))
      .map(record => ({
        ...record,
        domain: this.extractDomain(record.url),
        category: null // 稍后分类
      }))
      .filter(record => record.domain); // 移除无效域名

    return this;
  }

  // 按天分组
  groupByDay() {
    const grouped = {};

    this.processedData.forEach(record => {
      const date = record.date;
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(record);
    });

    return grouped;
  }

  // 按域名分组并统计
  groupByDomain() {
    const domainStats = {};

    this.processedData.forEach(record => {
      const domain = record.domain;
      if (!domainStats[domain]) {
        domainStats[domain] = {
          domain,
          visits: 0,
          totalDuration: 0,
          titles: new Set()
        };
      }

      domainStats[domain].visits++;
      domainStats[domain].totalDuration += record.duration || 0;
      domainStats[domain].titles.add(record.title);
    });

    // 转换为数组并排序
    return Object.values(domainStats)
      .map(stat => ({
        ...stat,
        titles: Array.from(stat.titles),
        avgDuration: stat.totalDuration / stat.visits
      }))
      .sort((a, b) => b.totalDuration - a.totalDuration);
  }

  // 去重（相同域名在同一天只保留最长停留时间的记录）
  deduplicate() {
    const uniqueMap = new Map();

    this.processedData.forEach(record => {
      const key = `${record.domain}-${record.date}`;
      const existing = uniqueMap.get(key);

      if (!existing || record.duration > existing.duration) {
        uniqueMap.set(key, record);
      }
    });

    this.processedData = Array.from(uniqueMap.values());
    return this;
  }

  getData() {
    return this.processedData;
  }
}

/**
 * 网站分类器 - 基于规则的分类系统
 */
class WebsiteClassifier {
  constructor() {
    // 分类规则：关键词匹配
    this.rules = {
      learning: {
        name: '学习',
        icon: '📚',
        keywords: [
          'edu', 'university', 'course', 'mooc', 'udemy', 'coursera',
          'khan', 'edx', 'learn', 'tutorial', 'documentation', 'docs',
          'wikipedia', 'wiki', 'baike', 'zhihu', 'quora', 'stackoverflow',
          'medium', 'blog', 'article', 'paper', 'arxiv', 'scholar'
        ],
        domains: [
          'wikipedia.org', 'zhihu.com', 'stackoverflow.com', 'medium.com',
          'csdn.net', 'juejin.cn', 'segmentfault.com', 'cnblogs.com',
          'jianshu.com', 'oschina.net', 'infoq.cn'
        ]
      },
      coding: {
        name: '编程',
        icon: '💻',
        keywords: [
          'github', 'gitlab', 'bitbucket', 'code', 'dev', 'developer',
          'programming', 'coding', 'npm', 'pypi', 'maven', 'cargo',
          'docker', 'kubernetes', 'aws', 'azure', 'cloud'
        ],
        domains: [
          'github.com', 'gitlab.com', 'gitee.com', 'coding.net',
          'leetcode.com', 'leetcode.cn', 'hackerrank.com', 'codewars.com',
          'replit.com', 'codesandbox.io', 'stackblitz.com'
        ]
      },
      entertainment: {
        name: '娱乐',
        icon: '🎮',
        keywords: [
          'video', 'movie', 'film', 'tv', 'music', 'game', 'gaming',
          'play', 'watch', 'stream', 'netflix', 'youtube', 'bilibili',
          'douyin', 'tiktok', 'instagram', 'twitter', 'weibo'
        ],
        domains: [
          'youtube.com', 'bilibili.com', 'douyin.com', 'tiktok.com',
          'netflix.com', 'iqiyi.com', 'youku.com', 'qq.com',
          'twitch.tv', 'huya.com', 'douyu.com',
          'steam', 'epicgames.com', 'ea.com'
        ]
      },
      social: {
        name: '社交',
        icon: '💬',
        keywords: [
          'chat', 'message', 'social', 'friend', 'community',
          'forum', 'discuss', 'talk', 'wechat', 'qq', 'telegram',
          'whatsapp', 'discord', 'slack', 'teams'
        ],
        domains: [
          'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
          'weibo.com', 'douban.com', 'xiaohongshu.com',
          'discord.com', 'slack.com', 'teams.microsoft.com',
          'reddit.com', 'v2ex.com', 'hostloc.com'
        ]
      },
      tools: {
        name: '工具',
        icon: '🔧',
        keywords: [
          'mail', 'email', 'calendar', 'drive', 'cloud', 'storage',
          'translate', 'map', 'weather', 'news', 'search',
          'google', 'baidu', 'bing', 'notion', 'trello', 'jira'
        ],
        domains: [
          'google.com', 'baidu.com', 'bing.com',
          'gmail.com', 'outlook.com', 'mail.qq.com',
          'notion.so', 'trello.com', 'asana.com', 'monday.com',
          'figma.com', 'canva.com', 'photopea.com',
          'translate.google.com', 'deepl.com'
        ]
      }
    };
  }

  // 分类单个网站
  classify(domain, title = '') {
    const lowerDomain = domain.toLowerCase();
    const lowerTitle = title.toLowerCase();

    // 遍历所有分类规则
    for (const [category, rule] of Object.entries(this.rules)) {
      // 精确域名匹配
      if (rule.domains.some(d => lowerDomain.includes(d))) {
        return category;
      }

      // 关键词匹配（域名或标题）
      if (rule.keywords.some(keyword =>
        lowerDomain.includes(keyword) || lowerTitle.includes(keyword)
      )) {
        return category;
      }
    }

    return 'other'; // 未分类
  }

  // 批量分类
  classifyBatch(records) {
    return records.map(record => ({
      ...record,
      category: this.classify(record.domain, record.title)
    }));
  }

  // 获取分类信息
  getCategoryInfo(category) {
    return this.rules[category] || { name: '其他', icon: '📦' };
  }

  // 获取所有分类
  getAllCategories() {
    return {
      ...this.rules,
      other: { name: '其他', icon: '📦', keywords: [], domains: [] }
    };
  }
}

/**
 * 统计分析器
 */
class StatisticsAnalyzer {
  constructor(data) {
    this.data = data;
  }

  // 按分类统计
  analyzeByCategory() {
    const categoryStats = {};

    this.data.forEach(record => {
      const category = record.category || 'other';

      if (!categoryStats[category]) {
        categoryStats[category] = {
          category,
          visits: 0,
          totalDuration: 0,
          domains: new Set()
        };
      }

      categoryStats[category].visits++;
      categoryStats[category].totalDuration += record.duration || 0;
      categoryStats[category].domains.add(record.domain);
    });

    // 计算占比
    const totalDuration = Object.values(categoryStats)
      .reduce((sum, stat) => sum + stat.totalDuration, 0);

    return Object.entries(categoryStats).map(([category, stat]) => ({
      category,
      visits: stat.visits,
      totalDuration: stat.totalDuration,
      percentage: totalDuration > 0 ? (stat.totalDuration / totalDuration * 100).toFixed(1) : 0,
      uniqueDomains: stat.domains.size
    }))
    .sort((a, b) => b.totalDuration - a.totalDuration);
  }

  // 今日统计
  getTodayStats() {
    const today = new Date().toISOString().split('T')[0];
    const todayData = this.data.filter(r => r.date === today);

    const analyzer = new StatisticsAnalyzer(todayData);
    return analyzer.analyzeByCategory();
  }

  // 获取时间分布（按小时）
  getHourlyDistribution() {
    const hourlyStats = Array(24).fill(0).map((_, hour) => ({
      hour,
      duration: 0,
      visits: 0
    }));

    this.data.forEach(record => {
      const hour = new Date(record.visitTime).getHours();
      hourlyStats[hour].duration += record.duration || 0;
      hourlyStats[hour].visits++;
    });

    return hourlyStats;
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DataProcessor, WebsiteClassifier, StatisticsAnalyzer };
}
