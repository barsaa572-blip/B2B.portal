export function environmentPage(content, environment) {
  if (environment !== 'staging') return content;
  return String(content)
    .replace('<html lang="en">', '<html lang="en" data-environment="staging">')
    .replace('<title>NEXAHUB</title>', '<title>[TEST] NEXAHUB</title>')
    .replace('</head>', '<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/staging.css?v=20260923"></head>')
    .replace('<body>', '<body><div class="staging-banner" role="status">TEST ENVIRONMENT · Туршилтын орчин</div>');
}
