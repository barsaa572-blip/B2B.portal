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

  const options = {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['iframe'],
    FORBID_TAGS: ['script', 'object', 'embed', 'style', 'link', 'base', 'meta'],
    FORBID_ATTR: ['srcdoc'],
    ALLOW_UNKNOWN_PROTOCOLS: false
  };

  globalThis.safeHtml = value => {
    const markup = String(value ?? '');
    // HTML's document parser drops bare tr/td tags. Sanitize row fragments in
    // their table context, then return only the sanitized rows to tbody sinks.
    if (/^\s*<tr(?:\s|>)/i.test(markup)) {
      const fragment = purifier.sanitize(`<table><tbody>${markup}</tbody></table>`, {
        ...options, RETURN_DOM_FRAGMENT: true
      });
      return fragment.querySelector('table > tbody')?.innerHTML || '';
    }
    return purifier.sanitize(markup, options);
  };
})();
