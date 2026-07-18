const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseConversationDateTime,
  validateRange,
  isWithinRange,
  hasDeliveredMarker,
  isGenericIntroText,
  isLikelyGenericIntro,
  confirmOutgoingGenericIntro,
  normalizeJobDetailUrl,
  filterCandidates,
  validateDraftSelection
} = require('../JobCopilot · AI/src/mobile-followup-core.js');

const now = new Date(2026, 6, 18, 23, 0, 0);

test('parses today, yesterday, and explicit BOSS conversation timestamps', () => {
  assert.deepEqual(parseConversationDateTime('22:37', now), {
    date: '2026-07-18',
    minutes: 22 * 60 + 37,
    clock: '22:37'
  });
  assert.equal(parseConversationDateTime('昨天 22:37', now).date, '2026-07-17');
  assert.equal(parseConversationDateTime('07-18 22:38', now).date, '2026-07-18');
  assert.equal(parseConversationDateTime('2026-07-18 22:38', now).date, '2026-07-18');
});

test('validates a bounded same-day scan range', () => {
  assert.equal(validateRange({ date: '2026-07-18', start: '22:33', end: '22:38' }).ok, true);
  assert.equal(validateRange({ date: '2026-02-30', start: '22:33', end: '22:38' }).ok, false);
  assert.equal(validateRange({ date: '2026-07-18', start: '23:00', end: '22:00' }).ok, false);
  assert.equal(validateRange({ date: '2026-07-18', start: '18:00', end: '22:00' }).ok, false);
});

test('matches only messages inside the requested date and minute range', () => {
  const params = { date: '2026-07-18', start: '22:33', end: '22:38' };
  assert.equal(isWithinRange('22:33', params, now), true);
  assert.equal(isWithinRange('22:38', params, now), true);
  assert.equal(isWithinRange('22:39', params, now), false);
  assert.equal(isWithinRange('昨天 22:37', params, now), false);
});

test('recognizes delivered generic introductions and excludes unrelated previews', () => {
  assert.equal(hasDeliveredMarker('[送达]您好，我是重庆大学本科生'), true);
  assert.equal(hasDeliveredMarker('您好，我是重庆大学本科生'), false);
  assert.equal(isGenericIntroText('您好，我是重庆大学本科生，对该岗位很感兴趣'), true);
  assert.equal(isLikelyGenericIntro('[送达]您好，我是重庆大学本科生，对该岗位很感兴趣'), true);
  assert.equal(isLikelyGenericIntro('您好，我是重庆大学本科生，对该岗位很感兴趣'), false);
  assert.equal(isLikelyGenericIntro('HR：方便明天沟通吗？'), false);
  assert.equal(isLikelyGenericIntro('[送达]这是根据 JD 写的项目补充说明'), false);
});

test('confirms split BOSS delivery previews against a recent self-sent message', () => {
  const preview = '您好，我是重庆大学本科生，可以做 AI Agent…';
  assert.equal(confirmOutgoingGenericIntro(preview, [
    { text: '您好，我是重庆大学本科生，可以做 AI Agent 和 RAG 项目，希望有机会沟通。' }
  ]), true);
  assert.equal(confirmOutgoingGenericIntro(preview, [
    { text: '您好，请问你什么时候方便面试？' }
  ]), false);
  assert.equal(confirmOutgoingGenericIntro('[送达]您好，我是重庆大学本科生', []), true);
});

test('accepts only exact BOSS job-detail URLs', () => {
  assert.equal(
    normalizeJobDetailUrl('/job_detail/abc123XYZ.html'),
    'https://www.zhipin.com/job_detail/abc123XYZ.html'
  );
  assert.equal(
    normalizeJobDetailUrl('https://www.zhipin.com/job_detail/abc123XYZ.html?lid=source#top'),
    'https://www.zhipin.com/job_detail/abc123XYZ.html?lid=source'
  );
  assert.equal(normalizeJobDetailUrl('https://example.com/job_detail/abc123XYZ.html'), '');
  assert.equal(normalizeJobDetailUrl('https://www.zhipin.com/web/geek/chat'), '');
});

test('filters the mobile application batch by time and generic greeting preview', () => {
  const results = filterCandidates([
    { id: 'one', timeText: '22:37', preview: '[送达]您好，我是重庆大学本科生' },
    { id: 'split-status', timeText: '22:35', preview: '您好，我是重庆大学本科生' },
    { id: 'two', timeText: '22:40', preview: '[送达]您好，我是重庆大学本科生' },
    { id: 'three', timeText: '22:36', preview: 'HR：你好' }
  ], { date: '2026-07-18', start: '22:33', end: '22:38' }, now);
  assert.deepEqual(results.map(item => item.id), ['one', 'split-status']);
});

test('validates exact, unique, unsent follow-up drafts', () => {
  const candidates = [
    { id: 'one', jobUrl: 'https://www.zhipin.com/job_detail/one.html' },
    { id: 'two', jobUrl: 'https://www.zhipin.com/job_detail/two.html' }
  ];
  const generated = [
    { id: 'one', text: '已生成的一号补充介绍', error: '' },
    { id: 'two', text: '已生成的二号补充介绍', error: '' }
  ];
  const valid = validateDraftSelection([
    { id: 'one', text: '我补充做过 RAG 检索和 Agent 工具调用项目，与岗位职责高度相关。' }
  ], candidates, {}, generated);
  assert.equal(valid.ok, true);
  assert.equal(validateDraftSelection([
    { id: 'one', text: '内容足够长，适合作为补充介绍消息。' },
    { id: 'one', text: '另一条重复的补充介绍消息内容。' }
  ], candidates, {}, generated).ok, false);
  assert.equal(validateDraftSelection([
    { id: 'two', text: '我有相关项目实践，希望进一步沟通岗位要求和团队方向。' }
  ], candidates, { two: 1 }, generated).ok, false);
  assert.equal(validateDraftSelection([
    { id: 'missing-link', text: '这条消息不应发送，因为缺少可核验的岗位详情链接。' }
  ], [{ id: 'missing-link', jobUrl: '' }], {}, [
    { id: 'missing-link', text: '已生成但不可发送', error: '' }
  ]).ok, false);
  assert.equal(validateDraftSelection([
    { id: 'two', text: '这条消息不应发送，因为没有一条可审核的生成草稿。' }
  ], candidates, {}, [
    { id: 'two', text: '', error: '岗位详情读取失败' }
  ]).ok, false);
});
