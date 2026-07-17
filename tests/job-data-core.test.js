const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasPrivateUseCharacters,
  readableSalary,
  normalizeArea,
  parseApiJob,
  extractApiJobs,
  buildSearchParams,
  mergeJobs
} = require('../JobCopilot · AI/src/job-data-core.js');

test('detects BOSS private-use salary glyphs and never displays them as boxes', () => {
  assert.equal(hasPrivateUseCharacters('\uE031\uE035-\uE032\uE030K'), true);
  assert.equal(readableSalary('\uE031\uE035-\uE032\uE030K'), '');
  assert.equal(readableSalary('15-20K·14薪'), '15-20K·14薪');
});

test('normalizes BOSS API jobs with company, salary, and full area', () => {
  const job = parseApiJob({
    encryptJobId: 'abc123',
    securityId: 'security',
    jobName: 'AI Agent 工程师',
    salaryDesc: '20-35K·15薪',
    brandName: '示例科技',
    cityName: '北京',
    areaDistrict: '海淀区',
    businessDistrict: '西二旗',
    jobLabels: ['1-3年', '本科'],
    skills: ['Python', 'RAG']
  }, 'https://www.zhipin.com');

  assert.deepEqual(job, {
    id: 'abc123',
    name: 'AI Agent 工程师',
    salary: '20-35K·15薪',
    company: '示例科技',
    area: '北京·海淀区·西二旗',
    tags: ['1-3年', '本科', 'Python', 'RAG'],
    link: 'https://www.zhipin.com/job_detail/abc123.html',
    securityId: 'security',
    lid: ''
  });
});

test('uses a readable location fallback when structured BOSS area fields are absent', () => {
  assert.equal(normalizeArea({ locationName: '上海·浦东新区·张江' }), '上海·浦东新区·张江');
});

test('extracts jobs from the BOSS zpData response envelope', () => {
  const jobs = extractApiJobs({
    code: 0,
    zpData: {
      jobList: [{ encryptJobId: 'one', jobName: '后端实习生', salaryDesc: '200-300元/天' }]
    }
  }, 'https://www.zhipin.com');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].salary, '200-300元/天');
});

test('builds a same-search API query while preserving keyword and city', () => {
  const params = new URLSearchParams(buildSearchParams('?query=AI+Agent&city=101010100', 2, 80));
  assert.equal(params.get('query'), 'AI Agent');
  assert.equal(params.get('city'), '101010100');
  assert.equal(params.get('scene'), '1');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('pageSize'), '30');
  assert.equal(params.get('salary'), '');
});

test('merges API fields into the matching DOM card and keeps DOM delivery identity', () => {
  const domJobs = [{
    id: 'abc123',
    name: 'AI Agent 工程师',
    salaryRaw: '\uE032\uE030-\uE033\uE035K',
    salaryObfuscated: true,
    company: '',
    area: '',
    tags: ['实习'],
    link: 'https://www.zhipin.com/job_detail/abc123.html'
  }];
  const apiJobs = [{
    id: 'abc123',
    name: 'AI Agent 工程师',
    salary: '20-35K',
    company: '示例科技',
    area: '北京·海淀区·西二旗',
    tags: ['本科']
  }];
  const merged = mergeJobs(domJobs, apiJobs, 20);
  assert.equal(merged[0].id, 'abc123');
  assert.equal(merged[0].salary, '20-35K');
  assert.equal(merged[0].company, '示例科技');
  assert.equal(merged[0].area, '北京·海淀区·西二旗');
  assert.deepEqual(merged[0].tags, ['本科', '实习']);
  assert.equal(merged[0].salaryUnavailable, false);
});

test('marks encoded DOM salary unavailable when the BOSS API cannot enrich it', () => {
  const [job] = mergeJobs([{
    id: 'fallback',
    name: '测试岗位',
    salaryRaw: '\uE031\uE035-\uE032\uE030K',
    salaryObfuscated: true
  }], [], 1);
  assert.equal(job.salary, '');
  assert.equal(job.salaryUnavailable, true);
});
