// 生成待测试的 MathML 候选文件到 .tmp-e2e/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
globalThis.window = globalThis;
new Function('window', readFileSync('assets/js/convert.js', 'utf8'))(globalThis.window);
const temml = createRequire(import.meta.url)('temml');
const sanitize = window.EQ.convert.sanitizeMathMLForWord;

mkdirSync('.tmp-e2e', { recursive: true });

const cases = {
  'trivial': '<math><mi>x</mi></math>',
  'formula9': 'R_{i,a,t} = \\frac{C_{i,a,t}}{Q_{i,t}^{0}} \\times 100\\%, \\quad W_{i,a,t} = \\frac{\\left| C_{i,a,t} \\right|}{\\sum_{i \\in \\mathcal{A}} \\left| C_{i,a,t} \\right|} \\times 100\\%',
  'formula10': 'Q_{i,t} - Q_{i,t}^{0} = \\sum_{k \\in \\mathcal{K}} C_{i,k,k} + C_{i,t}^{\\text{int}} + R_{i,t}^{\\text{nn}}, \\qquad R_{i,t}^{\\text{nn}} = Q_{i,t} - F_{i,t}(\\mathcal{K})',
  'cases': 'C_{C} = f(\\bar{P}_{C,j}, Q_{C,j}, T_{mn}) \\cdot q_{L} \\cdot \\frac{44}{12}, \\quad \\text{st.} \\begin{cases} f_{b1}(Q_{C,j}) \\leq \\bar{P}_{C,j} \\\\ 0 \\leq Q_{C,j} \\leq h_{mx} \\end{cases}'
};

for (const [name, tex] of Object.entries(cases)) {
  const mml = name === 'trivial' ? tex : temml.renderToString(tex, { display: 'block' });
  const out = sanitize(mml);
  writeFileSync(`.tmp-e2e/${name}.mml`, out, 'utf8');
  console.log(name, '->', out.length, 'chars');
}
console.log('raw formula9 (未净化) 备用：');
writeFileSync('.tmp-e2e/formula9-raw.mml', temml.renderToString(cases.formula9, { display: 'block' }), 'utf8');
