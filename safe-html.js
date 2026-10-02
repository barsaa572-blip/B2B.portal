// Sanitize dynamic HTML; allow only same-origin blob iframe previews.
(() => {
  const purifier = globalThis.DOMPurify;
  if (!purifier?.isSupported) {
    throw new Error('A supported browser is required.');
  }

  const isLocalBlob = value => {
    if (typeof value !== 'string' || location.origin === 'null') {
      return false;
    }
    const prefix = `blob:${location.origin}/`;
    return value.startsWith(prefix) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(value.slice(prefix.length));
  };

  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    if (node.tagName !== 'IFRAME' || data.attrName !== 'src') return;

    if (isLocalBlob(data.attrValue)) {
      data.forceKeepAttr = true;
    } else {
      data.keepAttr = false;
    }
  });

  purifier.addHook('afterSanitizeAttributes', node => {
    if (node.tagName !== 'IFRAME') return;

    if (!isLocalBlob(node.getAttribute('src'))) {
      node.removeAttribute('src');
    }
    node.removeAttribute('srcdoc');
    node.setAttribute('sandbox', 'allow-same-origin');
  });

  globalThis.safeHtml = value => purifier.sanitize(String(value ?? ''), {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['iframe'],
    FORBID_TAGS: ['script', 'object', 'embed', 'style', 'link', 'base', 'meta'],
    FORBID_ATTR: ['srcdoc'],
    ALLOW_UNKNOWN_PROTOCOLS: false
  });
})();