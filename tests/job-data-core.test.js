const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasPrivateUseCharacters,
  readableSalary,
  normalizeArea,
  parseApiJob,
  extractApiJobs,
  buildSearchParams,
  parseCityNames,
  resolveCitySearches,
  allocateCityTargets,
  mergeCityJobResults,
  mergeJobs,
  prepareDeliveryBatch,
  createDeliveryGate
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

test('parses, normalizes, and deduplicates multiple city names', () => {
  assert.deepEqual(
    parseCityNames('成都市 / 重庆，成都; 北京市'),
    ['成都', '重庆', '北京']
  );
});

test('resolves every valid city and reports unknown city names', () => {
  const resolved = resolveCitySearches('成都 / 不存在 / 重庆', {
    '全国': '100010000',
    '成都': '101270100',
    '重庆': '101040100'
  });
  assert.deepEqual(resolved.cities, [
    { name: '成都', code: '101270100' },
    { name: '重庆', code: '101040100' }
  ]);
  assert.deepEqual(resolved.unknown, ['不存在']);
  assert.equal(resolved.usedFallback, false);
});

test('understands natural Chinese connectors between known cities', () => {
  const cityMap = {
    '全国': '100010000',
    '成都': '101270100',
    '重庆': '101040100'
  };
  assert.deepEqual(
    resolveCitySearches('成都跟重庆', cityMap).cities.map(city => city.name),
    ['成都', '重庆']
  );
  assert.deepEqual(
    resolveCitySearches('成都和重庆', cityMap).cities.map(city => city.name),
    ['成都', '重庆']
  );
});

test('falls back to nationwide search only when no requested city is recognized', () => {
  const resolved = resolveCitySearches('火星市', { '全国': '100010000' });
  assert.deepEqual(resolved.cities, [{ name: '全国', code: '100010000' }]);
  assert.deepEqual(resolved.unknown, ['火星']);
  assert.equal(resolved.usedFallback, true);
});

test('allocates the total target evenly and keeps at least one job per city', () => {
  assert.deepEqual(allocateCityTargets(2, 20), [10, 10]);
  assert.deepEqual(allocateCityTargets(2, 5), [3, 2]);
  assert.deepEqual(allocateCityTargets(2, 1), [1, 1]);
});

test('merges city results without duplicates and preserves each job search source', () => {
  const jobs = mergeCityJobResults([
    {
      cityName: '成都',
      cityCode: '101270100',
      searchUrl: 'https://www.zhipin.com/web/geek/jobs?city=101270100',
      jobs: [{ id: 'chengdu-one', name: 'AI 实习生' }, { id: 'duplicate', name: '后端实习生' }]
    },
    {
      cityName: '重庆',
      cityCode: '101040100',
      searchUrl: 'https://www.zhipin.com/web/geek/jobs?city=101040100',
      jobs: [{ id: 'duplicate', name: '后端实习生' }, { id: 'chongqing-one', name: 'Agent 实习生' }]
    }
  ], 20);
  assert.deepEqual(jobs.map(job => job.id), ['chengdu-one', 'duplicate', 'chongqing-one']);
  assert.equal(jobs[0].sourceCityName, '成都');
  assert.equal(jobs[2].sourceCityName, '重庆');
  assert.equal(jobs[2].area, '重庆');
  assert.match(jobs[2].sourceSearchUrl, /101040100/);
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

test('prepares exactly the unique AI-matched jobs requested by the review UI', () => {
  const jobs = [
    { id: 'one', name: '岗位一' },
    { id: 'two', name: '岗位二' },
    { id: 'three', name: '岗位三' }
  ];
  const screened = jobs.map(job => Object.assign({}, job, { match: true }));
  const batch = prepareDeliveryBatch(['one', 'three'], jobs, screened, {});
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.ids, ['one', 'three']);
  assert.deepEqual(batch.jobs.map(job => job.id), ['one', 'three']);
});

test('rejects the whole delivery when a requested job was not matched by AI', () => {
  const jobs = [{ id: 'matched' }, { id: 'skipped' }];
  const screened = [
    { id: 'matched', match: true },
    { id: 'skipped', match: false }
  ];
  const batch = prepareDeliveryBatch(['matched', 'skipped'], jobs, screened, {});
  assert.equal(batch.ok, false);
  assert.match(batch.error, /AI 未匹配/);
  assert.deepEqual(batch.jobs, []);
});

test('rejects duplicate, processed, or stale delivery selections instead of shrinking silently', () => {
  const jobs = [{ id: 'one' }];
  const screened = [{ id: 'one', match: true }];
  assert.equal(prepareDeliveryBatch(['one', 'one'], jobs, screened, {}).ok, false);
  assert.equal(prepareDeliveryBatch(['one'], jobs, screened, { one: 1 }).ok, false);
  assert.equal(prepareDeliveryBatch(['one'], jobs, screened, { one: 'uncertain' }).ok, false);
  assert.equal(prepareDeliveryBatch(['missing'], jobs, [{ id: 'missing', match: true }], {}).ok, false);
});

test('allows only one active delivery task until the gate is released', () => {
  const gate = createDeliveryGate();
  assert.equal(gate.tryStart(), true);
  assert.equal(gate.isActive(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  assert.equal(gate.isActive(), false);
  assert.equal(gate.tryStart(), true);
});
