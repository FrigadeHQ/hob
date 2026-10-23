const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

// Reuse the app's installed toolchain; only the preview's UI components ship.
const appRequire = createRequire(path.resolve(process.argv[2] || path.join(__dirname, '../../app/package.json')));
const esbuild = appRequire('esbuild');
const { renderToStaticMarkup } = appRequire('react-dom/server');
const React = appRequire('react');
const { compile } = appRequire('@tailwindcss/node');
const { Scanner } = appRequire('@tailwindcss/oxide');
const here = __dirname;
const out = path.resolve(here, '../public/marketing/hero-app');

async function build() {
  const plugins = [{ name: 'preview-only', setup(build) {
    build.onResolve({ filter: /^(\.\.\/api|\.\/Preview|\.\/PdfView)$/ }, () => ({ path: path.join(here, 'preview-api.ts') }));
    build.onLoad({ filter: /hob-body\.png$/ }, args => ({ contents: fs.readFileSync(args.path), loader: 'dataurl' }));
    // The embedded demo must never steal keyboard focus from the marketing page.
    build.onLoad({ filter: /Composer\.tsx$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8').replace(/\s+autoFocus\n/, '\n'), loader: 'tsx' }));
    build.onLoad({ filter: /ChartCard\.tsx$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8').replace('<Bar key=', '<Bar isAnimationActive={!window.matchMedia("(prefers-reduced-motion: reduce)").matches} key='), loader: 'tsx' }));
  } }];
  const result = await esbuild.build({
    entryPoints: [path.join(here, 'Hero.tsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
    plugins,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(appRequire, module, module.exports);
  const markup = renderToStaticMarkup(React.createElement(module.exports.Hero)).replace(/ autofocus=""/g, '');
  assert(markup.includes('data-testid="sidebar"') && markup.includes('data-testid="composer-input"'));
  assert(!markup.includes('<script') && !markup.includes('autofocus'));
  const classes = new Scanner({ sources: [{ base: here, pattern: '**/*.{tsx,ts}', negated: false }] }).scan();
  const styles = fs.readFileSync(path.join(here, 'upstream/app/src/renderer/src/styles.css'), 'utf8');
  const lightTokens = styles.match(/@theme\s*\{([\s\S]*?)\n\}/)[1];
  // A private Site cannot authenticate asset requests from the opaque-origin sandbox; embed every dependency.
  const font = fs.readFileSync(path.resolve(here, '../public/marketing/fonts/hanken-grotesk.ttf')).toString('base64');
  const cssInput = styles.replace('"./assets/hanken-grotesk.ttf"', `"data:font/ttf;base64,${font}"`);
  const compiler = await compile(cssInput, {
    base: path.dirname(appRequire.resolve('tailwindcss/package.json')),
    onDependency() {}, shouldRewriteUrls: false,
    customCssResolver: async id => id === 'tailwindcss' ? path.join(path.dirname(appRequire.resolve('tailwindcss/package.json')), 'index.css') : undefined,
    customJsResolver: async id => appRequire.resolve(id),
  });
  const css = compiler.build(classes) + `\n:root {${lightTokens}\ncolor-scheme:light; }\n` + fs.readFileSync(path.join(here, 'demo.css'), 'utf8');
  fs.mkdirSync(out, { recursive: true });
  const source = JSON.parse(fs.readFileSync(path.join(here, 'source.json'), 'utf8'));
  const client = await esbuild.build({
    entryPoints: [path.join(here, 'Demo.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [path.dirname(appRequire.resolve('react/package.json')).replace(/\/react$/, '')], plugins,
    legalComments: 'inline',
  });
  const script = client.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>\n<!-- Hob UI source: ${source.repository}/tree/${source.commit}. Scripted chart example; no Electron services. -->\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Hob chart demo</title><style>${css}</style></head><body><div id="preview">${markup}</div><script>${script}</script></body></html>\n`);
  fs.copyFileSync(path.join(here, 'upstream/LICENSE'), path.join(out, 'LICENSE.txt'));
  console.log(`Built Hob demo from ${source.commit.slice(0, 7)}: ${markup.length} bytes of HTML, ${css.length} bytes of CSS.`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
