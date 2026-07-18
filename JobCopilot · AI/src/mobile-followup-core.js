(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MobileFollowupCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function localDateKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function clockMinutes(value) {
    const match = cleanText(value).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return -1;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return -1;
    return hours * 60 + minutes;
  }

  function parseConversationDateTime(timeText, now) {
    const text = cleanText(timeText);
    const clock = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
    if (!clock) return null;
    const minutes = clockMinutes(clock[1] + ':' + clock[2]);
    if (minutes < 0) return null;

    now = now instanceof Date ? now : new Date();
    let date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fullDate = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
    const shortDate = text.match(/(?:^|\s)(\d{1,2})[-/.](\d{1,2})(?:\s|$)/);
    const chineseDate = text.match(/(\d{1,2})月(\d{1,2})日/);
    if (fullDate) {
      date = new Date(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]));
    } else if (chineseDate) {
      date = new Date(now.getFullYear(), Number(chineseDate[1]) - 1, Number(chineseDate[2]));
    } else if (shortDate) {
      date = new Date(now.getFullYear(), Number(shortDate[1]) - 1, Number(shortDate[2]));
    } else if (text.includes('昨天')) {
      date.setDate(date.getDate() - 1);
    }
    return {
      date: localDateKey(date),
      minutes: minutes,
      clock: pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60)
    };
  }

  function validateRange(params) {
    params = params || {};
    const date = cleanText(params.date);
    const start = clockMinutes(params.start);
    const end = clockMinutes(params.end);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: '请选择有效日期' };
    }
    const parts = date.split('-').map(Number);
    const parsedDate = new Date(parts[0], parts[1] - 1, parts[2]);
    if (
      parsedDate.getFullYear() !== parts[0] ||
      parsedDate.getMonth() !== parts[1] - 1 ||
      parsedDate.getDate() !== parts[2]
    ) {
      return { ok: false, error: '请选择有效日期' };
    }
    if (start < 0 || end < 0) {
      return { ok: false, error: '请输入有效的开始和结束时间' };
    }
    if (end < start) {
      return { ok: false, error: '结束时间不能早于开始时间' };
    }
    if (end - start > 180) {
      return { ok: false, error: '单次扫描时间范围不能超过 3 小时' };
    }
    return { ok: true, date: date, start: start, end: end };
  }

  function isWithinRange(timeText, params, now) {
    const range = validateRange(params);
    if (!range.ok) return false;
    const parsed = parseConversationDateTime(timeText, now);
    return Boolean(
      parsed &&
      parsed.date === range.date &&
      parsed.minutes >= range.start &&
      parsed.minutes <= range.end
    );
  }

  function isLikelyGenericIntro(preview) {
    const text = cleanText(preview);
    if (!text || !text.includes('[送达]')) return false;
    return /您好[，,]?\s*我是|我叫|希望有机会|对(?:贵公司|这个岗位|该岗位).*感兴趣/.test(text);
  }

  function filterCandidates(conversations, params, now) {
    return (conversations || []).filter(function (conversation) {
      return isWithinRange(conversation.timeText, params, now) &&
        isLikelyGenericIntro(conversation.preview);
    });
  }

  function validateDraftSelection(selected, candidates, sent, generatedDrafts) {
    const candidateMap = new Map((candidates || []).map(function (item) {
      return [cleanText(item && item.id), item];
    }).filter(function (entry) {
      return Boolean(entry[0]);
    }));
    const eligibleIds = generatedDrafts
      ? new Set((generatedDrafts || []).filter(function (item) {
        return item && item.text && !item.error;
      }).map(function (item) {
        return cleanText(item.id);
      }).filter(Boolean))
      : null;
    const seen = new Set();
    const drafts = [];
    for (const item of selected || []) {
      const id = cleanText(item && item.id);
      const text = cleanText(item && item.text);
      const candidate = candidateMap.get(id);
      if (!id || !candidate) {
        return { ok: false, error: '补充消息与本次扫描会话不一致', drafts: [] };
      }
      if (candidate.scanError || !candidate.jobUrl) {
        return { ok: false, error: '所选会话缺少可核验的岗位详情，已阻止发送', drafts: [] };
      }
      if (eligibleIds && !eligibleIds.has(id)) {
        return { ok: false, error: '所选会话没有可审核的已生成草稿，已阻止发送', drafts: [] };
      }
      if (seen.has(id)) {
        return { ok: false, error: '检测到重复会话，已阻止发送', drafts: [] };
      }
      if (sent && sent[id]) {
        return { ok: false, error: '所选会话中包含已发送或状态待确认的记录', drafts: [] };
      }
      if (text.length < 15 || text.length > 350) {
        return { ok: false, error: '每条补充介绍需为 15–350 个字符', drafts: [] };
      }
      seen.add(id);
      drafts.push({ id: id, text: text });
    }
    if (!drafts.length) return { ok: false, error: '请至少选择一条补充介绍', drafts: [] };
    return { ok: true, error: '', drafts: drafts };
  }

  return Object.freeze({
    cleanText: cleanText,
    localDateKey: localDateKey,
    clockMinutes: clockMinutes,
    parseConversationDateTime: parseConversationDateTime,
    validateRange: validateRange,
    isWithinRange: isWithinRange,
    isLikelyGenericIntro: isLikelyGenericIntro,
    filterCandidates: filterCandidates,
    validateDraftSelection: validateDraftSelection
  });
});
