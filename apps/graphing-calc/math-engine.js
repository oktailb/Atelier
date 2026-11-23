/**
 * SimpleGallery WebOS - Secure Mathematical Expression Parser, Evaluator & Numerical Analyzer
 * 100% Pure JavaScript recursive-descent AST parser without dynamic code execution.
 * Supports Scientific mode (DEG/RAD/GRAD), Numerical Analysis (roots, extrema, intersections),
 * and arbitrary-width BigInt Programmer Bitwise mode (8/16/32/64-bit).
 */
(function (window) {
  'use strict';

  const MAX_EXPRESSION_LENGTH = 512;
  const MAX_AST_DEPTH = 64;

  // Lanczos approximation for Gamma(z) to support non-integer factorials (x! = Gamma(x+1))
  const LANCZOS_G = 7;
  const LANCZOS_P = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  function gamma(z) {
    if (!Number.isFinite(z)) return NaN;
    if (z < 0.5) {
      return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    z -= 1;
    let x = LANCZOS_P[0];
    for (let i = 1; i < LANCZOS_P.length; i++) {
      x += LANCZOS_P[i] / (z + i);
    }
    const t = z + LANCZOS_G + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  function factorial(n) {
    if (!Number.isFinite(n)) return NaN;
    if (n < 0 && Number.isInteger(n)) return NaN;
    if (n > 170) return Infinity;
    if (Number.isInteger(n)) {
      let res = 1;
      for (let i = 2; i <= n; i++) res *= i;
      return res;
    }
    return gamma(n + 1);
  }

  function gcd(a, b) {
    a = Math.abs(Math.trunc(a));
    b = Math.abs(Math.trunc(b));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    while (b !== 0) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  function lcm(a, b) {
    const g = gcd(a, b);
    if (!g) return 0;
    return Math.abs(Math.trunc(a) * Math.trunc(b)) / g;
  }

  function toRadians(val, angleMode) {
    if (angleMode === 'DEG') return (val * Math.PI) / 180;
    if (angleMode === 'GRAD') return (val * Math.PI) / 200;
    return val;
  }

  function fromRadians(val, angleMode) {
    if (angleMode === 'DEG') return (val * 180) / Math.PI;
    if (angleMode === 'GRAD') return (val * 200) / Math.PI;
    return val;
  }

  const CONSTANTS = Object.freeze({
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
    tau: Math.PI * 2,
    'τ': Math.PI * 2,
    phi: (1 + Math.sqrt(5)) / 2,
    'φ': (1 + Math.sqrt(5)) / 2,
    ln2: Math.LN2,
    ln10: Math.LN10,
    sqrt2: Math.SQRT2
  });

  const FUNCTIONS = Object.freeze({
    sin: (args, mode) => Math.sin(toRadians(args[0], mode)),
    cos: (args, mode) => Math.cos(toRadians(args[0], mode)),
    tan: (args, mode) => Math.tan(toRadians(args[0], mode)),
    asin: (args, mode) => fromRadians(Math.asin(args[0]), mode),
    acos: (args, mode) => fromRadians(Math.acos(args[0]), mode),
    atan: (args, mode) => fromRadians(Math.atan(args[0]), mode),
    atan2: (args, mode) => fromRadians(Math.atan2(args[0], args[1]), mode),
    csc: (args, mode) => 1 / Math.sin(toRadians(args[0], mode)),
    sec: (args, mode) => 1 / Math.cos(toRadians(args[0], mode)),
    cot: (args, mode) => 1 / Math.tan(toRadians(args[0], mode)),
    sinh: (args) => Math.sinh(args[0]),
    cosh: (args) => Math.cosh(args[0]),
    tanh: (args) => Math.tanh(args[0]),
    asinh: (args) => Math.asinh(args[0]),
    acosh: (args) => Math.acosh(args[0]),
    atanh: (args) => Math.atanh(args[0]),
    ln: (args) => Math.log(args[0]),
    log: (args) => (args.length >= 2 ? Math.log(args[0]) / Math.log(args[1]) : Math.log10(args[0])),
    log10: (args) => Math.log10(args[0]),
    log2: (args) => Math.log2(args[0]),
    exp: (args) => Math.exp(args[0]),
    sqrt: (args) => Math.sqrt(args[0]),
    cbrt: (args) => Math.cbrt(args[0]),
    abs: (args) => Math.abs(args[0]),
    sign: (args) => Math.sign(args[0]),
    floor: (args) => Math.floor(args[0]),
    ceil: (args) => Math.ceil(args[0]),
    round: (args) => Math.round(args[0]),
    trunc: (args) => Math.trunc(args[0]),
    pow: (args) => Math.pow(args[0], args[1]),
    mod: (args) => ((args[0] % args[1]) + args[1]) % args[1],
    hypot: (args) => Math.hypot(...args),
    min: (args) => Math.min(...args),
    max: (args) => Math.max(...args),
    clamp: (args) => Math.min(Math.max(args[0], args[1]), args[2]),
    fact: (args) => factorial(args[0]),
    gamma: (args) => gamma(args[0]),
    ncr: (args) => {
      const n = Math.trunc(args[0]);
      const r = Math.trunc(args[1]);
      if (r < 0 || r > n || n < 0) return NaN;
      return Math.round(factorial(n) / (factorial(r) * factorial(n - r)));
    },
    npr: (args) => {
      const n = Math.trunc(args[0]);
      const r = Math.trunc(args[1]);
      if (r < 0 || r > n || n < 0) return NaN;
      return Math.round(factorial(n) / factorial(n - r));
    },
    gcd: (args) => gcd(args[0], args[1]),
    lcm: (args) => lcm(args[0], args[1]),
    deg: (args) => (args[0] * 180) / Math.PI,
    rad: (args) => (args[0] * Math.PI) / 180
  });

  function isIdentStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === 'π' || ch === 'τ' || ch === 'φ';
  }

  function isIdentPart(ch) {
    return isIdentStart(ch) || (ch >= '0' && ch <= '9');
  }

  /**
   * Tokenize mathematical expression into typed tokens with implicit multiplication insertion.
   */
  function tokenize(rawInput) {
    if (typeof rawInput !== 'string') {
      throw new Error('Expression must be a string');
    }
    const input = rawInput.trim();
    if (!input) {
      throw new Error('Empty expression');
    }
    if (input.length > MAX_EXPRESSION_LENGTH) {
      throw new Error('Expression too long');
    }

    // Normalize common mathematical unicode symbols
    const src = input
      .replace(/×/g, '*')
      .replace(/·/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/√/g, 'sqrt')
      .replace(/\*\*/g, '^');

    const rawTokens = [];
    let i = 0;
    const len = src.length;

    while (i < len) {
      const ch = src[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      // Numeric literals (including 0x..., 0b..., 0o..., decimal & scientific notation)
      if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < len && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        const start = i;
        if (ch === '0' && i + 1 < len && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
          i += 2;
          while (i < len && /[0-9a-fA-F]/.test(src[i])) i++;
          const num = parseInt(src.slice(start + 2, i), 16);
          if (Number.isNaN(num)) throw new Error(`Invalid hex literal at ${start}`);
          rawTokens.push({ type: 'number', value: num });
          continue;
        }
        if (ch === '0' && i + 1 < len && (src[i + 1] === 'b' || src[i + 1] === 'B')) {
          i += 2;
          while (i < len && (src[i] === '0' || src[i] === '1')) i++;
          const num = parseInt(src.slice(start + 2, i), 2);
          if (Number.isNaN(num)) throw new Error(`Invalid binary literal at ${start}`);
          rawTokens.push({ type: 'number', value: num });
          continue;
        }
        if (ch === '0' && i + 1 < len && (src[i + 1] === 'o' || src[i + 1] === 'O')) {
          i += 2;
          while (i < len && /[0-7]/.test(src[i])) i++;
          const num = parseInt(src.slice(start + 2, i), 8);
          if (Number.isNaN(num)) throw new Error(`Invalid octal literal at ${start}`);
          rawTokens.push({ type: 'number', value: num });
          continue;
        }

        let hasDot = false;
        while (i < len && ((src[i] >= '0' && src[i] <= '9') || (!hasDot && src[i] === '.'))) {
          if (src[i] === '.') hasDot = true;
          i++;
        }
        // Scientific exponent: 1e-5, 2.3E+4
        if (i < len && (src[i] === 'e' || src[i] === 'E')) {
          const expIdx = i;
          let j = i + 1;
          if (j < len && (src[j] === '+' || src[j] === '-')) j++;
          if (j < len && src[j] >= '0' && src[j] <= '9') {
            while (j < len && src[j] >= '0' && src[j] <= '9') j++;
            i = j;
          } else {
            i = expIdx; // Let 'e' be parsed as Euler's constant via implicit multiplication (e.g. 2e)
          }
        }
        const num = parseFloat(src.slice(start, i));
        if (Number.isNaN(num)) throw new Error(`Invalid number at ${start}`);
        rawTokens.push({ type: 'number', value: num });
        continue;
      }

      // Identifiers (functions, constants, variables)
      if (isIdentStart(ch)) {
        const start = i;
        i++;
        while (i < len && isIdentPart(src[i])) i++;
        const name = src.slice(start, i).toLowerCase();
        rawTokens.push({ type: 'ident', value: name });
        continue;
      }

      // Single-character operators and delimiters
      if ('+-*/%^!(),'.includes(ch)) {
        const type = ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : ch === ',' ? 'comma' : 'op';
        rawTokens.push({ type, value: ch });
        i++;
        continue;
      }

      throw new Error(`Unexpected character "${ch}" at position ${i}`);
    }

    // Insert implicit multiplication tokens where mathematically standard:
    // e.g. 2x, 2pi, 3sin(x), 2(x+1), (x+1)(x-1), (x+1)2, x!2, pi x
    const tokens = [];
    for (let k = 0; k < rawTokens.length; k++) {
      const cur = rawTokens[k];
      if (tokens.length > 0) {
        const prev = tokens[tokens.length - 1];
        const prevCanEndTerm =
          prev.type === 'number' ||
          prev.type === 'rparen' ||
          (prev.type === 'op' && prev.value === '!') ||
          (prev.type === 'ident' && !Object.prototype.hasOwnProperty.call(FUNCTIONS, prev.value));

        const curCanStartTerm =
          cur.type === 'number' ||
          cur.type === 'ident' ||
          cur.type === 'lparen';

        if (prevCanEndTerm && curCanStartTerm) {
          tokens.push({ type: 'op', value: '*' });
        }
      }
      tokens.push(cur);
    }

    tokens.push({ type: 'eof', value: '' });
    return tokens;
  }

  /**
   * Recursive-descent parser building an immutable AST.
   * Grammar:
   *   expr    := addSub
   *   addSub  := mulDiv ( ('+' | '-') mulDiv )*
   *   mulDiv  := unary  ( ('*' | '/' | '%') unary )*
   *   unary   := ('+' | '-') unary | power
   *   power   := postfix ( '^' unary )?
   *   postfix := primary ( '!' )*
   *   primary := number | ident '(' args ')' | ident | '(' expr ')'
   */
  function parseAST(tokens) {
    let pos = 0;

    function peek() {
      return tokens[pos];
    }

    function consume() {
      return tokens[pos++];
    }

    function parseAddSub(depth) {
      if (depth > MAX_AST_DEPTH) throw new Error('Expression nesting too deep');
      let node = parseMulDiv(depth + 1);
      while (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const right = parseMulDiv(depth + 1);
        node = { type: 'binary', op, left: node, right };
      }
      return node;
    }

    function parseMulDiv(depth) {
      if (depth > MAX_AST_DEPTH) throw new Error('Expression nesting too deep');
      let node = parseUnary(depth + 1);
      while (peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
        const op = consume().value;
        const right = parseUnary(depth + 1);
        node = { type: 'binary', op, left: node, right };
      }
      return node;
    }

    function parseUnary(depth) {
      if (depth > MAX_AST_DEPTH) throw new Error('Expression nesting too deep');
      if (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const arg = parseUnary(depth + 1);
        return { type: 'unary', op, arg };
      }
      return parsePower(depth + 1);
    }

    function parsePower(depth) {
      if (depth > MAX_AST_DEPTH) throw new Error('Expression nesting too deep');
      let node = parsePostfix(depth + 1);
      if (peek().type === 'op' && peek().value === '^') {
        consume();
        const right = parseUnary(depth + 1); // right-associative, supports 2^-3
        node = { type: 'binary', op: '^', left: node, right };
      }
      return node;
    }

    function parsePostfix(depth) {
      if (depth > MAX_AST_DEPTH) throw new Error('Expression nesting too deep');
      let node = parsePrimary(depth + 1);
      while (peek().type === 'op' && peek().value === '!') {
        consume();
        node = { type: 'postfix', op: '!', arg: node };
      }
      return node;
    }

    function parsePrimary(depth) {
      if (depth > MAX_AST_DEPTH) throw new Error('Expression nesting too deep');
      const tok = peek();

      if (tok.type === 'number') {
        consume();
        return { type: 'number', value: tok.value };
      }

      if (tok.type === 'ident') {
        consume();
        const name = tok.value;
        if (peek().type === 'lparen') {
          if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
            throw new Error(`Unknown function "${name}"`);
          }
          consume(); // '('
          const args = [];
          if (peek().type !== 'rparen') {
            args.push(parseAddSub(depth + 1));
            while (peek().type === 'comma') {
              consume();
              args.push(parseAddSub(depth + 1));
            }
          }
          if (peek().type !== 'rparen') {
            throw new Error(`Missing closing parenthesis for "${name}"`);
          }
          consume(); // ')'
          if (args.length === 0) {
            throw new Error(`Function "${name}" requires at least 1 argument`);
          }
          return { type: 'call', name, args };
        }
        return { type: 'var', name };
      }

      if (tok.type === 'lparen') {
        consume();
        const inner = parseAddSub(depth + 1);
        if (peek().type !== 'rparen') {
          throw new Error('Missing closing parenthesis');
        }
        consume();
        return inner;
      }

      throw new Error(`Unexpected token "${tok.value || tok.type}"`);
    }

    const ast = parseAddSub(0);
    if (peek().type !== 'eof') {
      throw new Error(`Unexpected trailing token "${peek().value}"`);
    }
    return ast;
  }

  function evalNode(node, vars, angleMode) {
    switch (node.type) {
      case 'number':
        return node.value;

      case 'var': {
        if (vars && Object.prototype.hasOwnProperty.call(vars, node.name)) {
          return vars[node.name];
        }
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, node.name)) {
          return CONSTANTS[node.name];
        }
        throw new Error(`Unknown variable "${node.name}"`);
      }

      case 'unary': {
        const v = evalNode(node.arg, vars, angleMode);
        return node.op === '-' ? -v : +v;
      }

      case 'postfix': {
        const v = evalNode(node.arg, vars, angleMode);
        return node.op === '!' ? factorial(v) : v;
      }

      case 'binary': {
        const l = evalNode(node.left, vars, angleMode);
        const r = evalNode(node.right, vars, angleMode);
        switch (node.op) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/': return l / r;
          case '%': return l % r;
          case '^': return Math.pow(l, r);
          default: return NaN;
        }
      }

      case 'call': {
        const fn = FUNCTIONS[node.name];
        const evaluatedArgs = node.args.map(a => evalNode(a, vars, angleMode));
        return fn(evaluatedArgs, angleMode);
      }

      default:
        return NaN;
    }
  }

  /**
   * Compile expression into a reusable fast evaluator: fn(vars, angleMode) -> number
   */
  function compile(expr) {
    const tokens = tokenize(expr);
    const ast = parseAST(tokens);
    return function (vars = {}, angleMode = 'RAD') {
      return evalNode(ast, vars, angleMode);
    };
  }

  /**
   * One-shot evaluation helper
   */
  function evaluate(expr, vars = {}, angleMode = 'RAD') {
    const fn = compile(expr);
    return fn(vars, angleMode);
  }

  /**
   * Clean floating-point display formatting
   */
  function formatNumber(val, maxDigits = 10) {
    if (typeof val !== 'number' || Number.isNaN(val)) return 'NaN';
    if (!Number.isFinite(val)) return val > 0 ? '∞' : '-∞';
    if (Math.abs(val) < 1e-13) return '0';
    const abs = Math.abs(val);
    if (abs >= 1e12 || abs < 1e-6) {
      return val.toExponential(Math.min(maxDigits, 6)).replace(/\.?0+e/, 'e');
    }
    return String(Number(val.toPrecision(maxDigits)));
  }

  // ---------------------------------------------------------------------------
  // Numerical Analysis Suite (Derivatives, Roots, Extrema, Intersections)
  // ---------------------------------------------------------------------------

  function derivative(fn, x, h = 1e-5) {
    const y1 = fn(x + h);
    const y0 = fn(x - h);
    if (!Number.isFinite(y1) || !Number.isFinite(y0)) return NaN;
    return (y1 - y0) / (2 * h);
  }

  function refineRootBisection(fn, a, b, iterations = 36) {
    let fa = fn(a);
    let fb = fn(b);
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
    if (Math.abs(fa) < 1e-12) return a;
    if (Math.abs(fb) < 1e-12) return b;
    if (fa * fb > 0) return null;

    let lo = a;
    let hi = b;
    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) * 0.5;
      const fm = fn(mid);
      if (!Number.isFinite(fm)) return null;
      if (Math.abs(fm) < 1e-12 || Math.abs(hi - lo) < 1e-10) {
        return mid;
      }
      if (fa * fm <= 0) {
        hi = mid;
        fb = fm;
      } else {
        lo = mid;
        fa = fm;
      }
    }
    const root = (lo + hi) * 0.5;
    const fRoot = fn(root);
    // Reject vertical asymptotes (where sign changed across infinity)
    if (!Number.isFinite(fRoot) || Math.abs(fRoot) > 1e-2) return null;
    return root;
  }

  function deduplicatePoints(points, tolX = 1e-3) {
    const sorted = points.slice().sort((a, b) => a.x - b.x);
    const unique = [];
    for (const pt of sorted) {
      const last = unique[unique.length - 1];
      if (!last || Math.abs(pt.x - last.x) > tolX) {
        unique.push(pt);
      }
    }
    return unique;
  }

  /**
   * Find roots f(x) = 0 on [xMin, xMax]
   */
  function findRoots(fn, xMin, xMax, samples = 400) {
    const roots = [];
    const span = xMax - xMin;
    if (!(span > 0)) return roots;
    const dx = span / samples;
    const tol = Math.max(1e-4, span * 1e-3);

    let prevX = xMin;
    let prevY = fn(prevX);

    for (let i = 1; i <= samples; i++) {
      const curX = xMin + i * dx;
      const curY = fn(curX);

      if (Number.isFinite(prevY) && Number.isFinite(curY)) {
        if (Math.abs(curY) < 1e-9) {
          roots.push({ x: curX, y: 0 });
        } else if (prevY * curY < 0) {
          // Guard against vertical asymptote jump
          if (Math.abs(curY - prevY) < 1e4) {
            const rx = refineRootBisection(fn, prevX, curX);
            if (rx !== null) {
              roots.push({ x: rx, y: 0 });
            }
          }
        }
      }
      prevX = curX;
      prevY = curY;
    }

    // Also catch tangent roots (e.g. x^2 = 0) where f touches 0 without crossing sign
    const extrema = findExtrema(fn, xMin, xMax, Math.min(samples, 250));
    for (const ext of extrema) {
      if (Math.abs(ext.y) < 1e-4) {
        roots.push({ x: ext.x, y: 0 });
      }
    }

    return deduplicatePoints(roots, tol).slice(0, 24);
  }

  /**
   * Find local minima and maxima on [xMin, xMax]
   */
  function findExtrema(fn, xMin, xMax, samples = 400) {
    const extrema = [];
    const span = xMax - xMin;
    if (!(span > 0)) return extrema;
    const dx = span / samples;
    const h = Math.min(1e-5, dx * 0.1);
    const tol = Math.max(1e-4, span * 1e-3);

    const dFn = (x) => derivative(fn, x, h);
    let prevX = xMin;
    let prevD = dFn(prevX);

    for (let i = 1; i <= samples; i++) {
      const curX = xMin + i * dx;
      const curD = dFn(curX);

      if (Number.isFinite(prevD) && Number.isFinite(curD) && prevD * curD < 0) {
        const ex = refineRootBisection(dFn, prevX, curX, 28);
        if (ex !== null) {
          const ey = fn(ex);
          if (Number.isFinite(ey) && Math.abs(ey) < 1e8) {
            const kind = prevD > 0 && curD < 0 ? 'max' : 'min';
            extrema.push({ x: ex, y: ey, kind });
          }
        }
      }
      prevX = curX;
      prevD = curD;
    }

    return deduplicatePoints(extrema, tol).slice(0, 24);
  }

  /**
   * Find intersections fA(x) = fB(x) on [xMin, xMax]
   */
  function findIntersections(fnA, fnB, xMin, xMax, samples = 400) {
    const diff = (x) => fnA(x) - fnB(x);
    const rawRoots = findRoots(diff, xMin, xMax, samples);
    const pts = [];
    for (const r of rawRoots) {
      const yA = fnA(r.x);
      const yB = fnB(r.x);
      if (Number.isFinite(yA) && Number.isFinite(yB) && Math.abs(yA - yB) < 1e-2) {
        pts.push({ x: r.x, y: (yA + yB) * 0.5 });
      }
    }
    return pts;
  }

  function generateTable(fn, start, end, step) {
    const rows = [];
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) {
      return rows;
    }
    const maxRows = 200;
    let x = start;
    for (let i = 0; i < maxRows && x <= end + step * 1e-6; i++, x = start + i * step) {
      let y = NaN;
      try { y = fn(x); } catch (e) { y = NaN; }
      rows.push({ x, y });
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Programmer Mode (BigInt 8/16/32/64-bit Bitwise Engine)
  // ---------------------------------------------------------------------------

  function getMask(bits) {
    const w = BigInt(bits);
    return (1n << w) - 1n;
  }

  function maskBits(val, bits = 32) {
    return BigInt(val) & getMask(bits);
  }

  function toSigned(val, bits = 32) {
    const masked = maskBits(val, bits);
    const signBit = 1n << BigInt(bits - 1);
    return masked >= signBit ? masked - (1n << BigInt(bits)) : masked;
  }

  function parseBase(rawStr, base = 10, bits = 32) {
    const cleaned = String(rawStr || '0').trim().replace(/[\s_]/g, '');
    if (!cleaned) return 0n;
    const isNeg = cleaned.startsWith('-');
    const body = isNeg ? cleaned.slice(1) : cleaned;
    if (!body) return 0n;

    let parsed;
    if (base === 16) {
      if (!/^[0-9a-fA-F]+$/.test(body)) throw new Error('Invalid HEX');
      parsed = BigInt('0x' + body);
    } else if (base === 2) {
      if (!/^[01]+$/.test(body)) throw new Error('Invalid BIN');
      parsed = BigInt('0b' + body);
    } else if (base === 8) {
      if (!/^[0-7]+$/.test(body)) throw new Error('Invalid OCT');
      parsed = BigInt('0o' + body);
    } else {
      if (!/^[0-9]+$/.test(body)) throw new Error('Invalid DEC');
      parsed = BigInt(body);
    }

    if (isNeg) parsed = -parsed;
    return maskBits(parsed, bits);
  }

  function formatBase(val, base = 10, bits = 32, signed = true) {
    const masked = maskBits(val, bits);
    if (base === 10) {
      return (signed ? toSigned(masked, bits) : masked).toString(10);
    }
    if (base === 16) {
      return masked.toString(16).toUpperCase();
    }
    if (base === 8) {
      return masked.toString(8);
    }
    if (base === 2) {
      const raw = masked.toString(2);
      const padLen = Math.ceil(raw.length / 4) * 4;
      const padded = raw.padStart(Math.max(4, padLen), '0');
      return padded.replace(/(.{4})(?=.)/g, '$1 ');
    }
    return masked.toString(base);
  }

  function bitwiseOp(op, a, b, bits = 32, signed = true) {
    const w = BigInt(bits);
    const mask = getMask(bits);
    const ua = maskBits(a, bits);
    const ub = maskBits(b || 0n, bits);
    const sa = toSigned(ua, bits);
    const sb = toSigned(ub, bits);

    switch (String(op).toUpperCase()) {
      case 'AND': return (ua & ub) & mask;
      case 'OR': return (ua | ub) & mask;
      case 'XOR': return (ua ^ ub) & mask;
      case 'NOT': return (~ua) & mask;
      case 'NAND': return (~(ua & ub)) & mask;
      case 'NOR': return (~(ua | ub)) & mask;
      case 'SHL': {
        const shift = ub % w;
        return (ua << shift) & mask;
      }
      case 'SHR': {
        const shift = ub % w;
        return signed ? maskBits(sa >> shift, bits) : (ua >> shift) & mask;
      }
      case 'ROL': {
        const shift = ub % w;
        return ((ua << shift) | (ua >> (w - shift))) & mask;
      }
      case 'ROR': {
        const shift = ub % w;
        return ((ua >> shift) | (ua << (w - shift))) & mask;
      }
      case 'ADD': return (ua + ub) & mask;
      case 'SUB': return (ua - ub) & mask;
      case 'MUL': return (ua * ub) & mask;
      case 'DIV': {
        if (ub === 0n) throw new Error('Division by zero');
        return signed ? maskBits(sa / sb, bits) : (ua / ub) & mask;
      }
      case 'MOD': {
        if (ub === 0n) throw new Error('Division by zero');
        return signed ? maskBits(sa % sb, bits) : (ua % ub) & mask;
      }
      default:
        return ua;
    }
  }

  const GraphingCalcEngine = {
    CONSTANTS,
    FUNCTIONS,
    tokenize,
    parseAST,
    compile,
    evaluate,
    formatNumber,
    factorial,
    gamma,
    derivative,
    findRoots,
    findExtrema,
    findIntersections,
    generateTable,
    programmer: {
      maskBits,
      toSigned,
      parseBase,
      formatBase,
      bitwiseOp
    }
  };

  window.GraphingCalcEngine = GraphingCalcEngine;
})(typeof window !== 'undefined' ? window : globalThis);
