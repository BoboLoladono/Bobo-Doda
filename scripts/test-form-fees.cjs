/** SSR semantic checks and immutable fee regression; no external services. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { test } = require('node:test');
function load(filename) {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  const compiled = {exports:{}};
  const imports = name => {
    if (name === '@/lib/i18n') return {useT:() => ({t:key => key})};
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.tsx`));
    return require(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {})(imports,compiled,compiled.exports);
  return compiled.exports;
}
for (const name of ['Input','Select','Textarea','PasswordInput']) {
  test(`${name} composes caller and generated error descriptions`, () => {
    const component = load(`components/ui/${name}.tsx`)[name];
    const html = renderToStaticMarkup(React.createElement(component, {
      id:'field', label:'Field', error:'Invalid', 'aria-describedby':'instructions',
      ...(name === 'Select' ? {options:[]} : {}),
    }));
    assert.match(html,/aria-describedby="instructions field-msg"/);
    assert.match(html,/id="field-msg"/);
    assert.match(html,/role="alert"/);
  });
}
test('immutable fee snapshot controls historical net and fee rounding', () => {
  const {sellerNet,platformFee,getPlatformFeePercent} = load('lib/fees.ts');
  assert.equal(sellerNet(1000,250),975);
  assert.equal(platformFee(1001,500),50.05);
  assert.equal(sellerNet(1000,0),1000);
  assert.equal(getPlatformFeePercent(),5);
});
