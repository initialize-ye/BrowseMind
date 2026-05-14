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
      return WebsiteClassifier.normalizeDomain(urlObj.hostname);
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
  // 分类名称映射
  static CATEGORY_NAMES = { entertainment: '娱乐', social: '社交', learning: '学习', coding: '编程', tools: '工具', other: '其他' };
  // 黑洞类型标签
  static BLACKHOLE_TYPE_LABELS = { long_session: '长时间沉浸', high_frequency: '频繁访问', both: '沉浸 + 频繁' };
  // popup 用的简短版本
  static BLACKHOLE_TYPE_LABELS_SHORT = { long_session: '沉浸', high_frequency: '频繁', both: '沉浸+频繁' };

  // 分类 SVG 图标（16×16，currentColor 继承文字颜色，静态硬编码无用户输入，XSS 安全）
  static SVG = {
    learning: `<svg class="cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12.5V3a1 1 0 011-1h4.5L12 6.5V12.5"/><path d="M7.5 2v4.5H12"/><path d="M4.5 9h3"/><path d="M4.5 11.5h5"/></svg>`,
    coding: `<svg class="cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4L1.5 8L5 12"/><path d="M11 4l3.5 4-3.5 4"/><path d="M9.5 2.5L6.5 13.5"/></svg>`,
    entertainment: `<svg class="cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M6.5 5.5l4 2.5-4 2.5V5.5z" fill="currentColor" stroke="none"/></svg>`,
    social: `<svg class="cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h12v8H6L2 14V3z"/></svg>`,
    tools: `<svg class="cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L2 6l3 3-1.5 4.5L8 10l4.5 1.5L14 7l-4-4"/><circle cx="11" cy="5" r="1" fill="currentColor" stroke="none"/></svg>`,
    other: `<svg class="cat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="12" height="10" rx="1"/><path d="M5 4V2.5A1.5 1.5 0 016.5 1h3A1.5 1.5 0 0111 2.5V4"/><path d="M2 8h12"/></svg>`
  };

  static iconFor(category) {
    return WebsiteClassifier.SVG[category] || WebsiteClassifier.SVG.other;
  }

  constructor(overrides = {}) {
    this.overrides = overrides; // { normalizedDomain: category, ... }
    this.rules = {
      learning: {
        name: '学习',
        icon: WebsiteClassifier.SVG.learning,
        domains: [
          'wikipedia.org', 'wikihow.com', 'zhihu.com', 'quora.com', 'stackoverflow.com',
          'medium.com', 'dev.to', 'hashnode.dev', 'csdn.net', 'juejin.cn',
          'segmentfault.com', 'cnblogs.com', 'jianshu.com', 'oschina.net', 'infoq.cn',
          'developer.mozilla.org', 'web.dev', 'docs.python.org', 'readthedocs.io',
          'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'arxiv.org',
          'scholar.google.com', 'researchgate.net', 'paperswithcode.com', 'towardsdatascience.com',
          'runoob.com', 'liaoxuefeng.com', 'geeksforgeeks.org', 'freecodecamp.org'
        ],
        strongKeywords: [
          'tutorial', 'course', 'lesson', 'lecture', 'documentation', 'docs', 'guide',
          'reference', 'manual', 'how to', 'learn', 'learning', 'paper', 'research',
          'thesis', 'arxiv', 'scholar', 'wiki', '知识', '教程', '文档', '课程',
          '学习', '论文', '百科', '指南', '手册', '笔记', '题解', '讲义'
        ],
        weakKeywords: [
          'blog', 'article', 'explained', 'introduction', 'overview', 'example',
          'best practice', 'case study', '分享', '详解', '入门', '实践', '总结'
        ]
      },
      coding: {
        name: '编程',
        icon: WebsiteClassifier.SVG.coding,
        domains: [
          'github.com', 'gitlab.com', 'bitbucket.org', 'gitee.com', 'coding.net',
          'leetcode.com', 'leetcode.cn', 'hackerrank.com', 'codewars.com', 'codeforces.com',
          'atcoder.jp', 'nowcoder.com', 'luogu.com.cn', 'replit.com', 'codesandbox.io',
          'stackblitz.com', 'codepen.io', 'npmjs.com', 'pypi.org', 'mvnrepository.com',
          'crates.io', 'pkg.go.dev', 'nodejs.org', 'deno.com', 'bun.sh', 'docker.com',
          'kubernetes.io', 'vercel.com', 'netlify.com', 'cloudflare.com', 'huggingface.co'
        ],
        strongKeywords: [
          'github', 'gitlab', 'repository', 'repo', 'pull request', 'commit', 'issue',
          'code', 'coding', 'programming', 'developer', 'debug', 'api', 'sdk', 'cli',
          'npm', 'pypi', 'package', 'framework', 'library', 'docker', 'kubernetes',
          'deploy', 'build', 'algorithm', 'leetcode', '代码', '开发', '编程', '仓库',
          '提交', '调试', '接口', '算法', '刷题', '源码', '部署'
        ],
        weakKeywords: [
          'javascript', 'typescript', 'python', 'java', 'golang', 'rust', 'react',
          'vue', 'node', 'fastapi', 'django', 'flask', 'sql', 'database', '数据库',
          '前端', '后端', '全栈', '脚本', '组件'
        ]
      },
      entertainment: {
        name: '娱乐',
        icon: WebsiteClassifier.SVG.entertainment,
        domains: [
          'youtube.com', 'youtu.be', 'bilibili.com', 'douyin.com', 'tiktok.com',
          'netflix.com', 'iqiyi.com', 'youku.com', 'v.qq.com', 'mgtv.com', 'twitch.tv',
          'huya.com', 'douyu.com', 'steamcommunity.com', 'store.steampowered.com',
          'epicgames.com', 'ea.com', 'xbox.com', 'playstation.com', 'nintendo.com',
          'music.163.com', 'y.qq.com', 'spotify.com', 'soundcloud.com', 'douban.fm'
        ],
        strongKeywords: [
          'video', 'movie', 'film', 'tv', 'music', 'game', 'gaming', 'stream',
          'netflix', 'youtube', 'bilibili', 'douyin', 'tiktok', 'anime', 'manga',
          'podcast', 'trailer', 'live', '直播', '视频', '音乐', '综艺', '番剧',
          '电影', '游戏', '手游', '网游', '追剧', '娱乐', '动漫'
        ],
        weakKeywords: [
          'watch', 'play', 'episode', 'season', 'clip', 'shorts', 'reaction',
          '观看', '播放', '剧集', '剪辑', '解说'
        ]
      },
      social: {
        name: '社交',
        icon: WebsiteClassifier.SVG.social,
        domains: [
          'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'threads.net',
          'weibo.com', 'douban.com', 'xiaohongshu.com', 'reddit.com', 'v2ex.com',
          'hostloc.com', 'tieba.baidu.com', 'discord.com', 'discord.gg', 'slack.com',
          'teams.microsoft.com', 't.me', 'web.telegram.org', 'web.whatsapp.com',
          'linkedin.com', 'mastodon.social'
        ],
        strongKeywords: [
          'chat', 'message', 'social', 'friend', 'community', 'forum', 'discuss',
          'wechat', 'telegram', 'whatsapp', 'discord', 'slack', 'teams', 'reddit',
          'twitter', 'weibo', 'dm', '社交', '社区', '论坛', '帖子', '聊天', '消息',
          '群组', '私信', '评论'
        ],
        weakKeywords: [
          'talk', 'reply', 'share', 'following', 'followers', '动态', '关注',
          '讨论', '回复', '分享'
        ]
      },
      tools: {
        name: '工具',
        icon: WebsiteClassifier.SVG.tools,
        domains: [
          'google.com', 'baidu.com', 'bing.com', 'duckduckgo.com', 'gmail.com',
          'outlook.com', 'mail.qq.com', 'notion.so', 'trello.com', 'asana.com',
          'monday.com', 'linear.app', 'jira.com', 'atlassian.net', 'figma.com',
          'canva.com', 'photopea.com', 'miro.com', 'translate.google.com', 'deepl.com',
          'drive.google.com', 'docs.google.com', 'sheets.google.com', 'calendar.google.com',
          'chatgpt.com', 'claude.ai', 'perplexity.ai', 'openai.com', 'gemini.google.com',
          'poe.com', 'copy.ai', 'zapier.com', 'dropbox.com', 'onedrive.live.com'
        ],
        strongKeywords: [
          'mail', 'email', 'calendar', 'drive', 'storage', 'translate', 'map',
          'weather', 'search', 'notion', 'trello', 'jira', 'workspace', 'office',
          'design', 'figma', 'dashboard', 'editor', 'document', 'sheet', 'meeting',
          'ai', 'assistant', 'chatgpt', 'claude', 'perplexity', '邮箱', '日历',
          '翻译', '网盘', '设计', '搜索', '协作', '助手', '会议', '文档', '表格', '看板'
        ],
        weakKeywords: [
          'tool', 'tools', 'productivity', 'workflow', 'automation', 'convert',
          'generator', '管理', '工具', '效率', '自动化', '生成器'
        ]
      }
    };
    this.minimumScore = 28;
    this.ambiguousDomains = ['google.com', 'baidu.com', 'bing.com', 'youtube.com', 'bilibili.com', 'reddit.com', 'zhihu.com', 'medium.com', 'douban.com'];
  }

  static normalizeDomain(domain = '') {
    return domain
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/^www\./, '')
      .replace(/^m\./, '');
  }

  matchesDomain(hostname, ruleDomain) {
    return hostname === ruleDomain || hostname.endsWith(`.${ruleDomain}`);
  }

  includesAny(text, keywords = []) {
    return keywords.some(keyword => text.includes(keyword));
  }

  calculateRuleScore(rule, hostname, title, path) {
    let score = 0;
    let matchedBy = [];

    if (rule.domains.some(ruleDomain => this.matchesDomain(hostname, ruleDomain))) {
      score += 90;
      matchedBy.push('domain');
    }

    if (this.includesAny(hostname, rule.strongKeywords)) {
      score += 45;
      matchedBy.push('hostname');
    }

    const strongTitleHits = (rule.strongKeywords || []).filter(keyword => title.includes(keyword)).length;
    if (strongTitleHits) {
      score += Math.min(60, strongTitleHits * 28);
      matchedBy.push('title');
    }

    const weakTitleHits = (rule.weakKeywords || []).filter(keyword => title.includes(keyword)).length;
    if (weakTitleHits) {
      score += Math.min(30, weakTitleHits * 12);
      matchedBy.push('title');
    }

    if (path && this.includesAny(path, rule.strongKeywords)) {
      score += 18;
      matchedBy.push('path');
    }

    return { score, matchedBy };
  }

  parseInput(domain, url = '') {
    const source = url || domain || '';
    try {
      const urlObj = source.includes('://') ? new URL(source) : new URL(`https://${source}`);
      return {
        hostname: WebsiteClassifier.normalizeDomain(urlObj.hostname),
        path: `${urlObj.pathname || ''} ${urlObj.search || ''}`.toLowerCase()
      };
    } catch {
      return { hostname: WebsiteClassifier.normalizeDomain(domain), path: '' };
    }
  }

  applyAmbiguousOverrides(scores, hostname, title) {
    const isVideoLearning = this.includesAny(title, [
      'tutorial', 'course', 'lesson', 'lecture', 'how to', 'learn', '教程', '课程', '学习', '讲解', '公开课'
    ]);
    const isTechnical = this.includesAny(title, [
      'github', 'code', 'api', 'sdk', 'programming', 'javascript', 'python', 'react', 'vue', 'docker',
      '代码', '编程', '开发', '算法', '接口', '源码'
    ]);

    if ((this.matchesDomain(hostname, 'youtube.com') || this.matchesDomain(hostname, 'bilibili.com')) && isVideoLearning) {
      scores.learning.score += isTechnical ? 130 : 110;
      scores.learning.matchedBy.push('ambiguous-title');
      scores.entertainment.score = Math.max(0, scores.entertainment.score - 35);
    }

    if ((this.matchesDomain(hostname, 'reddit.com') || this.matchesDomain(hostname, 'zhihu.com') || this.matchesDomain(hostname, 'medium.com')) && isTechnical) {
      scores.learning.score += 120;
      scores.learning.matchedBy.push('ambiguous-title');
      scores.social.score = Math.max(0, scores.social.score - 30);
    }

    if (this.matchesDomain(hostname, 'github.com')) {
      scores.coding.score += 80;
      scores.coding.matchedBy.push('platform');
    }
  }

  classifyDetailed(domain, title = '', url = '') {
    const { hostname, path } = this.parseInput(domain, url);
    const lowerTitle = (title || '').toLowerCase();

    if (!hostname) {
      return { category: 'other', confidence: 0, matchedBy: 'none', reason: 'invalid-domain' };
    }

    // Check user overrides first (exact domain or parent domain match)
    for (const [overrideDomain, overrideCategory] of Object.entries(this.overrides)) {
      if (this.matchesDomain(hostname, overrideDomain)) {
        return { category: overrideCategory, confidence: 100, matchedBy: 'user-override', reason: overrideDomain };
      }
    }

    const scores = {};
    for (const [category, rule] of Object.entries(this.rules)) {
      scores[category] = this.calculateRuleScore(rule, hostname, lowerTitle, path);
    }
    this.applyAmbiguousOverrides(scores, hostname, lowerTitle);

    const ranked = Object.entries(scores)
      .map(([category, result]) => ({ category, ...result }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const runnerUp = ranked[1];
    const isAmbiguous = this.ambiguousDomains.some(ruleDomain => this.matchesDomain(hostname, ruleDomain));
    const requiredScore = isAmbiguous ? this.minimumScore + 12 : this.minimumScore;

    if (!best || best.score < requiredScore || (runnerUp && best.score - runnerUp.score < 8 && best.score < 90)) {
      return { category: 'other', confidence: Math.min(best?.score || 0, 100), matchedBy: 'low-confidence', reason: hostname };
    }

    return {
      category: best.category,
      confidence: Math.min(100, best.score),
      matchedBy: [...new Set(best.matchedBy)].join(',') || 'rule',
      reason: hostname
    };
  }

  // 分类单个网站
  classify(domain, title = '', url = '') {
    return this.classifyDetailed(domain, title, url).category;
  }

  // 批量分类
  classifyBatch(records) {
    return records.map(record => {
      const domain = WebsiteClassifier.normalizeDomain(record.domain || this.extractDomainFromUrl(record.url) || '');
      return {
        ...record,
        domain,
        category: this.classify(domain, record.title || '', record.url || '')
      };
    });
  }

  extractDomainFromUrl(url) {
    try {
      return WebsiteClassifier.normalizeDomain(new URL(url).hostname);
    } catch {
      return null;
    }
  }

  // 获取分类信息
  getCategoryInfo(category) {
    return this.rules[category] || { name: '其他', icon: WebsiteClassifier.SVG.other };
  }

  // 获取所有分类
  getAllCategories() {
    return {
      ...this.rules,
      other: { name: '其他', icon: WebsiteClassifier.SVG.other, domains: [], strongKeywords: [], weakKeywords: [] }
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
