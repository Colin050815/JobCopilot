(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JobDetailPopupCapture = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  // This function is deliberately self-contained because Chrome serializes it
  // into the BOSS page's MAIN world through chrome.scripting.executeScript.
  async function captureJobDetailUrlInPage() {
    const root = document.querySelector('.chat-conversation') || document;
    const selectors = [
      '.chat-position-content .position-content .right-content',
      '.chat-position-content .position-content',
      '[ka="geek_chat_job_detail"]'
    ];
    const trigger = selectors
      .map(selector => root.querySelector(selector))
      .find(element => element && (element.offsetParent !== null || getComputedStyle(element).position === 'fixed'));
    if (!trigger) return { triggerFound: false, url: '', source: '' };

    const candidateNodes = [
      trigger,
      trigger.closest('[ka="geek_chat_job_detail"]'),
      trigger.closest('.position-content'),
      trigger.closest('.chat-position-content')
    ].filter(Boolean);
    for (const node of candidateNodes) {
      for (const attribute of Array.from(node.attributes || [])) {
        const value = String(attribute.value || '');
        if (value.includes('/job_detail/')) {
          return { triggerFound: true, url: value, source: 'attribute:' + attribute.name };
        }
      }
      const link = node.matches && node.matches('a[href]') ? node : node.querySelector && node.querySelector('a[href]');
      if (link && link.href && link.href.includes('/job_detail/')) {
        return { triggerFound: true, url: link.href, source: 'nested-link' };
      }
    }

    let capturedUrl = '';
    const originalOpen = window.open;
    let replacedOpen = false;
    try {
      window.open = function (url) {
        capturedUrl = String(url || '');
        return {
          closed: false,
          focus() {},
          close() {},
          postMessage() {},
          location: { href: capturedUrl }
        };
      };
      replacedOpen = window.open !== originalOpen;
      trigger.click();
      await new Promise(resolve => setTimeout(resolve, 1200));
    } catch (error) {
      // The targeted active-job component fallback below remains available.
    } finally {
      if (replacedOpen) window.open = originalOpen;
    }
    if (capturedUrl) {
      return { triggerFound: true, url: capturedUrl, source: 'window.open' };
    }

    const roots = [];
    for (const node of candidateNodes) {
      if (node.__vue__) {
        roots.push(node.__vue__._data, node.__vue__.$data, node.__vue__.$props);
      }
      if (node.__vueParentComponent) {
        const component = node.__vueParentComponent;
        roots.push(component.props, component.setupState, component.data, component.ctx);
      }
    }
    const seen = new WeakSet();
    let visited = 0;
    let jobId = '';
    function visit(value, depth) {
      if (jobId || !value || typeof value !== 'object' || depth > 6 || visited > 500) return;
      if (seen.has(value)) return;
      seen.add(value);
      visited++;
      for (const key of Object.keys(value)) {
        let child;
        try { child = value[key]; } catch (error) { continue; }
        const keyName = String(key).toLowerCase();
        if (
          (keyName === 'encryptjobid' || keyName === 'jobid' || keyName === 'encryptjobidstr') &&
          typeof child === 'string' &&
          /^[A-Za-z0-9_~.-]{8,}$/.test(child)
        ) {
          jobId = child;
          return;
        }
        if (child && typeof child === 'object' && !(child instanceof Node)) {
          visit(child, depth + 1);
        }
        if (jobId) return;
      }
    }
    roots.filter(Boolean).forEach(rootValue => visit(rootValue, 0));
    return {
      triggerFound: true,
      url: jobId ? (location.origin + '/job_detail/' + encodeURIComponent(jobId) + '.html') : '',
      source: jobId ? 'active-job-component' : ''
    };
  }

  return Object.freeze({
    captureJobDetailUrlInPage: captureJobDetailUrlInPage
  });
});
