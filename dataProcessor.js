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

  // 通用 UI SVG 图标（currentColor 继承文字颜色）
  static UI_ICONS = {
    // 品牌标识（脑形）
    brain: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 00-4.6 1.7A5.5 5.5 0 003 9a5.5 5.5 0 002.2 4.5A4.5 4.5 0 009.5 18h1a.5.5 0 00.5-.5V16a2 2 0 012-2h0a2 2 0 012 2v1.5a.5.5 0 00.5.5h1a4.5 4.5 0 004.3-4.5A5.5 5.5 0 0021 9a5.5 5.5 0 00-4.4-5.3A7 7 0 0012 2z"/><path d="M9 13v-1a3 3 0 016 0v1"/></svg>`,
    // 菜单（三条横线）
    menu: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    // 关闭（X）
    close: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
    // 太阳
    sun: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
    // 月亮
    moon: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>`,
    // 跟随系统
    system: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    // 成功（对勾圆）
    check: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>`,
    // 错误（X圆）
    error: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
    // 警告（三角感叹号）
    warning: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
    // 庆祝（彩带）
    celebrate: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3L2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01M22 2l-2.24.75a2.9 2.9 0 00-1.96 1.96L17 7l2.24-.75a2.9 2.9 0 001.96-1.96L22 2z"/><path d="M11.38 8.87a2.9 2.9 0 00-1.96 1.96l-.75 2.24 2.24-.75a2.9 2.9 0 001.96-1.96l.75-2.24-2.24.75z"/></svg>`,
    // 信息（i圆）
    info: `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`
  };

  static iconFor(category) {
    return WebsiteClassifier.SVG[category] || WebsiteClassifier.SVG.other;
  }

  // 路径级分类规则：域名 + 路径前缀 → 分类
  static PATH_RULES = [
    { domain: 'youtube.com', path: '/feed/subscriptions', category: 'social' },
    { domain: 'youtube.com', path: '/playlist', category: 'learning' },
    { domain: 'github.com', path: '/trending', category: 'learning' },
    { domain: 'github.com', path: '/explore', category: 'learning' },
    { domain: 'bilibili.com', path: '/cheese', category: 'learning' },
    { domain: 'bilibili.com', path: '/read', category: 'learning' },
    { domain: 'zhihu.com', path: '/courses', category: 'learning' },
    { domain: 'douyin.com', path: '/learning', category: 'learning' },
    { domain: 'google.com', path: '/scholar', category: 'learning' },
    { domain: 'google.com', path: '/maps', category: 'tools' },
    { domain: 'google.com', path: '/translate', category: 'tools' },
    { domain: 'notion.so', path: '/wiki', category: 'learning' },
  ];

  constructor(overrides = {}, feedback = {}) {
    this.overrides = overrides; // { normalizedDomain: category, ... }
    this.feedback = feedback; // { domain: { category, count, lastTime }, ... }
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
    return (domain || '')
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/^www\./, '')
      .replace(/^m\./, '');
  }

  matchesDomain(hostname, ruleDomain) {
    return hostname === ruleDomain || (hostname.endsWith('.' + ruleDomain));
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

    // Check path-level rules (domain + path prefix)
    const urlPath = path.split(' ')[0] || ''; // strip query string
    for (const rule of WebsiteClassifier.PATH_RULES) {
      if (this.matchesDomain(hostname, rule.domain) && urlPath.startsWith(rule.path)) {
        return { category: rule.category, confidence: 95, matchedBy: 'path-rule', reason: `${hostname}${rule.path}` };
      }
    }

    const scores = {};
    for (const [category, rule] of Object.entries(this.rules)) {
      scores[category] = this.calculateRuleScore(rule, hostname, lowerTitle, path);
    }
    this.applyAmbiguousOverrides(scores, hostname, lowerTitle);

    // 反馈学习：被用户修正 3 次以上的域名，提升对应分类得分
    const fb = this.feedback[hostname];
    if (fb && fb.count >= 3 && scores[fb.category]) {
      scores[fb.category].score += 40;
      scores[fb.category].matchedBy.push('feedback');
    }

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
    this._cache = null;
  }

  // 单次遍历计算所有统计（缓存结果）
  _computeAll() {
    if (this._cache) return this._cache;
    const today = new Date().toISOString().split('T')[0];
    const categoryStats = {};
    const todayCategoryStats = {};
    const hourlyStats = Array(24).fill(0).map((_, hour) => ({ hour, duration: 0, visits: 0 }));

    for (const record of this.data) {
      const category = record.category || 'other';
      const duration = record.duration || 0;
      const hour = new Date(record.visitTime).getHours();

      // 分类统计
      if (!categoryStats[category]) {
        categoryStats[category] = { category, visits: 0, totalDuration: 0, domains: new Set() };
      }
      categoryStats[category].visits++;
      categoryStats[category].totalDuration += duration;
      categoryStats[category].domains.add(record.domain);

      // 今日分类统计
      if (record.date === today) {
        if (!todayCategoryStats[category]) {
          todayCategoryStats[category] = { category, visits: 0, totalDuration: 0, domains: new Set() };
        }
        todayCategoryStats[category].visits++;
        todayCategoryStats[category].totalDuration += duration;
        todayCategoryStats[category].domains.add(record.domain);
      }

      // 小时分布
      hourlyStats[hour].duration += duration;
      hourlyStats[hour].visits++;
    }

    // 计算占比
    const totalDuration = Object.values(categoryStats).reduce((s, st) => s + st.totalDuration, 0);
    const todayTotalDuration = Object.values(todayCategoryStats).reduce((s, st) => s + st.totalDuration, 0);

    const format = (stats, total) => Object.entries(stats).map(([cat, st]) => ({
      category: cat, visits: st.visits, totalDuration: st.totalDuration,
      percentage: total > 0 ? (st.totalDuration / total * 100).toFixed(1) : 0,
      uniqueDomains: st.domains.size
    })).sort((a, b) => b.totalDuration - a.totalDuration);

    this._cache = {
      categoryStats: format(categoryStats, totalDuration),
      todayStats: format(todayCategoryStats, todayTotalDuration),
      hourlyStats
    };
    return this._cache;
  }

  analyzeByCategory() { return this._computeAll().categoryStats; }
  getTodayStats() { return this._computeAll().todayStats; }
  getHourlyDistribution() { return this._computeAll().hourlyStats; }
}

/**
 * 本地高级分析器（后端不可用时的 fallback）
 * 移植自 backend/advanced_analyzer.py
 */
class LocalAdvancedAnalyzer {
  static DISTRACTION_CATEGORIES = new Set(['entertainment', 'social']);
  static FOCUS_CATEGORIES = new Set(['learning', 'coding', 'tools']);
  static HIGH_FREQUENCY_VISITS = 10;

  constructor(thresholdMinutes = 30) {
    this.thresholdSeconds = thresholdMinutes * 60;
  }

  // 时间黑洞检测
  detectBlackholes(records) {
    const blackholes = [];
    let totalDuration = 0;
    const domainStats = {};

    for (const record of records) {
      const domain = record.domain || '';
      const duration = record.duration || 0;
      totalDuration += duration;
      if (!domain) continue;

      if (!domainStats[domain]) {
        domainStats[domain] = { domain, total_duration: 0, visit_count: 0, long_sessions: [], category: '' };
      }
      const s = domainStats[domain];
      s.total_duration += duration;
      s.visit_count++;
      s.category = record.category || 'other';

      if (duration >= this.thresholdSeconds) {
        s.long_sessions.push({ duration, date: record.date || '', title: record.title || '', url: record.url || '' });
      }
    }

    for (const stats of Object.values(domainStats)) {
      const isLong = stats.long_sessions.length > 0;
      const isHighFreq = stats.visit_count >= LocalAdvancedAnalyzer.HIGH_FREQUENCY_VISITS && stats.total_duration >= this.thresholdSeconds;
      if (!isLong && !isHighFreq) continue;

      const blackhole_type = isLong && isHighFreq ? 'both' : isLong ? 'long_session' : 'high_frequency';
      blackholes.push({
        domain: stats.domain,
        category: stats.category,
        total_duration: stats.total_duration,
        visit_count: stats.visit_count,
        long_sessions_count: stats.long_sessions.length,
        longest_session: stats.long_sessions.length ? Math.max(...stats.long_sessions.map(s => s.duration)) : 0,
        sessions: stats.long_sessions.slice(0, 5),
        blackhole_type
      });
    }

    blackholes.sort((a, b) => {
      const wa = LocalAdvancedAnalyzer.DISTRACTION_CATEGORIES.has(a.category) ? 1.5 : 1;
      const wb = LocalAdvancedAnalyzer.DISTRACTION_CATEGORIES.has(b.category) ? 1.5 : 1;
      return (b.total_duration * wb) - (a.total_duration * wa);
    });

    const blackholeTime = blackholes.reduce((s, b) => s + b.total_duration, 0);
    return {
      blackholes,
      total_wasted_time: blackholeTime,
      waste_percentage: totalDuration > 0 ? Math.round(blackholeTime / totalDuration * 1000) / 10 : 0,
      top_blackholes: blackholes.slice(0, 5),
      threshold_minutes: this.thresholdSeconds / 60
    };
  }

  // 注意力曲线分析
  analyzeAttention(records) {
    const hourlyStats = Array(24).fill(null).map(() => ({
      total_duration: 0, focus_duration: 0, entertainment_duration: 0, other_duration: 0
    }));

    for (const record of records) {
      const vt = record.visitTime;
      let hour;
      if (typeof vt === 'number') {
        hour = new Date(vt).getHours();
      } else if (typeof vt === 'string') {
        const d = new Date(vt);
        if (isNaN(d)) continue;
        hour = d.getHours();
      } else {
        continue;
      }

      const duration = record.duration || 0;
      const category = record.category || 'other';
      hourlyStats[hour].total_duration += duration;

      if (LocalAdvancedAnalyzer.FOCUS_CATEGORIES.has(category)) {
        hourlyStats[hour].focus_duration += duration;
      } else if (LocalAdvancedAnalyzer.DISTRACTION_CATEGORIES.has(category)) {
        hourlyStats[hour].entertainment_duration += duration;
      } else {
        hourlyStats[hour].other_duration += duration;
      }
    }

    const hourlyFocus = hourlyStats.map((s, hour) => {
      let score = 0;
      if (s.total_duration > 0) {
        const focusRatio = s.focus_duration / s.total_duration;
        const entRatio = s.entertainment_duration / s.total_duration;
        score = Math.max(0, Math.min(100, focusRatio * 100 - entRatio * 50));
      }
      return {
        hour,
        score: Math.round(score * 10) / 10,
        total_duration: s.total_duration,
        focus_duration: s.focus_duration,
        entertainment_duration: s.entertainment_duration
      };
    });

    const activeHours = hourlyFocus.filter(h => h.total_duration > 0);
    let avgScore = 0, peakHours = [], lowHours = [];

    if (activeHours.length) {
      avgScore = activeHours.reduce((s, h) => s + h.score, 0) / activeHours.length;
      peakHours = activeHours.filter(h => h.score >= avgScore + 20);
      lowHours = activeHours.filter(h => h.score <= avgScore - 20);
    }

    const recommendations = this._generateRecommendations(peakHours, lowHours, hourlyFocus);

    return {
      hourly_focus: hourlyFocus,
      peak_hours: peakHours.map(h => h.hour),
      low_hours: lowHours.map(h => h.hour),
      focus_score: Math.round(avgScore * 10) / 10,
      recommendations
    };
  }

  _generateRecommendations(peakHours, lowHours, hourlyFocus) {
    const recs = [];
    if (peakHours.length) {
      recs.push(`你的高效时段是 ${this._formatTimeRanges(peakHours.map(h => h.hour))}，建议在这些时间处理重要工作`);
    }
    if (lowHours.length) {
      recs.push(`你在 ${this._formatTimeRanges(lowHours.map(h => h.hour))} 容易分心，建议减少娱乐网站访问`);
    }
    const morning = hourlyFocus.filter(h => h.hour >= 6 && h.hour <= 11 && h.total_duration > 0);
    if (morning.length) {
      const morningAvg = morning.reduce((s, h) => s + h.score, 0) / morning.length;
      if (morningAvg < 50) recs.push('早晨效率较低，建议调整作息或减少早晨的娱乐时间');
    }
    const lateNight = hourlyFocus.filter(h => h.hour >= 23 || h.hour <= 2);
    const lateDuration = lateNight.reduce((s, h) => s + h.total_duration, 0);
    if (lateDuration > 3600) recs.push('深夜浏览时间较长，建议早点休息以保证第二天效率');
    if (!recs.length) recs.push('保持当前的浏览习惯，继续加油！');
    return recs;
  }

  _formatTimeRanges(hours) {
    if (!hours.length) return '';
    hours = [...hours].sort((a, b) => a - b);
    const ranges = [];
    let start = hours[0], end = hours[0];
    for (let i = 1; i < hours.length; i++) {
      if (hours[i] === end + 1) { end = hours[i]; }
      else { ranges.push(`${start}:00-${end + 1}:00`); start = end = hours[i]; }
    }
    ranges.push(`${start}:00-${end + 1}:00`);
    return ranges.join('、');
  }

  // 整合分析
  analyzeAll(records, thresholdMinutes) {
    const detector = new LocalAdvancedAnalyzer(thresholdMinutes || this.thresholdSeconds / 60);
    return {
      blackholes: detector.detectBlackholes(records),
      attention_curve: detector.analyzeAttention(records)
    };
  }
}

// ==================== 习惯评分 ====================
class HabitScorer {
  constructor(browsingData, focusSessions = []) {
    this.data = browsingData;
    this.focusSessions = focusSessions;
    this._blackholeDetector = new LocalAdvancedAnalyzer(30);
  }

  computeDailyScore(date) {
    const dayData = this.data.filter(r => r.date === date);
    if (!dayData.length) return null;
    const totalDuration = dayData.reduce((s, r) => s + (r.duration || 0), 0);
    if (totalDuration < 300) return null;

    const focusCats = new Set(['learning', 'coding']);
    const learningDuration = dayData
      .filter(r => focusCats.has(r.category))
      .reduce((s, r) => s + (r.duration || 0), 0);

    // 学习比例 (0-40)
    const learningRatio = learningDuration / totalDuration;
    const learningScore = Math.min(40, Math.round(learningRatio * 50));

    // 专注完成率 (0-25)
    const daySessions = this.focusSessions.filter(s => {
      const d = new Date(s.startTime);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === date;
    });
    const completionRate = daySessions.length > 0
      ? daySessions.filter(s => s.completed).length / daySessions.length
      : 0;
    const focusScore = Math.round(completionRate * 25);

    // 时间黑洞惩罚 (0-20)
    const blackholes = this._blackholeDetector.detectBlackholes(dayData);
    const blackholePenalty = Math.min(20, (blackholes.blackholes?.length || 0) * 5);
    const blackholeScore = 20 - blackholePenalty;

    // 浏览分散度 (0-15)
    const activeHours = new Set(dayData.map(r => new Date(r.visitTime).getHours()));
    const consistencyScore = Math.min(15, Math.round(activeHours.size * 1.5));

    return Math.min(100, Math.max(0, learningScore + focusScore + blackholeScore + consistencyScore));
  }

  computeProductivityIndex(days = 7) {
    const today = new Date();
    let totalFocus = 0, totalTime = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(today - i * 86400000);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayData = this.data.filter(r => r.date === dateStr);
      const t = dayData.reduce((s, r) => s + (r.duration || 0), 0);
      const f = dayData.filter(r => r.category === 'learning' || r.category === 'coding')
        .reduce((s, r) => s + (r.duration || 0), 0);
      totalTime += t;
      totalFocus += f;
    }
    return totalTime > 0 ? totalFocus / totalTime : 0;
  }

  computeScoreHistory(days = 14) {
    const today = new Date();
    const history = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today - i * 86400000);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const score = this.computeDailyScore(dateStr);
      if (score !== null) history.push({ date: dateStr, score });
    }
    return history;
  }

  getRecommendation(score) {
    if (score === null || score === undefined) return '数据不足，继续浏览后即可获得评分';
    if (score >= 80) return '保持当前节奏，浏览习惯很健康！';
    if (score >= 60) return '尝试增加专注会话，减少娱乐时间占比';
    if (score >= 40) return '学习时间偏低，建议设定每日学习目标';
    return '浏览习惯需要改善，建议开启专注模式和干预提醒';
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DataProcessor, WebsiteClassifier, StatisticsAnalyzer, LocalAdvancedAnalyzer, HabitScorer };
}
