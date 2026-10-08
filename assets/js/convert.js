/**
 * convert.js —— 公式格式转换核心
 * 负责：LaTeX 清洗、KaTeX 渲染、LaTeX → MathML（Temml）、LaTeX → Unicode 纯文本
 * 全局命名空间：window.EQ
 */
(function () {
  'use strict';
  window.EQ = window.EQ || {};

  /* ============================================================
   * 一、LaTeX 清洗：去掉外层定界符（$$...$$ / \[...\] / $...$ 等）
   * ============================================================ */
  function stripTexDelimiters(tex) {
    if (!tex) return '';
    let s = String(tex).trim();
    const pairs = [
      [/^\$\$(?:\s*)?([\s\S]*?)(?:\s*)?\$\$$/, '$1'],
      [/^\\\[(?:\s*)?([\s\S]*?)(?:\s*)?\\\]$/, '$1'],
      [/^\$(?:\s*)?([^]*?)(?:\s*)?\$$/, '$1'],
      [/^\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}$/, '$1'],
      [/^\\begin\{displaymath\}([\s\S]*?)\\end\{displaymath\}$/, '$1']
    ];
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 4) {
      changed = false;
      for (const [re, rep] of pairs) {
        if (re.test(s)) { s = s.replace(re, rep).trim(); changed = true; }
      }
    }
    return s.trim();
  }

  /* ============================================================
   * 二、KaTeX 渲染
   * ============================================================ */
  function renderTexToHtml(tex) {
    if (typeof katex === 'undefined') {
      return '<div class="render-fallback"></div>';
    }
    // 多个公式（空行分隔）逐个渲染
    const parts = String(tex || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
    const list = parts.length ? parts : [String(tex || '')];
    return list
      .map(t => {
        try {
          return katex.renderToString(t, {
            displayMode: true,
            throwOnError: false,
            strict: false,
            trust: true,
            macros: { '\\RR': '\\mathbb{R}' }
          });
        } catch (e) {
          console.error('[EQ] KaTeX 渲染失败:', e, t);
          return '<div class="render-error">公式渲染失败：' + escapeHtml(e.message || String(e)) + '</div>';
        }
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ============================================================
   * 三、LaTeX → MathML（用于 Word / MathType 粘贴）
   * ============================================================ */
  function texToMathML(tex) {
    // 注意：Temml 0.13.x 的 UMD 全局变量名为小写 temml
    const lib = window.Temml || window.temml;
    if (!lib) {
      throw new Error('MathML 引擎（Temml）未加载成功，请检查网络后刷新页面');
    }
    const clean = stripTexDelimiters(tex);
    if (!clean) throw new Error('公式内容为空');
    try {
      const mml = lib.renderToString(clean, { display: 'block' });
      if (!mml || mml.indexOf('<math') === -1) throw new Error('生成结果异常');
      return mml;
    } catch (e) {
      console.error('[EQ] Temml 转换失败:', e);
      throw new Error('LaTeX → MathML 转换失败：' + (e.message || e));
    }
  }

  /* ============================================================
   * 四、LaTeX → Unicode 纯文本
   * ============================================================ */

  // 无参数符号命令映射表
  const SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
    varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
    varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆',
    circ: '∘', bullet: '∙', cup: '∪', cap: '∩', uplus: '⊎',
    sqcap: '⊓', sqcup: '⊔', vee: '∨', wedge: '∧', setminus: '∖', diamond: '⋄',
    oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙',
    dagger: '†', ddagger: '‡', amalg: '⨿',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', equiv: '≡',
    sim: '∼', simeq: '≃', asymp: '≈', approx: '≈', cong: '≅', propto: '∝',
    subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', nsubseteq: '⊈',
    sqsubset: '⊏', sqsubseteq: '⊑', in: '∈', ni: '∋', notin: '∉',
    perp: '⊥', mid: '∣', parallel: '∥', angle: '∠', triangle: '△',
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
    rightarrow: '→', to: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
    longrightarrow: '⟶', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
    infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄',
    emptyset: '∅', varnothing: '∅', because: '∵', therefore: '∴',
    hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', wp: '℘',
    prime: '′', backslash: '\\', ldots: '…', cdots: '⋯', vdots: '⋮', dots: '…',
    langle: '〈', rangle: '〉', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
    surd: '√', top: '⊤', bot: '⊥', neg: '¬', land: '∧', lor: '∨',
    ointop: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
    smile: '⌣', frown: '⌢', models: '⊨', vDash: '⊨',
    sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc',
    log: 'log', ln: 'ln', lg: 'lg', exp: 'exp', max: 'max', min: 'min',
    arg: 'arg', det: 'det', dim: 'dim', gcd: 'gcd', deg: 'deg', hom: 'hom',
    ker: 'ker', lim: 'lim', limsup: 'lim sup', liminf: 'lim inf', Pr: 'Pr'
  };

  const BB_MAP = { R: 'ℝ', C: 'ℂ', N: 'ℕ', Q: 'ℚ', Z: 'ℤ', P: 'ℙ', H: 'ℍ' };
  const SUP_MAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
  const SUB_MAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };
  const ACCENTS = { bar: '\u0304', vec: '\u20D7', hat: '\u0302', dot: '\u0307', ddot: '\u0308', tilde: '\u0303', acute: '\u0301', grave: '\u0300' };

  // 在字符串中找到 \cmd 后的第一组花括号内容（支持一层嵌套）
  function readGroup(s, cmdEnd) {
    let i = cmdEnd;
    while (i < s.length && s[i] === ' ') i++;
    if (s[i] !== '{') return null;
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return null;
    return { inner: s.slice(i + 1, j), start: i, end: j + 1 };
  }

  // 迭代替换 \cmd{A}{B} / \cmd{A} 形式的结构命令
  function replaceStruct(s, cmd, fn) {
    const esc = '\\\\' + cmd + '(?![a-zA-Z])';
    let re = new RegExp(esc);
    let guard = 0;
    while (re.test(s) && guard++ < 200) {
      const m = s.match(re);
      const g1 = readGroup(s, m.index + m[0].length);
      if (!g1) break;
      let g2 = null;
      if (fn.length >= 2) g2 = readGroup(s, g1.end);
      const replacement = g2 ? fn(g1.inner, g2.inner) : fn(g1.inner);
      s = s.slice(0, m.index) + replacement + s.slice((g2 || g1).end);
      re = new RegExp(esc);
    }
    return s;
  }

  function toScript(content, map, isSup) {
    const chars = String(content).split('');
    if (chars.length && chars.every(c => map[c] !== undefined)) return chars.map(c => map[c]).join('');
    // 无法全部映射时保留原写法，纯文本中也清晰可读
    return (isSup ? '^{' : '_{') + content + '}';
  }

  function latexToUnicode(input) {
    let s = stripTexDelimiters(input);

    // 结构命令（先处理嵌套的，再处理外层的）
    s = replaceStruct(s, 'frac', (a, b) => '(' + a + ')/(' + b + ')');
    s = replaceStruct(s, 'dfrac', (a, b) => '(' + a + ')/(' + b + ')');
    s = replaceStruct(s, 'tfrac', (a, b) => '(' + a + ')/(' + b + ')');
    s = replaceStruct(s, 'binom', (a, b) => 'C(' + a + ', ' + b + ')');
    s = replaceStruct(s, 'sqrt', (a) => '√(' + a + ')');
    s = replaceStruct(s, 'mathbb', (a) => BB_MAP[a] || a);
    s = replaceStruct(s, 'mathrm', (a) => a);
    s = replaceStruct(s, 'mathit', (a) => a);
    s = replaceStruct(s, 'mathbf', (a) => a);
    s = replaceStruct(s, 'text', (a) => a);
    s = replaceStruct(s, 'textbf', (a) => a);
    s = replaceStruct(s, 'operatorname', (a) => a);
    s = replaceStruct(s, 'substack', (a) => a);
    s = s.replace(/\\sqrt\[/g, '√[');

    // 重音符号：\bar{x} → x̄
    for (const [cmd, comb] of Object.entries(ACCENTS)) {
      s = replaceStruct(s, cmd, (a) => a + comb);
    }

    // 上下标
    s = s.replace(/\^\{([^{}]*)\}/g, (_, c) => toScript(c, SUP_MAP, true));
    s = s.replace(/_\{([^{}]*)\}/g, (_, c) => toScript(c, SUB_MAP, false));
    s = s.replace(/\^([0-9a-zA-Z])\b/g, (_, c) => SUP_MAP[c] !== undefined ? SUP_MAP[c] : '^' + c);
    s = s.replace(/_([0-9a-zA-Z])\b/g, (_, c) => SUB_MAP[c] !== undefined ? SUB_MAP[c] : '_' + c);

    // \left \right 及定界符命令
    s = s.replace(/\\left|\\right|\\big|\\Big|\\bigg|\\Bigg|\\bigl|\\bigr|\\Bigl|\\Bigr/g, '');
    s = s.replace(/\\lvert|\\lVert/g, '|').replace(/\\rvert|\\rVert/g, '|');
    s = s.replace(/\\lbrace/g, '{').replace(/\\rbrace/g, '}');
    s = s.replace(/\\langle/g, '〈').replace(/\\rangle/g, '〉');

    // 间距命令
    s = s.replace(/\\[,;!>]|\\quad|\\qquad|\\hspace\{[^}]*\}|\\;/g, ' ');

    // 普通符号命令（一次正则扫描，避免前缀误替换）
    s = s.replace(/\\([a-zA-Z]+)/g, (full, name) => {
      if (SYMBOLS[name] !== undefined) return SYMBOLS[name];
      return name; // 未知命令：去掉反斜杠保留名称
    });

    // 其余排版环境
    s = s.replace(/\\begin\{(aligned|align|align\*|cases|gathered|array|matrix|pmatrix|bmatrix|vmatrix)\*?\}/g, '');
    s = s.replace(/\\end\{(aligned|align|align\*|cases|gathered|array|matrix|pmatrix|bmatrix|vmatrix)\*?\}/g, '');
    s = s.replace(/&/g, '  ').replace(/\\\\/g, ' ');

    // 转义字符
    s = s.replace(/\\\\\{/g, '{').replace(/\\\\\}/g, '}');
    s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
    s = s.replace(/\\\$/g, '$').replace(/\\%/g, '%').replace(/\\&/g, '&').replace(/\\#/g, '#').replace(/\\_/g, '_');

    // 整理空白
    s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n');
    return s.trim();
  }

  /* ============================================================
   * 五、导出
   * ============================================================ */
  EQ.convert = {
    stripTexDelimiters,
    renderTexToHtml,
    texToMathML,
    latexToUnicode,
    escapeHtml
  };
})();
