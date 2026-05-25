/**
 * BrowseMind 前端单元测试
 * 测试数据处理、分类、统计等核心逻辑
 * 运行: node test_frontend.js
 */

// ==================== Mock Chrome API ====================
// Proxy-based auto-stub: any missing property returns a no-op function or empty object
function autoStub(depth = 0) {
  return new Proxy(function() {}, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined; // not thenable
      if (depth > 10) return '';
      return autoStub(depth + 1);
    },
    apply() { return autoStub(depth + 1); }
  });
}
const _chromeStub = autoStub();
global.chrome = {
  storage: {
    local: {
      _data: {},
      async get(keys) {
        if (typeof keys === 'string') return { [keys]: this._data[keys] };
        if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) result[k] = this._data[k];
          return result;
        }
        return { ...this._data };
      },
      async set(items) {
        Object.assign(this._data, items);
      }
    },
    onChanged: _chromeStub.storage.onChanged
  },
  runtime: _chromeStub.runtime,
  tabs: _chromeStub.tabs,
  windows: _chromeStub.windows,
  alarms: _chromeStub.alarms,
  action: _chromeStub.action,
  notifications: _chromeStub.notifications,
  contextMenus: _chromeStub.contextMenus
};

// ==================== Load modules ====================
const fs = require('fs');
const vm = require('vm');

// Load modules using IIFE wrapper to capture class declarations
function loadModule(filename, extraGlobals = {}, returnExpr) {
  const code = fs.readFileSync(filename, 'utf8');
  const sandbox = { console, Math, Date, Set, Map, Array, Object, JSON, String, Number, RegExp, URL, setTimeout, clearTimeout, parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, undefined, ...extraGlobals };
  const ctx = vm.createContext(sandbox);
  const wrapped = '(function() {' + code + '\n; return ' + returnExpr + '; })()';
  return vm.runInContext(wrapped, ctx);
}

const dpExports = loadModule('dataProcessor.js', {},
  '{ DataProcessor, WebsiteClassifier, StatisticsAnalyzer, LocalAdvancedAnalyzer }');
const dsExports = loadModule('dataSync.js', {
  chrome,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  module: { exports: {} },
  crypto: { randomUUID: () => 'test-uuid' }
}, '{ compressRecords, decompressRecords, formatDuration, validateBrowsingData, getPreferences }');

// 本地日期工具（与 dataProcessor.js / dataSync.js 保持一致）
function _toLocalDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Load background.js utility functions
const bgCode = fs.readFileSync('background.js', 'utf8');
const bgSandbox = {
  console, Math, Date, Set, Map, Array, Object, JSON, String, Number, RegExp, URL,
  setTimeout, clearTimeout, setInterval, clearInterval, parseInt, parseFloat,
  isNaN, isFinite, Infinity, NaN, undefined,
  chrome,
  importScripts: () => {}, // no-op for Node.js
  fetch: () => Promise.resolve({ ok: true }),
  Response: class Response {}
};
const bgCtx = vm.createContext(bgSandbox);
vm.runInContext(bgCode, bgCtx);
const bgContext = {
  recordKey: bgSandbox.recordKey,
  parseListString: bgSandbox.parseListString,
  isInQuietHours: bgSandbox.isInQuietHours
};

const dpContext = { DataProcessor: dpExports.DataProcessor, WebsiteClassifier: dpExports.WebsiteClassifier, StatisticsAnalyzer: dpExports.StatisticsAnalyzer, LocalAdvancedAnalyzer: dpExports.LocalAdvancedAnalyzer };
const dsContext = { compressRecords: dsExports.compressRecords, decompressRecords: dsExports.decompressRecords, formatDuration: dsExports.formatDuration, validateBrowsingData: dsExports.validateBrowsingData, getPreferences: dsExports.getPreferences };

// ==================== Test Framework ====================
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

// ==================== DataProcessor Tests ====================
console.log('\n=== DataProcessor ===');

test('clean() filters chrome:// URLs', () => {
  const dp = new dpContext.DataProcessor([
    { url: 'chrome://extensions', title: 'Extensions', visitTime: Date.now(), duration: 10 },
    { url: 'https://github.com', title: 'GitHub', visitTime: Date.now(), duration: 60 }
  ]);
  const result = dp.clean().getData();
  assertEqual(result.length, 1, 'Should filter chrome:// URLs');
  assertEqual(result[0].domain, 'github.com', 'Should extract domain');
});

test('clean() filters invalid URLs', () => {
  const dp = new dpContext.DataProcessor([
    { url: '', title: 'Empty', visitTime: Date.now(), duration: 10 },
    { url: 'not-a-url', title: 'Bad', visitTime: Date.now(), duration: 10 },
    { url: 'https://example.com', title: 'Good', visitTime: Date.now(), duration: 60 }
  ]);
  const result = dp.clean().getData();
  assertEqual(result.length, 1, 'Should filter invalid URLs');
});

test('clean() extracts domain correctly', () => {
  const dp = new dpContext.DataProcessor([
    { url: 'https://www.github.com/path', title: 'Test', visitTime: Date.now(), duration: 60 },
    { url: 'https://sub.youtube.com/watch', title: 'Test', visitTime: Date.now(), duration: 60 }
  ]);
  const result = dp.clean().getData();
  assertEqual(result[0].domain, 'github.com', 'Should normalize www');
  assertEqual(result[1].domain, 'sub.youtube.com', 'Should preserve non-www subdomains');
});

test('groupByDay() groups records by date', () => {
  const dp = new dpContext.DataProcessor([
    { url: 'https://a.com', domain: 'a.com', date: '2026-01-01', visitTime: 1, duration: 10 },
    { url: 'https://b.com', domain: 'b.com', date: '2026-01-01', visitTime: 2, duration: 20 },
    { url: 'https://c.com', domain: 'c.com', date: '2026-01-02', visitTime: 3, duration: 30 }
  ]);
  dp.processedData = dp.rawData;
  const grouped = dp.groupByDay();
  assertEqual(Object.keys(grouped).length, 2, 'Should have 2 days');
  assertEqual(grouped['2026-01-01'].length, 2, 'Day 1 should have 2 records');
  assertEqual(grouped['2026-01-02'].length, 1, 'Day 2 should have 1 record');
});

test('deduplicate() keeps longest duration per domain-day', () => {
  const dp = new dpContext.DataProcessor([]);
  dp.processedData = [
    { domain: 'a.com', date: '2026-01-01', duration: 10 },
    { domain: 'a.com', date: '2026-01-01', duration: 30 },
    { domain: 'a.com', date: '2026-01-01', duration: 20 },
    { domain: 'b.com', date: '2026-01-01', duration: 5 }
  ];
  const result = dp.deduplicate().getData();
  assertEqual(result.length, 2, 'Should deduplicate to 2 records');
  const aRec = result.find(r => r.domain === 'a.com');
  assertEqual(aRec.duration, 30, 'Should keep longest duration');
});

test('groupByDomain() calculates correct stats', () => {
  const dp = new dpContext.DataProcessor([]);
  dp.processedData = [
    { domain: 'github.com', title: 'GitHub', duration: 100 },
    { domain: 'github.com', title: 'GitHub PR', duration: 200 },
    { domain: 'youtube.com', title: 'YouTube', duration: 50 }
  ];
  const stats = dp.groupByDomain();
  assertEqual(stats.length, 2, 'Should have 2 domains');
  assertEqual(stats[0].domain, 'github.com', 'Should sort by total duration');
  assertEqual(stats[0].visits, 2, 'Should count visits');
  assertEqual(stats[0].totalDuration, 300, 'Should sum durations');
  assertEqual(stats[0].avgDuration, 150, 'Should calculate average');
});

// ==================== WebsiteClassifier Tests ====================
console.log('\n=== WebsiteClassifier ===');

test('classify() categorizes known domains', () => {
  const classifier = new dpContext.WebsiteClassifier();
  assertEqual(classifier.classify('github.com', '', ''), 'coding', 'GitHub should be coding');
  assertEqual(classifier.classify('youtube.com', '', ''), 'entertainment', 'YouTube should be entertainment');
  assertEqual(classifier.classify('twitter.com', '', ''), 'social', 'Twitter should be social');
  assertEqual(classifier.classify('stackoverflow.com', '', ''), 'learning', 'StackOverflow should be learning');
  assertEqual(classifier.classify('google.com', '', ''), 'tools', 'Google should be tools');
});

test('classify() returns other for unknown domains', () => {
  const classifier = new dpContext.WebsiteClassifier();
  assertEqual(classifier.classify('random-site-xyz.com', '', ''), 'other', 'Unknown should be other');
});

test('classify() applies user overrides', () => {
  const overrides = { 'github.com': 'learning' };
  const classifier = new dpContext.WebsiteClassifier(overrides);
  assertEqual(classifier.classify('github.com', '', ''), 'learning', 'Override should take precedence');
});

test('normalizeDomain() strips www prefix', () => {
  assertEqual(dpContext.WebsiteClassifier.normalizeDomain('www.github.com'), 'github.com', 'Should strip www');
  assertEqual(dpContext.WebsiteClassifier.normalizeDomain('github.com'), 'github.com', 'Should keep bare domain');
  assertEqual(dpContext.WebsiteClassifier.normalizeDomain('www.sub.github.com'), 'sub.github.com', 'Should strip only www');
});

test('classifyBatch() classifies multiple records', () => {
  const classifier = new dpContext.WebsiteClassifier();
  const records = [
    { domain: 'github.com', title: '', url: 'https://github.com' },
    { domain: 'youtube.com', title: '', url: 'https://youtube.com' },
    { domain: 'unknown.com', title: '', url: 'https://unknown.com' }
  ];
  const result = classifier.classifyBatch(records);
  assertEqual(result[0].category, 'coding', 'GitHub should be coding');
  assertEqual(result[1].category, 'entertainment', 'YouTube should be entertainment');
  assertEqual(result[2].category, 'other', 'Unknown should be other');
});

test('path-level classification works', () => {
  const classifier = new dpContext.WebsiteClassifier();
  assertEqual(classifier.classify('youtube.com', '', 'https://youtube.com/feed/subscriptions'), 'social', 'YouTube subscriptions should be social');
  assertEqual(classifier.classify('github.com', '', 'https://github.com/trending'), 'learning', 'GitHub trending should be learning');
});

test('getAllCategories() returns all categories including other', () => {
  const classifier = new dpContext.WebsiteClassifier();
  const cats = classifier.getAllCategories();
  assert('learning' in cats, 'Should have learning');
  assert('coding' in cats, 'Should have coding');
  assert('entertainment' in cats, 'Should have entertainment');
  assert('social' in cats, 'Should have social');
  assert('tools' in cats, 'Should have tools');
  assert('other' in cats, 'Should have other');
});

// ==================== StatisticsAnalyzer Tests ====================
console.log('\n=== StatisticsAnalyzer ===');

test('analyzeByCategory() calculates correct percentages', () => {
  const data = [
    { category: 'coding', duration: 100, visitTime: Date.now(), date: _toLocalDate(Date.now()) },
    { category: 'coding', duration: 100, visitTime: Date.now(), date: _toLocalDate(Date.now()) },
    { category: 'entertainment', duration: 100, visitTime: Date.now(), date: _toLocalDate(Date.now()) }
  ];
  const analyzer = new dpContext.StatisticsAnalyzer(data);
  const stats = analyzer.analyzeByCategory();
  assertEqual(stats[0].category, 'coding', 'Coding should be first');
  assertEqual(stats[0].percentage, '66.7', 'Coding should be 66.7%');
  assertEqual(stats[1].category, 'entertainment', 'Entertainment should be second');
  assertEqual(stats[1].percentage, '33.3', 'Entertainment should be 33.3%');
});

test('analyzeByCategory() handles empty data', () => {
  const analyzer = new dpContext.StatisticsAnalyzer([]);
  const stats = analyzer.analyzeByCategory();
  assertEqual(stats.length, 0, 'Should return empty array');
});

test('analyzeByCategory() handles zero duration', () => {
  const data = [
    { category: 'coding', duration: 0, visitTime: Date.now(), date: _toLocalDate(Date.now()) }
  ];
  const analyzer = new dpContext.StatisticsAnalyzer(data);
  const stats = analyzer.analyzeByCategory();
  assertEqual(stats[0].percentage, 0, 'Should handle zero duration');
});

test('getHourlyDistribution() returns 24 hours', () => {
  const data = [
    { visitTime: new Date('2026-01-01T10:30:00').getTime(), duration: 60, date: '2026-01-01' },
    { visitTime: new Date('2026-01-01T10:45:00').getTime(), duration: 120, date: '2026-01-01' },
    { visitTime: new Date('2026-01-01T14:00:00').getTime(), duration: 60, date: '2026-01-01' }
  ];
  const analyzer = new dpContext.StatisticsAnalyzer(data);
  const hourly = analyzer.getHourlyDistribution();
  assertEqual(hourly.length, 24, 'Should have 24 hours');
  assertEqual(hourly[10].visits, 2, 'Hour 10 should have 2 visits');
  assertEqual(hourly[10].duration, 180, 'Hour 10 should have 180s duration');
  assertEqual(hourly[14].visits, 1, 'Hour 14 should have 1 visit');
  assertEqual(hourly[0].visits, 0, 'Hour 0 should have 0 visits');
});

// ==================== DataSync Tests ====================
console.log('\n=== DataSync ===');

test('compressRecords() and decompressRecords() are inverse', () => {
  const records = [
    { url: 'https://github.com', title: 'GitHub', domain: 'github.com', category: 'coding', visitTime: 1234567890, duration: 100, date: '2026-01-01' },
    { url: 'https://youtube.com', title: 'YouTube', domain: 'youtube.com', category: 'entertainment', visitTime: 1234567891, duration: 200, date: '2026-01-01' }
  ];
  const compressed = dsContext.compressRecords(records);
  assertEqual(compressed[0].u, 'https://github.com', 'Compressed should use short keys');
  assertEqual(compressed[0].t, 'GitHub', 'Title should be compressed');
  assertEqual(compressed[0].d, 'github.com', 'Domain should be compressed');

  const decompressed = dsContext.decompressRecords(compressed);
  assertEqual(decompressed[0].url, 'https://github.com', 'Decompressed should restore url');
  assertEqual(decompressed[0].title, 'GitHub', 'Decompressed should restore title');
  assertEqual(decompressed[0].domain, 'github.com', 'Decompressed should restore domain');
  assertEqual(decompressed[0].category, 'coding', 'Decompressed should restore category');
});

test('compressRecords() omits other category', () => {
  const records = [{ url: 'https://x.com', title: 'X', domain: 'x.com', category: 'other', visitTime: 1, duration: 1, date: '2026-01-01' }];
  const compressed = dsContext.compressRecords(records);
  assert(!('c' in compressed[0]), 'Should omit other category');
});

test('formatDuration() formats seconds correctly', () => {
  assertEqual(dsContext.formatDuration(30), '30秒', '30s');
  assertEqual(dsContext.formatDuration(60), '1分钟', '60s');
  assertEqual(dsContext.formatDuration(90), '1分钟', '90s');
  assertEqual(dsContext.formatDuration(3600), '1小时', '3600s');
  assertEqual(dsContext.formatDuration(3900), '1小时5分钟', '3900s');
  assertEqual(dsContext.formatDuration(0), '0秒', '0s');
  assertEqual(dsContext.formatDuration(null), '0秒', 'null');
  assertEqual(dsContext.formatDuration(undefined), '0秒', 'undefined');
});

test('validateBrowsingData() filters invalid records', () => {
  const data = [
    { url: 'https://a.com', visitTime: 1 },
    null,
    { url: 'https://b.com' }, // missing visitTime
    { visitTime: 2 }, // missing url
    'not an object',
    { url: 'https://c.com', visitTime: 3 }
  ];
  const result = dsContext.validateBrowsingData(data);
  assertEqual(result.length, 2, 'Should filter to 2 valid records');
});

test('validateBrowsingData() handles non-array input', () => {
  assertDeepEqual(dsContext.validateBrowsingData(null), [], 'null should return []');
  assertDeepEqual(dsContext.validateBrowsingData(undefined), [], 'undefined should return []');
  assertDeepEqual(dsContext.validateBrowsingData('string'), [], 'string should return []');
});

test('getPreferences() returns defaults when storage is empty', async () => {
  chrome.storage.local._data = {};
  const prefs = await dsContext.getPreferences();
  assertEqual(prefs.apiBaseUrl, 'http://119.29.55.112:8000', 'Default API URL');
  assertEqual(prefs.autoSyncEnabled, true, 'Default autoSyncEnabled');
  assertEqual(prefs.dataRetentionDays, 7, 'Default dataRetentionDays');
  assertEqual(prefs.analysisDays, 7, 'Default analysisDays');
});

test('getPreferences() uses stored values', async () => {
  chrome.storage.local._data = { apiBaseUrl: 'http://localhost:3000', analysisDays: 14 };
  const prefs = await dsContext.getPreferences();
  assertEqual(prefs.apiBaseUrl, 'http://localhost:3000', 'Should use stored API URL');
  assertEqual(prefs.analysisDays, 14, 'Should use stored analysisDays');
});

test('getPreferences() coerces booleans correctly', async () => {
  chrome.storage.local._data = { autoSyncEnabled: 'true', notificationsEnabled: 'false' };
  const prefs = await dsContext.getPreferences();
  assertEqual(prefs.autoSyncEnabled, true, '"true" should coerce to true');
  assertEqual(prefs.notificationsEnabled, false, '"false" should coerce to false');
});

test('getPreferences() handles null values', async () => {
  chrome.storage.local._data = { apiBaseUrl: null, analysisDays: null };
  const prefs = await dsContext.getPreferences();
  assertEqual(prefs.apiBaseUrl, 'http://119.29.55.112:8000', 'null apiBaseUrl should use default');
  assertEqual(prefs.analysisDays, 7, 'null analysisDays should use default');
});

// ==================== Edge Cases ====================
console.log('\n=== Edge Cases ===');

test('DataProcessor handles empty input', () => {
  const dp = new dpContext.DataProcessor([]);
  const result = dp.clean().getData();
  assertEqual(result.length, 0, 'Empty input should return empty');
});

test('StatisticsAnalyzer handles single record', () => {
  const data = [{ category: 'coding', duration: 60, visitTime: Date.now(), date: _toLocalDate(Date.now()) }];
  const analyzer = new dpContext.StatisticsAnalyzer(data);
  const stats = analyzer.analyzeByCategory();
  assertEqual(stats.length, 1, 'Should have 1 category');
  assertEqual(stats[0].percentage, '100.0', 'Should be 100.0%');
});

test('WebsiteClassifier handles empty domain', () => {
  const classifier = new dpContext.WebsiteClassifier();
  assertEqual(classifier.classify('', '', ''), 'other', 'Empty domain should be other');
});

test('WebsiteClassifier handles null inputs', () => {
  const classifier = new dpContext.WebsiteClassifier();
  assertEqual(classifier.classify(null, null, null), 'other', 'Null inputs should be other');
});

test('compressRecords handles empty array', () => {
  const result = dsContext.compressRecords([]);
  assertDeepEqual(result, [], 'Empty array should return empty');
});

test('decompressRecords handles empty array', () => {
  const result = dsContext.decompressRecords([]);
  assertDeepEqual(result, [], 'Empty array should return empty');
});

test('formatDuration handles negative values', () => {
  assertEqual(dsContext.formatDuration(-10), '0秒', 'Negative should return 0秒');
});

test('DataProcessor handles records with missing fields', () => {
  const dp = new dpContext.DataProcessor([
    { url: 'https://a.com' }, // missing title, duration, date
    { url: 'https://b.com', title: null, duration: null }
  ]);
  const result = dp.clean().getData();
  assertEqual(result.length, 2, 'Should handle missing fields');
});

// ==================== WebsiteClassifier.classifyDetailed Tests ====================
console.log('\n=== WebsiteClassifier.classifyDetailed ===');

test('classifyDetailed() returns confidence and matchedBy', () => {
  const classifier = new dpContext.WebsiteClassifier();
  const result = classifier.classifyDetailed('github.com', '', 'https://github.com');
  assertEqual(result.category, 'coding', 'GitHub should be coding');
  assert(typeof result.confidence === 'number', 'Confidence should be a number');
  assert(result.confidence > 0, 'Confidence should be positive');
  assert(typeof result.matchedBy === 'string', 'matchedBy should be a string');
});

test('classifyDetailed() handles user overrides with high confidence', () => {
  const overrides = { 'github.com': 'learning' };
  const classifier = new dpContext.WebsiteClassifier(overrides);
  const result = classifier.classifyDetailed('github.com', '', 'https://github.com');
  assertEqual(result.category, 'learning', 'Override should take precedence');
  assertEqual(result.confidence, 100, 'Override should have 100 confidence');
  assertEqual(result.matchedBy, 'user-override', 'Should match by user-override');
});

test('classifyDetailed() handles unknown domain with low confidence', () => {
  const classifier = new dpContext.WebsiteClassifier();
  const result = classifier.classifyDetailed('random-xyz.com', '', 'https://random-xyz.com');
  assertEqual(result.category, 'other', 'Unknown should be other');
});

test('classifyDetailed() handles null domain gracefully', () => {
  const classifier = new dpContext.WebsiteClassifier();
  const result = classifier.classifyDetailed(null, '', '');
  assertEqual(result.category, 'other', 'Null domain should be other');
});

test('classifyDetailed() path-level rules override domain rules', () => {
  const classifier = new dpContext.WebsiteClassifier();
  const result = classifier.classifyDetailed('youtube.com', '', 'https://youtube.com/feed/subscriptions');
  assertEqual(result.category, 'social', 'YouTube subscriptions should be social');
  assertEqual(result.matchedBy, 'path-rule', 'Should match by path-rule');
});

test('classifyDetailed() title keywords affect classification', () => {
  const classifier = new dpContext.WebsiteClassifier();
  // YouTube with educational title should classify as learning
  const result = classifier.classifyDetailed('youtube.com', 'Python tutorial for beginners', 'https://youtube.com/watch');
  assertEqual(result.category, 'learning', 'YouTube with tutorial title should be learning');
});

test('matchesDomain() prevents domain suffix matching', () => {
  const classifier = new dpContext.WebsiteClassifier();
  // evil-github.com should NOT match via domain list (github.com) but CAN match via hostname keyword
  assertEqual(classifier.matchesDomain('evil-github.com', 'github.com'), false, 'Should not match via domain suffix');
  assertEqual(classifier.matchesDomain('sub.github.com', 'github.com'), true, 'Subdomain should match');
  assertEqual(classifier.matchesDomain('github.com', 'github.com'), true, 'Exact should match');
  assertEqual(classifier.matchesDomain('notgithub.com', 'github.com'), false, 'Concatenated should not match');
});

// ==================== LocalAdvancedAnalyzer Tests ====================
console.log('\n=== LocalAdvancedAnalyzer ===');

test('detectBlackholes() identifies long sessions', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30); // 30 min threshold
  const records = [
    { domain: 'youtube.com', category: 'entertainment', duration: 2000, visitTime: Date.now(), date: '2026-01-01', url: 'https://youtube.com' },
    { domain: 'youtube.com', category: 'entertainment', duration: 500, visitTime: Date.now(), date: '2026-01-01', url: 'https://youtube.com' },
    { domain: 'github.com', category: 'coding', duration: 100, visitTime: Date.now(), date: '2026-01-01', url: 'https://github.com' }
  ];
  const result = analyzer.detectBlackholes(records);
  assert(result.blackholes.length >= 1, 'Should detect at least 1 blackhole');
  assertEqual(result.blackholes[0].domain, 'youtube.com', 'YouTube should be blackhole');
  assertEqual(result.blackholes[0].blackholeType, 'long_session', 'Should be long_session type');
  assert(result.wastePercentage > 0, 'Waste percentage should be positive');
});

test('detectBlackholes() identifies high frequency patterns', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(5); // 5 min threshold
  const records = [];
  for (let i = 0; i < 15; i++) {
    records.push({ domain: 'twitter.com', category: 'social', duration: 30, visitTime: Date.now(), date: '2026-01-01', url: 'https://twitter.com' });
  }
  const result = analyzer.detectBlackholes(records);
  assert(result.blackholes.length >= 1, 'Should detect high frequency blackhole');
  assertEqual(result.blackholes[0].blackholeType, 'high_frequency', 'Should be high_frequency type');
});

test('detectBlackholes() weights entertainment/social higher', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const records = [
    { domain: 'youtube.com', category: 'entertainment', duration: 1000, visitTime: Date.now(), date: '2026-01-01', url: 'https://youtube.com' },
    { domain: 'docs.google.com', category: 'tools', duration: 1000, visitTime: Date.now(), date: '2026-01-01', url: 'https://docs.google.com' }
  ];
  const result = analyzer.detectBlackholes(records);
  if (result.blackholes.length >= 2) {
    assertEqual(result.blackholes[0].domain, 'youtube.com', 'Entertainment should rank higher due to 1.5x weight');
  }
});

test('detectBlackholes() handles empty records', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const result = analyzer.detectBlackholes([]);
  assertEqual(result.blackholes.length, 0, 'Empty records should return no blackholes');
  assertEqual(result.wastePercentage, 0, 'Empty records should have 0 waste');
});

test('detectBlackholes() handles zero total duration', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const records = [
    { domain: 'a.com', category: 'other', duration: 0, visitTime: Date.now(), date: '2026-01-01', url: 'https://a.com' }
  ];
  const result = analyzer.detectBlackholes(records);
  assertEqual(result.wastePercentage, 0, 'Zero duration should have 0 waste percentage');
});

test('analyzeAttention() computes hourly focus scores', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const records = [
    { visitTime: new Date('2026-01-01T10:00:00').getTime(), duration: 100, category: 'coding' },
    { visitTime: new Date('2026-01-01T10:30:00').getTime(), duration: 50, category: 'entertainment' },
    { visitTime: new Date('2026-01-01T14:00:00').getTime(), duration: 200, category: 'learning' }
  ];
  const result = analyzer.analyzeAttention(records);
  assertEqual(result.hourlyFocus.length, 24, 'Should have 24 hours');
  assert(result.hourlyFocus[10].totalDuration > 0, 'Hour 10 should have activity');
  assert(result.hourlyFocus[14].totalDuration > 0, 'Hour 14 should have activity');
  assert(result.hourlyFocus[0].totalDuration === 0, 'Hour 0 should have no activity');
  assert(typeof result.focusScore === 'number', 'focusScore should be a number');
});

test('analyzeAttention() identifies peak and low hours', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  // Create distinct peak (coding at hour 9) and low (entertainment at hour 22)
  const records = [];
  for (let i = 0; i < 10; i++) {
    const min = String(i * 6).padStart(2, '0');
    records.push({ visitTime: new Date(`2026-01-01T09:${min}:00`).getTime(), duration: 100, category: 'coding' });
    records.push({ visitTime: new Date(`2026-01-01T22:${min}:00`).getTime(), duration: 100, category: 'entertainment' });
  }
  const result = analyzer.analyzeAttention(records);
  assert(Array.isArray(result.peakHours), 'peakHours should be array');
  assert(Array.isArray(result.lowHours), 'lowHours should be array');
  assert(result.hourlyFocus[9].totalDuration > 0, 'Hour 9 should have activity');
  assert(result.hourlyFocus[22].totalDuration > 0, 'Hour 22 should have activity');
});

test('analyzeAttention() handles empty records', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const result = analyzer.analyzeAttention([]);
  assertEqual(result.hourlyFocus.length, 24, 'Should have 24 hours');
  assertEqual(result.focusScore, 0, 'Empty records should have 0 focus score');
  assertEqual(result.peakHours.length, 0, 'No peak hours');
  assertEqual(result.lowHours.length, 0, 'No low hours');
  assert(result.recommendations.length > 0, 'Should have at least one recommendation');
});

test('analyzeAttention() handles string visitTime', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const records = [
    { visitTime: '2026-01-01T10:00:00', duration: 100, category: 'coding' }
  ];
  const result = analyzer.analyzeAttention(records);
  assert(result.hourlyFocus[10].totalDuration > 0, 'Should parse string visitTime');
});

test('analyzeAttention() skips invalid visitTime', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const records = [
    { visitTime: null, duration: 100, category: 'coding' },
    { visitTime: 'not-a-date', duration: 100, category: 'coding' },
    { visitTime: new Date('2026-01-01T10:00:00').getTime(), duration: 100, category: 'coding' }
  ];
  const result = analyzer.analyzeAttention(records);
  assertEqual(result.hourlyFocus[10].totalDuration, 100, 'Should only count valid records');
});

test('_formatTimeRanges() formats consecutive hours', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const result = analyzer._formatTimeRanges([9, 10, 11, 14, 15]);
  assertEqual(result, '9:00-12:00、14:00-16:00', 'Should format ranges correctly');
});

test('_formatTimeRanges() handles single hour', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const result = analyzer._formatTimeRanges([10]);
  assertEqual(result, '10:00-11:00', 'Single hour should be 10:00-11:00');
});

test('_formatTimeRanges() handles empty input', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const result = analyzer._formatTimeRanges([]);
  assertEqual(result, '', 'Empty hours should return empty string');
});

test('_generateRecommendations() includes morning check', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  // Create low-scoring morning records (entertainment heavy)
  const hourlyFocus = Array(24).fill(null).map((_, hour) => ({
    hour, score: hour >= 6 && hour <= 11 ? 20 : 80,
    totalDuration: hour >= 6 && hour <= 11 ? 100 : 0,
    focusDuration: 0, entertainmentDuration: hour >= 6 && hour <= 11 ? 100 : 0
  }));
  const recs = analyzer._generateRecommendations([], [], hourlyFocus);
  assert(recs.some(r => r.includes('早晨')), 'Should mention morning efficiency');
});

test('analyzeAll() combines blackhole and attention analysis', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const records = [
    { domain: 'youtube.com', category: 'entertainment', duration: 2000, visitTime: Date.now(), date: '2026-01-01', url: 'https://youtube.com' }
  ];
  const result = analyzer.analyzeAll(records);
  assert(result.blackholes, 'Should have blackholes');
  assert(result.attentionCurve, 'Should have attentionCurve');
});

test('analyzeAll() uses threshold parameter correctly', () => {
  const analyzer = new dpContext.LocalAdvancedAnalyzer(30);
  const records = [
    { domain: 'youtube.com', category: 'entertainment', duration: 500, visitTime: Date.now(), date: '2026-01-01', url: 'https://youtube.com' }
  ];
  // With 5 min threshold, 500s should be a long session
  const result = analyzer.analyzeAll(records, 5);
  assert(result.blackholes.blackholes.length > 0, '5 min threshold should detect 500s as blackhole');
});

// ==================== Background.js Utility Tests ====================
console.log('\n=== Background.js Utilities ===');

test('recordKey() creates consistent keys', () => {
  const key1 = bgContext.recordKey({ url: 'https://example.com', visitTime: 10000 });
  const key2 = bgContext.recordKey({ url: 'https://example.com', visitTime: 10000 });
  assertEqual(key1, key2, 'Same input should produce same key');
});

test('recordKey() buckets within 5 second window', () => {
  const key1 = bgContext.recordKey({ url: 'https://example.com', visitTime: 10000 });
  const key2 = bgContext.recordKey({ url: 'https://example.com', visitTime: 14999 });
  assertEqual(key1, key2, 'Within 5s window should produce same key');
});

test('recordKey() separates different windows', () => {
  const key1 = bgContext.recordKey({ url: 'https://example.com', visitTime: 9999 });
  const key2 = bgContext.recordKey({ url: 'https://example.com', visitTime: 10000 });
  assert(key1 !== key2, 'Different 5s windows should produce different keys');
});

test('recordKey() separates different URLs', () => {
  const key1 = bgContext.recordKey({ url: 'https://a.com', visitTime: 10000 });
  const key2 = bgContext.recordKey({ url: 'https://b.com', visitTime: 10000 });
  assert(key1 !== key2, 'Different URLs should produce different keys');
});

test('parseListString() parses comma-separated domains', () => {
  const result = bgContext.parseListString('github.com,youtube.com, twitter.com');
  assertDeepEqual(result, ['github.com', 'youtube.com', 'twitter.com'], 'Should parse comma-separated');
});

test('parseListString() strips wildcard prefix', () => {
  const result = bgContext.parseListString('*.github.com,*.youtube.com');
  assertDeepEqual(result, ['github.com', 'youtube.com'], 'Should strip *. prefix');
});

test('parseListString() lowercases domains', () => {
  const result = bgContext.parseListString('GitHub.COM,YouTube.COM');
  assertDeepEqual(result, ['github.com', 'youtube.com'], 'Should lowercase');
});

test('parseListString() handles Chinese comma', () => {
  const result = bgContext.parseListString('github.com，youtube.com');
  assertDeepEqual(result, ['github.com', 'youtube.com'], 'Should handle Chinese comma');
});

test('parseListString() handles newline separated', () => {
  const result = bgContext.parseListString('github.com\nyoutube.com\r\ntwitter.com');
  assertDeepEqual(result, ['github.com', 'youtube.com', 'twitter.com'], 'Should handle newlines');
});

test('parseListString() handles empty/null input', () => {
  assertDeepEqual(bgContext.parseListString(''), [], 'Empty string should return []');
  assertDeepEqual(bgContext.parseListString(null), [], 'null should return []');
  assertDeepEqual(bgContext.parseListString(undefined), [], 'undefined should return []');
});

test('isInQuietHours() returns false for empty preferences', () => {
  assertEqual(bgContext.isInQuietHours({}), false, 'Empty prefs should return false');
  assertEqual(bgContext.isInQuietHours({ quietHoursStart: '', quietHoursEnd: '' }), false, 'Empty strings should return false');
  assertEqual(bgContext.isInQuietHours({ quietHoursStart: '23:00', quietHoursEnd: '' }), false, 'Missing end should return false');
});

test('isInQuietHours() handles same-day range', () => {
  // Mock Date to return 10:30
  const origDate = bgSandbox.Date;
  bgSandbox.Date = function(...args) {
    if (args.length === 0) {
      const d = new origDate('2026-01-01T10:30:00');
      return d;
    }
    return new origDate(...args);
  };
  bgSandbox.Date.now = origDate.now;

  const result = bgContext.isInQuietHours({ quietHoursStart: '9:00', quietHoursEnd: '17:00' });
  assertEqual(result, true, '10:30 should be within 9:00-17:00');

  bgSandbox.Date = origDate;
});

test('isInQuietHours() handles midnight-crossing range', () => {
  const origDate = bgSandbox.Date;
  bgSandbox.Date = function(...args) {
    if (args.length === 0) {
      const d = new origDate('2026-01-01T01:00:00');
      return d;
    }
    return new origDate(...args);
  };
  bgSandbox.Date.now = origDate.now;

  const result = bgContext.isInQuietHours({ quietHoursStart: '23:00', quietHoursEnd: '7:00' });
  assertEqual(result, true, '01:00 should be within 23:00-7:00 (cross midnight)');

  bgSandbox.Date = origDate;
});

// ==================== Results ====================
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
}
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
