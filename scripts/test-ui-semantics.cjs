/** Render real shared UI without browser/network to verify semantic output. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { test } = require('node:test');
const source = ts.transpileModule(fs.readFileSync('components/ui/Tabs.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = { exports: {} };
vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {})(require, compiled, compiled.exports);
const { Tabs } = compiled.exports;
const props = { items: [{value:'one',label:'First'}, {value:'two',label:'Second'}], value:'one', onChange: () => {} };
test('filters expose pressed buttons without orphaned tab semantics', () => {
  const html = renderToStaticMarkup(React.createElement(Tabs, props));
  assert.match(html, /role="group"/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /role="tab"|aria-selected|aria-controls/);
});
test('panel-backed tabs expose stable identities and controls', () => {
  const html = renderToStaticMarkup(React.createElement(Tabs, {...props, panelId:'results', idPrefix:'test'}));
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="test-tab-one"/);
  assert.match(html, /aria-controls="results"/);
  assert.match(html, /aria-selected="true"/);
});
test('an unavailable selected filter still has a keyboard entry point', () => {
  const html = renderToStaticMarkup(React.createElement(Tabs, {...props, value:'missing'}));
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
});
