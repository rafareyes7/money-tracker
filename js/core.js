/*
 * core.js — Funciones puras (sin DOM, sin almacenamiento).
 * Dinero siempre en céntimos enteros. Fechas siempre como texto ISO 'AAAA-MM-DD'.
 * Funciona en el navegador (window.Core) y en Node (module.exports) para los tests.
 */
(function (root) {
  'use strict';

  // ───────────────────────── Dinero ─────────────────────────

  /** Convierte un importe (número o texto es-ES/en) a céntimos con signo. Vacío → 0. Inválido → NaN. */
  function parseAmount(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
    let s = String(v).trim();
    if (s === '') return 0;
    s = s.replace(/[€\s  ]/g, '').replace(/EUR/gi, '').replace(/[−–—]/g, '-');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    else if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
    if (s.startsWith('+')) s = s.slice(1);
    if (s === '') return NaN;
    let intPart, decPart;
    if (s.includes(',')) {
      const parts = s.replace(/\./g, '').split(',');
      if (parts.length !== 2) return NaN;
      [intPart, decPart] = parts;
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = s.replace(/\./g, ''); decPart = '';
    } else {
      const parts = s.split('.');
      if (parts.length > 2) return NaN;
      intPart = parts[0]; decPart = parts[1] || '';
    }
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart) || (intPart + decPart) === '') return NaN;
    let cents = parseInt(intPart || '0', 10) * 100 + parseInt((decPart + '00').slice(0, 2), 10);
    if (decPart.length > 2 && decPart[2] >= '5') cents += 1;
    return neg ? -cents : cents;
  }

  function groupThousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** 123456 → '1.234,56 €'. opts.sign: muestra '+' en positivos. opts.plain: sin '€'. */
  function formatMoney(cents, opts) {
    opts = opts || {};
    const c = Math.round(cents || 0);
    const abs = Math.abs(c);
    const txt = groupThousands(Math.floor(abs / 100)) + ',' + String(abs % 100).padStart(2, '0');
    const sign = c < 0 ? '−' : (opts.sign && c > 0 ? '+' : '');
    return sign + txt + (opts.plain ? '' : ' €');
  }

  /** Formato para CSV de Toshl: '1.234,56' (sin signo ni símbolo). */
  function formatAmountCsv(cents) {
    return formatMoney(Math.abs(cents), { plain: true });
  }

  // ───────────────────────── Fechas ─────────────────────────

  const pad2 = (n) => String(n).padStart(2, '0');
  function toISO(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function isoToUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function utcToISO(t) { const d = new Date(t); return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(iso, n) { return utcToISO(isoToUTC(iso) + n * 86400000); }
  function diffDays(a, b) { return Math.round((isoToUTC(b) - isoToUTC(a)) / 86400000); } // b - a
  function dayOfWeek(iso) { return new Date(isoToUTC(iso)).getUTCDay(); } // 0 = domingo
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function isValidISO(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [y, m, d] = iso.split('-').map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }
  function todayISO(now) { const d = now || new Date(); return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function formatDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '/' + m + '/' + y; }
  function formatDateShort(iso) { if (!iso) return ''; const [, m, d] = iso.split('-'); return d + '/' + m; }
  const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function dowName(iso) { return DOW[dayOfWeek(iso)]; }

  /** Número de serie de Excel → ISO (sistema 1900, ignora la hora). */
  function excelSerialToISO(n) {
    return utcToISO(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  }

  /** Acepta número de Excel, Date, 'd/m/aa', 'd/m/aaaa', 'aaaa-mm-dd', 'd-m-aaaa', 'd.m.aaaa'. Devuelve ISO o null. */
  function parseDateAny(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v > 0 && v < 2958466 ? excelSerialToISO(v) : null;
    if (v instanceof Date && !isNaN(v)) return toISO(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { const iso = toISO(+m[1], +m[2], +m[3]); return isValidISO(iso) ? iso : null; }
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
    if (m) {
      let y = +m[3]; if (m[3].length === 2) y += 2000;
      const iso = toISO(y, +m[2], +m[1]);
      return isValidISO(iso) ? iso : null;
    }
    if (/^\d+(\.\d+)?$/.test(s)) return parseDateAny(Number(s));
    return null;
  }

  // ───────────────────────── Periodo ─────────────────────────

  const DEFAULT_PERIOD_CFG = { startDay: 25, skipWeekends: true, skipHolidays: true, holidays: [], overrides: {} };

  function holidaySet(cfg) {
    const set = new Set();
    if (cfg && cfg.skipHolidays !== false) (cfg.holidays || []).forEach((h) => set.add(typeof h === 'string' ? h : h.date));
    return set;
  }

  /** Inicio “natural” del periodo del mes (año, mes 1–12): día 25 (o el configurado), saltando fines de semana y festivos. */
  function naturalPeriodStart(y, m, cfg) {
    cfg = Object.assign({}, DEFAULT_PERIOD_CFG, cfg || {});
    const hol = holidaySet(cfg);
    let iso = toISO(y, m, Math.min(cfg.startDay, daysInMonth(y, m)));
    for (let i = 0; i < 15; i++) {
      const dw = dayOfWeek(iso);
      const weekend = cfg.skipWeekends !== false && (dw === 0 || dw === 6);
      if (!weekend && !hol.has(iso)) break;
      iso = addDays(iso, 1);
    }
    return iso;
  }

  function periodIdOf(y, m) { return y + '-' + pad2(m); }
  function shiftPeriodId(id, n) {
    let [y, m] = id.split('-').map(Number);
    m += n;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return periodIdOf(y, m);
  }
  function periodStart(id, cfg) {
    const ov = cfg && cfg.overrides && cfg.overrides[id];
    if (ov && ov.start) return ov.start;
    const [y, m] = id.split('-').map(Number);
    return naturalPeriodStart(y, m, cfg);
  }
  /** Periodo con id 'AAAA-MM' (mes en que empieza). Termina el día anterior al inicio del siguiente. */
  function getPeriod(id, cfg) {
    const start = periodStart(id, cfg);
    const ov = cfg && cfg.overrides && cfg.overrides[id];
    const end = ov && ov.end ? ov.end : addDays(periodStart(shiftPeriodId(id, 1), cfg), -1);
    return { id, start, end, days: diffDays(start, end) + 1 };
  }
  function periodIdForDate(iso, cfg) {
    let id = iso.slice(0, 7);
    for (let i = 0; i < 3; i++) {
      const p = getPeriod(id, cfg);
      if (iso < p.start) id = shiftPeriodId(id, -1);
      else if (iso > p.end) id = shiftPeriodId(id, 1);
      else return id;
    }
    return id;
  }
  /** Periodo con más fechas (en empate, el más reciente). */
  function detectPeriodId(dates, cfg) {
    const count = {};
    dates.forEach((d) => { if (d) { const id = periodIdForDate(d, cfg); count[id] = (count[id] || 0) + 1; } });
    let best = null;
    Object.keys(count).sort().forEach((id) => { if (best === null || count[id] >= count[best]) best = id; });
    return best;
  }
  function periodLabel(p) {
    const [, sm, sd] = p.start.split('-').map(Number);
    const [, em, ed] = p.end.split('-').map(Number);
    return sd + ' ' + MONTHS[sm - 1] + ' – ' + ed + ' ' + MONTHS[em - 1];
  }
  /** Fecha prevista para un “día habitual de pago” dentro del periodo. */
  function dueDateInPeriod(p, day) {
    const [sy, sm] = p.start.split('-').map(Number);
    const candidates = [];
    for (let k = 0; k < 2; k++) {
      let y = sy, m = sm + k; if (m > 12) { m -= 12; y++; }
      candidates.push(toISO(y, m, Math.min(day, daysInMonth(y, m))));
    }
    const inside = candidates.find((c) => c >= p.start && c <= p.end);
    return inside || (candidates[0] < p.start ? p.start : p.end);
  }

  // ───────────────────────── Texto ─────────────────────────

  function normText(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  const STOP = new Set(('PAGO EN COMPRA CON TARJ TARJETA DE DEL LA LAS EL LOS Y A EN POR PARA WWW COM NET ORG HTTP HTTPS ' +
    'ES SL SA SLU SC CB BCN BARCELONA MADRID LU LUXEMBOURG IE IRL GB NL FR DE PT US USA ' +
    'ENVIADO ENVIADA RECIBIDO RECIBIDA RECIBO CARGO ADEUDO OPERACION MOVIMIENTO').split(' '));

  function tokens(s) {
    return normText(s).split(' ').filter((t) => t.length >= 3 && !STOP.has(t) && !/\d/.test(t));
  }
  function tokenHit(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
    return false;
  }
  /** Similitud 0–1 entre dos descripciones (comercio). */
  function similarity(a, b) {
    const A = [...new Set(tokens(a))], B = [...new Set(tokens(b))];
    if (!A.length || !B.length) return 0;
    const small = A.length <= B.length ? A : B, big = small === A ? B : A;
    const hits = small.filter((t) => big.some((u) => tokenHit(t, u))).length;
    return hits / small.length;
  }
  /** Clave de comercio para reglas: 'LIDL', 'CAPRABO', 'BIZUM JORDI'… */
  function merchantKey(desc) {
    const n = normText(desc);
    const tk = tokens(desc);
    if (n.startsWith('BIZUM')) {
      const who = tk.filter((t) => t !== 'BIZUM')[0];
      return who ? 'BIZUM ' + who : 'BIZUM';
    }
    return tk[0] || n.split(' ')[0] || '';
  }
  /** Una regla coincide si todas sus palabras aparecen (o empiezan) en la descripción. */
  function ruleMatches(pattern, desc) {
    const p = normText(pattern).split(' ').filter(Boolean);
    if (!p.length) return false;
    const words = normText(desc).split(' ');
    return p.every((pw) => words.some((w) => w === pw || (pw.length >= 5 && w.startsWith(pw))));
  }

  // ───────────────────────── CSV ─────────────────────────

  function detectDelimiter(line) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }
  /** Parser CSV con comillas, comillas dobles escapadas y saltos de línea dentro de comillas. */
  function parseCSV(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    if (!delim) delim = detectDelimiter(text.split(/\r?\n/)[0] || '');
    const rows = []; let row = []; let field = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }
  function csvField(v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }

  // ───────────────────────── IDs ─────────────────────────

  function fnv1a(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function hashId(str) { return fnv1a(str, 2166136261).toString(36) + fnv1a(str, 0x9747b28c).toString(36); }
  /** IDs estables: mismo movimiento en dos importaciones → mismo id (no se duplica). */
  function assignIds(list, prefix) {
    const seen = {};
    list.forEach((m) => {
      const key = [m.source, m.date, m.cents, normText(m.description).slice(0, 48)].join('|');
      seen[key] = (seen[key] || 0) + 1;
      m.id = prefix + hashId(key + '#' + seen[key]);
    });
    return list;
  }

  // ───────────────────────── Parseo: banco ─────────────────────────

  const BANK_COLS = {
    date: ['F VALOR', 'FECHA VALOR', 'F OPERACION', 'FECHA OPERACION', 'FECHA'],
    category: ['CATEGORIA'],
    subcategory: ['SUBCATEGORIA'],
    description: ['DESCRIPCION', 'CONCEPTO'],
    comment: ['COMENTARIO'],
    amount: ['IMPORTE'],
    balance: ['SALDO'],
  };
  function findCol(headers, names) {
    for (const n of names) {
      const i = headers.findIndex((h) => h === n || ((n === 'IMPORTE' || n === 'SALDO') && h.startsWith(n)));
      if (i >= 0) return i;
    }
    return -1;
  }
  /**
   * Filas (array de arrays) → movimientos del banco.
   * Busca la cabecera (F. VALOR … IMPORTE) e ignora todo lo anterior (cuenta, titular, fecha de exportación).
   */
  function parseBankRows(rows) {
    let h = -1, cols = null;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const headers = (rows[i] || []).map(normText);
      const c = {}; Object.keys(BANK_COLS).forEach((k) => { c[k] = findCol(headers, BANK_COLS[k]); });
      if (c.date >= 0 && c.amount >= 0) { h = i; cols = c; break; }
    }
    if (h < 0) return { movements: [], skipped: 0, error: 'No encuentro la cabecera del banco (F. VALOR … IMPORTE).' };
    const out = []; let skipped = 0; let balance = null;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const date = parseDateAny(r[cols.date]);
      // Saldo tras el movimiento más reciente (el primero de su fecha en el archivo, que viene del más nuevo al más viejo).
      if (date && cols.balance >= 0) {
        const bal = parseAmount(r[cols.balance]);
        if (Number.isFinite(bal) && String(r[cols.balance]).trim() !== '' && (!balance || date > balance.date)) balance = { cents: bal, date };
      }
      const cents = parseAmount(r[cols.amount]);
      if (!date || !Number.isFinite(cents) || cents === 0) { if (r.some((x) => String(x || '').trim())) skipped++; continue; }
      const get = (k) => (cols[k] >= 0 && r[cols[k]] !== undefined && r[cols[k]] !== null ? String(r[cols[k]]).trim() : '');
      let comment = get('comment');
      if (!comment) comment = bizumMessage(get('description'));
      out.push({
        source: 'bank', date, cents,
        description: get('description') || get('comment') || '(sin descripción)',
        comment,
        bankCategory: get('category'), bankSubcategory: get('subcategory'),
      });
    }
    return { movements: assignIds(out, 'b_'), skipped, error: null, balance };
  }
  /** 'Bizum enviado a NOMBRE APELLIDO Mensaje libre' → 'Mensaje libre' ('' si no hay o es “Sin concepto”). */
  function bizumMessage(desc) {
    const m = String(desc || '').match(/^bizum\s+(?:enviado\s+a|recibido\s+de)\s+(.*)$/i);
    if (!m) return '';
    const words = m[1].split(/\s+/); let i = 0;
    while (i < words.length && words[i] === words[i].toUpperCase() && /[A-ZÁÉÍÓÚÑÜ]/.test(words[i])) i++;
    const msg = words.slice(i).join(' ').trim();
    return /^sin concepto$/i.test(msg) ? '' : msg;
  }
  /** Texto pegado desde Excel/Numbers (tabulado) → movimientos del banco. */
  function parseBankText(text) {
    const first = String(text || '').split(/\r?\n/).find((l) => l.trim()) || '';
    const delim = first.includes('\t') ? '\t' : detectDelimiter(first);
    return parseBankRows(parseCSV(text, delim));
  }

  // ───────────────────────── Parseo: Toshl ─────────────────────────

  const TOSHL_COLS = {
    date: ['FECHA', 'DATE'],
    account: ['CUENTA', 'ACCOUNT'],
    category: ['CATEGORIA', 'CATEGORY'],
    tags: ['ETIQUETAS', 'TAGS'],
    expense: ['CANTIDAD DE GASTO', 'EXPENSE AMOUNT'],
    income: ['CANTIDAD DE INGRESO', 'INCOME AMOUNT'],
    currency: ['DIVISA', 'CURRENCY'],
    inMain: ['EN LA DIVISA PRINCIPAL', 'IN MAIN CURRENCY'],
    mainCurrency: ['DIVISA PRINCIPAL', 'MAIN CURRENCY'],
    description: ['DESCRIPCION', 'DESCRIPTION'],
  };
  function parseToshl(text) {
    const rows = parseCSV(text);
    let h = -1, c = null;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const headers = rows[i].map(normText);
      const cc = {}; Object.keys(TOSHL_COLS).forEach((k) => { cc[k] = headers.findIndex((x) => TOSHL_COLS[k].includes(x)); });
      if (cc.date >= 0 && cc.category >= 0 && (cc.expense >= 0 || cc.income >= 0)) { h = i; c = cc; break; }
    }
    if (h < 0) return { movements: [], skipped: 0, error: 'No encuentro la cabecera de Toshl (Fecha, Categoría, Cantidad de gasto…).' };
    const out = []; let skipped = 0;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const get = (k) => (c[k] >= 0 && r[c[k]] !== undefined ? String(r[c[k]]).trim() : '');
      const date = parseDateAny(get('date'));
      let exp = parseAmount(get('expense')), inc = parseAmount(get('income'));
      if (!Number.isFinite(exp)) exp = 0; if (!Number.isFinite(inc)) inc = 0;
      let cents = exp > 0 ? -exp : (inc > 0 ? inc : (exp < 0 ? exp : 0));
      const cur = get('currency'), main = get('mainCurrency');
      if (cur && main && cur !== main) {
        const conv = Math.abs(parseAmount(get('inMain')));
        if (Number.isFinite(conv) && conv > 0) cents = Math.sign(cents) * conv;
      }
      if (!date || !cents) { skipped++; continue; }
      out.push({
        source: 'toshl', date, cents,
        description: get('description'),
        category: get('category') || 'Sin categoría',
        subcategory: get('tags'),
        account: get('account'),
      });
    }
    return { movements: assignIds(out, 't_'), skipped, error: null };
  }

  // ───────────────────────── Emparejamiento ─────────────────────────

  function pairKey(tid, bid) { return tid + '|' + bid; }
  function toshlText(t) { return [t.description, t.subcategory].filter(Boolean).join(' '); }
  function matchId(tids, bids) { return 'x_' + hashId(tids.slice().sort().join(',') + '>' + bids.slice().sort().join(',')); }

  function combos(arr, k, start, acc, out, limit) {
    if (out.length >= limit) return;
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out, limit); acc.pop(); }
  }

  /**
   * Empareja movimientos del banco con Toshl (solo los que aún no tienen pareja).
   * Orden: 1) importe exacto y ±dateTol días → conciliado
   *        2) importe exacto y descripción parecida (±descDays) → conciliado
   *        3) importe parecido (±0,10 € o ±2 %) y ±dateTol días → posible
   *        4) 1 ↔ varios que suman exacto (±dateTol días) → posible
   * Cada movimiento se usa una sola vez. Los pares rechazados no se vuelven a proponer.
   */
  function matchMovements(bank, toshl, opts) {
    opts = Object.assign({ dateTol: 3, descDays: 10, minSim: 0.6, rejected: {} }, opts || {});
    const rej = opts.rejected || {};
    const usedB = new Set(), usedT = new Set(), result = [];
    const sorted = (a) => a.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));
    const B = sorted(bank), T = sorted(toshl);
    const sim = (t, b) => similarity(toshlText(t), b.description);

    function greedy(cands, status, reason) {
      cands.sort((a, b) => a.score - b.score || (a.t.id < b.t.id ? -1 : 1) || (a.b.id < b.b.id ? -1 : 1));
      cands.forEach((c) => {
        if (usedT.has(c.t.id) || usedB.has(c.b.id)) return;
        usedT.add(c.t.id); usedB.add(c.b.id);
        result.push({ id: matchId([c.t.id], [c.b.id]), toshlIds: [c.t.id], bankIds: [c.b.id], status, reason });
      });
    }
    function pairs(test) {
      const out = [];
      T.forEach((t) => {
        if (usedT.has(t.id)) return;
        B.forEach((b) => {
          if (usedB.has(b.id) || rej[pairKey(t.id, b.id)] || Math.sign(t.cents) !== Math.sign(b.cents)) return;
          const d = diffDays(t.date, b.date);
          const s = test(t, b, d);
          if (s !== null) out.push({ t, b, score: s });
        });
      });
      return out;
    }

    // 1) Importe exacto + fecha cercana
    greedy(pairs((t, b, d) => (t.cents === b.cents && Math.abs(d) <= opts.dateTol)
      ? Math.abs(d) * 2 + (d < 0 ? 1 : 0) - sim(t, b) * 3 : null), 'auto', 'Mismo importe y fecha');
    // 2) Importe exacto + descripción parecida
    greedy(pairs((t, b, d) => {
      if (t.cents !== b.cents || Math.abs(d) > opts.descDays) return null;
      const s = sim(t, b); return s >= opts.minSim ? Math.abs(d) - s * 3 : null;
    }), 'auto', 'Mismo importe y comercio');
    // 3) Importe parecido
    greedy(pairs((t, b, d) => {
      if (Math.abs(d) > opts.dateTol || t.cents === b.cents) return null;
      const diff = Math.abs(t.cents - b.cents);
      const tol = Math.max(10, Math.round(Math.abs(t.cents) * 0.02));
      return diff <= tol ? diff / 100 + Math.abs(d) - sim(t, b) * 3 : null;
    }), 'possible', 'Importe parecido');

    // 4) Uno contra varios (suma exacta)
    function splits(ones, many, usedOne, usedMany, oneIsToshl) {
      ones.forEach((o) => {
        if (usedOne.has(o.id)) return;
        const cands = many.filter((m) => !usedMany.has(m.id) && Math.sign(m.cents) === Math.sign(o.cents) &&
          Math.abs(m.cents) < Math.abs(o.cents) && Math.abs(diffDays(o.date, m.date)) <= opts.dateTol &&
          !rej[oneIsToshl ? pairKey(o.id, m.id) : pairKey(m.id, o.id)])
          .sort((a, b) => Math.abs(diffDays(o.date, a.date)) - Math.abs(diffDays(o.date, b.date))).slice(0, 14);
        let best = null;
        for (let k = 2; k <= 3 && !best; k++) {
          const cs = []; combos(cands, k, 0, [], cs, 4000);
          cs.forEach((c) => {
            if (c.reduce((s, m) => s + m.cents, 0) !== o.cents) return;
            const s = c.reduce((acc, m) => acc + (oneIsToshl ? sim(o, m) : sim(m, o)), 0) / c.length;
            const spread = c.reduce((acc, m) => acc + Math.abs(diffDays(o.date, m.date)), 0);
            const score = spread - s * 5;
            if (!best || score < best.score) best = { c, score };
          });
        }
        if (best) {
          usedOne.add(o.id); best.c.forEach((m) => usedMany.add(m.id));
          const tids = oneIsToshl ? [o.id] : best.c.map((m) => m.id);
          const bids = oneIsToshl ? best.c.map((m) => m.id) : [o.id];
          result.push({ id: matchId(tids, bids), toshlIds: tids, bankIds: bids, status: 'possible', reason: oneIsToshl ? '1 apunte ↔ ' + bids.length + ' cargos' : tids.length + ' apuntes ↔ 1 cargo' });
        }
      });
    }
    splits(T, B, usedT, usedB, true);
    splits(B, T, usedB, usedT, false);
    return result;
  }

  // ───────────────────────── Reglas y sugerencias ─────────────────────────

  const DEFAULT_RULES = [
    { pattern: 'NOMINA', category: 'Salario', subcategory: '', treatment: 'income' },
    { pattern: 'BIZUM RECIBIDO', category: '', subcategory: '', treatment: 'refund' },
    { pattern: 'DEVOLUCION', category: '', subcategory: '', treatment: 'refund' },
    { pattern: 'TRASPASO', category: '', subcategory: '', treatment: 'excluded' },
    { pattern: 'TRANSFERENCIA INTERNA', category: '', subcategory: '', treatment: 'excluded' },
  ];

  const BANK_CAT_MAP = [
    [/SUPERMERC|ALIMENTA/, 'Groceries'], [/RESTAUR|BARES|CAFETER|COMIDA/, 'Eating out'],
    [/ROPA|CALZADO|MODA/, 'Clothing'], [/TRANSPORT|GASOLIN|COMBUST|TAXI|PARKING|PEAJE|METRO|TREN/, 'Transporte'],
    [/SUSCRIP|STREAMING/, 'Subscriptions'], [/SUMINISTRO|LUZ|ELECTRIC|AGUA|GAS|TELEFON|INTERNET|MOVIL/, 'House Services'],
    [/HOGAR|BRICOLA|DECORA/, 'HouseHold'], [/SALUD|FARMAC|MEDIC/, 'Health'], [/ALQUILER|VIVIENDA/, 'Rent'],
    [/INVERSION|AHORRO/, 'Investment'], [/NOMINA|SALARIO/, 'Salario'],
  ];

  function ruleSpecificity(r) { return normText(r.pattern).length + (r.manual ? 1000 : 0); }

  /** Sugerencia para un movimiento solo del banco: reglas → categoría del banco → por defecto. */
  function suggestForBank(b, rules, knownCats) {
    const sorted = (rules || []).filter((r) => ruleMatches(r.pattern, b.description))
      .sort((a, c) => ruleSpecificity(c) - ruleSpecificity(a));
    const defTreat = b.cents > 0 ? 'income' : 'expense';
    const sug = { category: '', subcategory: '', treatment: defTreat, source: '', pattern: '' };
    const r = sorted[0];
    if (r) {
      sug.treatment = r.treatment || defTreat;
      if (sug.treatment === 'expense' && b.cents > 0) sug.treatment = 'refund';
      sug.category = r.category || ''; sug.subcategory = r.subcategory || '';
      sug.source = r.manual ? 'regla' : (r.learned ? 'historial' : 'regla'); sug.pattern = r.pattern;
      if (sug.category || sug.treatment === 'excluded') return sug;
    }
    const known = new Set(knownCats || []);
    const bc = normText(b.bankCategory + ' ' + b.bankSubcategory);
    const direct = (knownCats || []).find((c) => normText(c) === normText(b.bankSubcategory) || normText(c) === normText(b.bankCategory));
    if (direct) { sug.category = direct; sug.source = sug.source || 'banco'; return sug; }
    for (const [re, cat] of BANK_CAT_MAP) {
      if (re.test(bc) && (known.has(cat) || !knownCats)) { sug.category = cat; sug.source = sug.source || 'banco'; return sug; }
    }
    if (sug.treatment === 'expense' && known.has('Extra')) { sug.category = 'Extra'; sug.source = sug.source || 'defecto'; }
    if (sug.treatment === 'income' && !sug.category && known.has('Salario') && /NOMINA/.test(normText(b.description))) sug.category = 'Salario';
    return sug;
  }

  /** Crea o actualiza una regla aprendida (no pisa reglas manuales). Devuelve la nueva lista. */
  function learnRule(rules, desc, category, subcategory, treatment, manual) {
    const key = merchantKey(desc);
    if (!key || key.length < 3) return rules;
    const list = (rules || []).slice();
    const i = list.findIndex((r) => normText(r.pattern) === key);
    const rule = { id: (i >= 0 && list[i].id) || 'r_' + hashId(key), pattern: key, category: category || '', subcategory: subcategory || '', treatment: treatment || 'expense', manual: !!manual, learned: !manual };
    if (i >= 0) {
      if (list[i].manual && !manual) return rules;
      list[i] = Object.assign({}, list[i], rule);
    } else list.push(rule);
    return list;
  }

  // ───────────────────────── Libro conciliado ─────────────────────────

  /**
   * Construye el libro (fuente de verdad) a partir de movimientos, emparejamientos y decisiones.
   * entry.treatment: 'expense' | 'income' | 'refund' | 'excluded'
   * entry.status: 'matched' | 'possible' | 'bank_only' | 'toshl_only'
   */
  function buildLedger(state) {
    const mv = state.movements || {}, matches = state.matches || {}, dec = state.decisions || {};
    const known = state.knownCats || null;
    const used = new Set(); const out = [];
    Object.values(matches).forEach((m) => {
      const ts = m.toshlIds.map((id) => mv[id]).filter(Boolean);
      const bs = m.bankIds.map((id) => mv[id]).filter(Boolean);
      if (!ts.length || !bs.length) return;
      ts.forEach((t) => used.add(t.id)); bs.forEach((b) => used.add(b.id));
      const status = m.status === 'possible' ? 'possible' : 'matched';
      const bankDesc = bs.map((b) => b.description).join(' + ');
      const bankComment = bs.map((b) => b.comment).filter(Boolean).join(' · ');
      const bankSum = bs.reduce((s, b) => s + b.cents, 0);
      ts.forEach((t, i) => {
        const id = ts.length === 1 ? 'm:' + m.id : 'm:' + m.id + ':' + i;
        const signed = ts.length === 1 ? bankSum : t.cents;
        out.push({
          id, matchId: m.id, date: t.date, bankDate: bs[0].date, cents: Math.abs(signed), sign: Math.sign(signed),
          treatment: signed > 0 ? 'income' : 'expense',
          category: t.category, subcategory: t.subcategory || '',
          description: t.description || bs[0].description, bankDescription: bankDesc, comment: bankComment,
          toshlCents: ts.reduce((s, x) => s + x.cents, 0), bankCents: bankSum,
          status, resolved: status === 'matched', reason: m.reason || '', account: t.account || '',
          toshlIds: m.toshlIds.slice(), bankIds: m.bankIds.slice(),
        });
      });
    });
    Object.values(mv).forEach((x) => {
      if (used.has(x.id)) return;
      if (x.source === 'bank') {
        const sug = suggestForBank(x.comment ? Object.assign({}, x, { description: x.description + ' ' + x.comment }) : x, state.rules, known);
        out.push({
          id: 'b:' + x.id, date: x.date, bankDate: x.date, cents: Math.abs(x.cents), sign: Math.sign(x.cents),
          treatment: sug.treatment, category: sug.category, subcategory: sug.subcategory,
          description: x.description, bankDescription: x.description, bankCategory: x.bankCategory, comment: x.comment || '',
          status: 'bank_only', resolved: false, suggestion: sug, toshlIds: [], bankIds: [x.id],
        });
      } else {
        out.push({
          id: 't:' + x.id, date: x.date, cents: Math.abs(x.cents), sign: Math.sign(x.cents),
          treatment: x.cents > 0 ? 'income' : 'expense', category: x.category, subcategory: x.subcategory || '',
          description: x.description || x.subcategory || x.category, status: 'toshl_only', resolved: false,
          account: x.account || '', toshlIds: [x.id], bankIds: [],
        });
      }
    });
    out.forEach((e) => {
      const d = dec[e.id];
      if (!d) return;
      ['category', 'subcategory', 'treatment', 'note'].forEach((k) => { if (d[k] !== undefined) e[k] = d[k]; });
      if (e.status !== 'possible') e.resolved = true;
    });
    // Un reembolso sin categoría no está resuelto (no se sabe de qué restarlo).
    out.forEach((e) => { if (e.treatment === 'refund' && !e.category) e.resolved = false; });
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
    return out;
  }

  function isPending(e) { return e.status === 'possible' || !e.resolved; }

  // ───────────────────────── Presupuesto ─────────────────────────

  /**
   * Relaciona subcategorías del presupuesto con etiquetas usadas que se escriben distinto
   * (mayúsculas, acentos, o idioma: 'electricity' ↔ 'electricidad'). Devuelve { subPresupuesto: etiqueta }.
   */
  function matchSubNames(budgetSubs, tags) {
    const out = {}; const used = new Set();
    const exact = new Set(tags.map(normText));
    budgetSubs.forEach((bs) => {
      const nb = normText(bs).replace(/ /g, '');
      if (exact.has(normText(bs)) && tags.includes(bs)) return;
      let best = null, bestLen = 0;
      tags.forEach((t) => {
        if (used.has(t) || budgetSubs.includes(t)) return;
        const nt = normText(t).replace(/ /g, '');
        if (nt === nb) { best = t; bestLen = 99; return; }
        let k = 0; while (k < nb.length && k < nt.length && nb[k] === nt[k]) k++;
        if (k >= 6 && k > bestLen) { best = t; bestLen = k; }
      });
      if (best) { out[bs] = best; used.add(best); }
    });
    return out;
  }

  function colorFor(pct) { return pct > 100 ? 'r' : pct >= 80 ? 'a' : 'g'; }

  /** Día habitual de pago deducido del último cargo de cada categoría fija. */
  function inferDueDays(entries, fixedCats) {
    const out = {};
    const set = new Set(fixedCats);
    entries.forEach((e) => {
      if (e.treatment !== 'expense' || !set.has(e.category)) return;
      const d = e.bankDate || e.date;
      [e.category, e.subcategory ? e.category + '|' + e.subcategory : null].forEach((k) => {
        if (k && (!out[k] || d > out[k].date)) out[k] = { date: d, day: Number(d.slice(8, 10)) };
      });
    });
    const res = {}; Object.keys(out).forEach((k) => { res[k] = out[k].day; });
    return res;
  }

  /**
   * Resumen del periodo: ingresos, gastos, ahorro, por pagar, disponible, previsión y avisos.
   * entries: libro del periodo. budget: { cats: { Cat: { cents, subs: { tag: cents } } } }.
   * meta: { Cat: { type: 'fixed'|'variable', dueDay, savings, estimate } }.
   */
  function summarize(entries, budget, meta, period, today) {
    meta = meta || {}; const bcats = (budget && budget.cats) || {};
    const closedMap = (budget && budget.closed) || {}; // { 'Cat': true, 'Cat|sub': true }: lo que queda no se gastará/pagará este periodo
    const live = entries.filter((e) => e.treatment !== 'excluded');
    let income = 0;
    const spent = {}, subSpent = {}, byCat = {};
    live.forEach((e) => {
      if (e.treatment === 'income') { income += e.cents; return; }
      if (e.treatment === 'refund' && !e.category) return; // aún no se sabe de qué categoría restarlo
      const c = e.category || 'Sin categoría';
      const v = e.treatment === 'refund' ? -e.cents : e.cents;
      spent[c] = (spent[c] || 0) + v;
      const s = e.subcategory || '';
      subSpent[c] = subSpent[c] || {}; subSpent[c][s] = (subSpent[c][s] || 0) + v;
      (byCat[c] = byCat[c] || []).push(e);
    });
    const totalDays = diffDays(period.start, period.end) + 1;
    const elapsed = today < period.start ? 0 : today > period.end ? totalDays : diffDays(period.start, today) + 1;
    const daysLeft = today >= period.start && today <= period.end ? diffDays(today, period.end) + 1 : 0;
    const elapsedPct = Math.round((elapsed / totalDays) * 100);

    const names = new Set([...Object.keys(bcats).filter((c) => (bcats[c].cents || 0) > 0), ...Object.keys(spent)]);
    const cats = [...names].map((name) => {
      const m = meta[name] || {};
      const original = (bcats[name] && bcats[name].cents) || 0;
      const s = spent[name] || 0;
      const subsB = (bcats[name] && bcats[name].subs) || {};
      const spentTags = Object.assign({}, subSpent[name] || {});
      const alias = matchSubNames(Object.keys(subsB), Object.keys(spentTags).filter(Boolean));
      Object.entries(alias).forEach(([bn, tag]) => { spentTags[bn] = (spentTags[bn] || 0) + spentTags[tag]; delete spentTags[tag]; });
      const subNames = new Set([...Object.keys(subsB), ...Object.keys(spentTags).filter(Boolean)]);
      const subs = [...subNames].map((sn) => {
        const sb = subsB[sn] || 0, ss = spentTags[sn] || 0, cl = !!closedMap[name + '|' + sn];
        return { name: sn, budget: cl ? Math.min(sb, Math.max(ss, 0)) : sb, originalBudget: sb, spent: ss, closed: cl, alias: alias[sn] || '' };
      }).sort((x, y) => y.budget - x.budget || y.spent - x.spent);
      const closed = !!closedMap[name];
      // Cerrada: el presupuesto efectivo es lo gastado (si te pasaste, se mantiene el exceso).
      let b = closed ? Math.min(original, Math.max(s, 0)) : original;
      if (!closed) subs.forEach((x) => { if (x.closed) b -= x.originalBudget - x.budget; });
      const pct = b > 0 ? Math.round((s / b) * 100) : (s > 0 ? (closed ? 100 : 999) : 0);
      return {
        name, type: m.type === 'fixed' ? 'fixed' : 'variable', savings: !!m.savings, estimate: !!m.estimate,
        dueDay: m.dueDay || null, subDue: m.subDue || {}, budget: b, originalBudget: original, closed, spent: s,
        remaining: b - s, pct, color: closed && s <= original ? 'n' : colorFor(pct), subs, entries: byCat[name] || [],
      };
    }).sort((a, b) => b.budget - a.budget || b.spent - a.spent);

    const fixed = cats.filter((c) => c.type === 'fixed'), variable = cats.filter((c) => c.type !== 'fixed');
    const pending = [], paid = [];
    fixed.forEach((c) => {
      if (c.budget <= 0) return;
      const tol = Math.max(100, Math.round(c.budget * 0.03));
      const catPending = c.budget - c.spent;
      const due = c.dueDay ? dueDateInPeriod(period, c.dueDay) : null;
      if (catPending <= tol) { paid.push(c); return; }
      // Un recibo ya cobrado este periodo cuenta como pagado aunque fuera más barato.
      if (c.estimate && c.spent > 0 && !c.subs.some((s) => s.budget > 0)) { paid.push(c); return; }
      let subTotal = 0;
      const hasSubBudgets = c.subs.some((s) => s.budget > 0);
      c.subs.forEach((s) => {
        if (s.budget <= 0 || s.spent > 0) return;
        const p = s.budget - s.spent;
        if (p > Math.max(100, Math.round(s.budget * 0.03))) {
          const sp = Math.min(p, catPending - subTotal); if (sp <= 0) return;
          const sd = c.subDue[s.name] ? dueDateInPeriod(period, c.subDue[s.name]) : due;
          subTotal += sp; pending.push({ category: c.name, sub: s.name, cents: sp, due: sd, estimate: c.estimate });
        }
      });
      const rest = catPending - subTotal;
      // Con subcategorías, el resto sin asignar es margen, no un pago previsto.
      if (!hasSubBudgets && rest > tol) pending.push({ category: c.name, sub: '', cents: rest, due, estimate: c.estimate });
      if (!pending.some((p) => p.category === c.name)) paid.push(c);
    });
    pending.sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : b.cents - a.cents);

    const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
    const spentTotal = sum(cats, (c) => c.spent);
    const savings = sum(cats.filter((c) => c.savings), (c) => c.spent);
    const pendingTotal = sum(pending, (p) => p.cents);
    const budgetTotal = sum(cats, (c) => c.budget);
    const varBudget = sum(variable, (c) => c.budget), varSpent = sum(variable, (c) => c.spent);
    const fixedSpent = sum(fixed, (c) => c.spent);
    const available = varBudget - varSpent;
    const perDay = daysLeft > 0 ? Math.round(Math.max(0, available) / daysLeft) : null;
    const margin = income - spentTotal - pendingTotal - Math.max(0, available);
    const varProjected = elapsed >= totalDays ? varSpent : elapsed > 0 ? Math.max(varSpent, Math.round((varSpent * totalDays) / elapsed)) : varBudget;
    const closing = income - fixedSpent - pendingTotal - varProjected;

    const alerts = [];
    variable.forEach((c) => {
      if (c.budget > 0 && c.spent > c.budget) alerts.push({ level: 'r', cat: c.name, text: 'pasado en ' + formatMoney(c.spent - c.budget) + ' (' + c.pct + ' %)', w: 1000 + c.pct });
      else if (c.budget > 0 && c.pct >= 80 && c.pct > elapsedPct + 5) alerts.push({ level: 'a', cat: c.name, text: 'al ' + c.pct + ' % con el ' + elapsedPct + ' % del periodo', w: 500 + c.pct });
      else if (c.budget === 0 && c.spent > 0) alerts.push({ level: 'a', cat: c.name, text: formatMoney(c.spent) + ' sin presupuesto', w: 400 });
    });
    alerts.sort((a, b) => b.w - a.w);
    const big = variable.filter((c) => c.budget > 0 && c.pct <= elapsedPct + 5 && c.spent <= c.budget).sort((a, b) => b.budget - a.budget)[0];
    if (big && alerts.length < 4) alerts.push({ level: 'g', cat: big.name, text: 'en ritmo: ' + big.pct + ' % gastado, quedan ' + formatMoney(big.remaining), w: 0 });

    return {
      income, spentTotal, consumption: spentTotal - savings, savings, balance: income - spentTotal,
      budgetTotal, pending, pendingTotal, paid, available, perDay, daysLeft, elapsed, totalDays, elapsedPct,
      margin, closing, cats, fixed, variable, varBudget, varSpent, fixedSpent, varProjected,
      fixedBudget: sum(fixed, (c) => c.budget), alerts: alerts.slice(0, 4),
    };
  }

  /**
   * Con cuánto acabarás el periodo según el saldo actual del banco (opcional).
   * ifBudget: si gastas justo lo que queda del presupuesto variable. atPace: si sigues al ritmo actual.
   */
  function projectBalance(s, balanceCents) {
    if (!Number.isFinite(balanceCents)) return null;
    const restBudget = Math.max(0, s.available);
    const restPace = Math.max(0, s.varProjected - s.varSpent);
    return {
      balance: balanceCents, pending: s.pendingTotal, restBudget, restPace,
      ifBudget: balanceCents - s.pendingTotal - restBudget,
      atPace: balanceCents - s.pendingTotal - restPace,
    };
  }

  /**
   * Histórico: items = [{ id, label, summary, pending }] ordenados del más antiguo al más reciente.
   * Devuelve filas por periodo, medias, mejor/peor periodo y la serie de cada categoría.
   */
  function buildHistory(items) {
    const rows = items.map((it) => {
      const s = it.summary;
      return {
        id: it.id, label: it.label, income: s.income, spent: s.consumption, savings: s.savings, total: s.spentTotal,
        balance: s.income - s.spentTotal, budget: s.budgetTotal, pct: s.budgetTotal ? Math.round((s.spentTotal / s.budgetTotal) * 100) : null,
        pending: it.pending || 0,
      };
    });
    const n = rows.length || 1;
    const avg = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) / n);
    const cats = {};
    items.forEach((it, i) => it.summary.cats.forEach((c) => {
      const e = cats[c.name] || (cats[c.name] = { name: c.name, type: c.type, series: rows.map(() => 0) });
      e.series[i] = c.spent;
    }));
    const categories = Object.values(cats).map((c) => {
      const total = c.series.reduce((a, b) => a + b, 0);
      const prev = c.series.slice(0, -1);
      const prevAvg = prev.length ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : null;
      return Object.assign(c, { avg: Math.round(total / n), last: c.series[c.series.length - 1] || 0, prevAvg });
    }).filter((c) => c.series.some((v) => v !== 0)).sort((a, b) => b.avg - a.avg);
    const byBalance = rows.slice().sort((a, b) => b.balance - a.balance);
    return {
      rows, categories, count: rows.length,
      avgIncome: avg('income'), avgSpent: avg('spent'), avgSavings: avg('savings'), avgBalance: avg('balance'),
      best: byBalance[0] || null, worst: byBalance[byBalance.length - 1] || null,
    };
  }

  /**
   * Visión compartida (hogar): tus cifras del periodo + sueldo y gastos de tu pareja (escritos a mano).
   * Tus gastos se usan como “previsto del periodo”: fijos (pagado o presupuesto) + variables al ritmo actual,
   * para poder sumarlos con los importes mensuales de tu pareja.
   */
  function householdSummary(s, partner) {
    partner = partner || { income: 0, items: [] };
    const finished = s.elapsed >= s.totalDays;
    const mine = {};
    s.cats.forEach((c) => {
      let v = c.spent;
      if (!finished) {
        if (c.type === 'fixed') v = Math.max(c.spent, c.budget);
        else if (s.elapsed > 0) v = Math.round((c.spent * s.totalDays) / s.elapsed);
      }
      if (v) mine[c.name] = v;
    });
    const theirs = {};
    (partner.items || []).forEach((it) => { const k = it.category || it.name || 'Otros'; theirs[k] = (theirs[k] || 0) + (it.cents || 0); });
    const names = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
    const cats = [...names].map((name) => ({ name, me: mine[name] || 0, partner: theirs[name] || 0, total: (mine[name] || 0) + (theirs[name] || 0) }))
      .sort((a, b) => b.total - a.total);
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const income = { me: s.income, partner: partner.income || 0 }; income.total = income.me + income.partner;
    const expenses = { me: sum(mine), partner: sum(theirs) }; expenses.total = expenses.me + expenses.partner;
    const balance = { me: income.me - expenses.me, partner: income.partner - expenses.partner, total: income.total - expenses.total };
    const pct = (a, t) => (t ? Math.round((a / t) * 100) : 0);
    return { income, expenses, balance, cats, mePctIncome: pct(income.me, income.total), mePctExpenses: pct(expenses.me, expenses.total), projected: !finished };
  }

  // ───────────────────────── Exportación ─────────────────────────

  const TOSHL_HEADER = ['Fecha', 'Cuenta', 'Categoría', 'Etiquetas', 'Cantidad de gasto', 'Cantidad de ingreso', 'Divisa', 'En la divisa principal', 'Divisa principal', 'Descripción'];

  /** Libro → CSV con el mismo formato que exporta Toshl (para reimportarlo). Excluidos fuera. */
  function toToshlCSV(entries) {
    const lines = [TOSHL_HEADER.map(csvField).join(',')];
    entries.filter((e) => e.treatment !== 'excluded').slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => {
      const [y, m, d] = e.date.split('-').map(Number);
      const amount = formatAmountCsv(e.cents);
      const isExp = e.treatment === 'expense';
      lines.push([
        d + '/' + m + '/' + String(y).slice(2), e.account || 'Banco', e.category || 'Sin categoría', e.subcategory || '',
        isExp ? amount : '0', isExp ? '0' : amount, 'EUR', (isExp ? '-' : '') + amount, 'EUR', e.description || '',
      ].map(csvField).join(','));
    });
    return lines.join('\n') + '\n';
  }

  function toLedgerJSON(entries, period) {
    return JSON.stringify({
      period: { id: period.id, start: period.start, end: period.end },
      exportedAt: new Date().toISOString(),
      entries: entries.map((e) => ({
        id: e.id, date: e.date, cents: e.cents, treatment: e.treatment, category: e.category, subcategory: e.subcategory,
        description: e.description, bankDescription: e.bankDescription || '', status: e.status, resolved: e.resolved,
      })),
    }, null, 2);
  }

  /** Presupuesto de la v2 (export de perfiles) → { cats, meta }. */
  function fromV2Profiles(json, profileId) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const profiles = data && data.profiles;
    if (!profiles) throw new Error('No es un archivo de perfiles de la v2.');
    const id = profileId || (profiles[data.activeProfileId] ? data.activeProfileId : Object.keys(profiles)[0]);
    const p = profiles[id]; const cats = {}, meta = {};
    Object.entries(p.budgets || {}).forEach(([name, b]) => {
      const subs = {}; Object.entries(b.tags || {}).forEach(([t, v]) => { subs[t] = parseAmount(v); });
      cats[name] = { cents: parseAmount(b.total || 0), subs };
      meta[name] = { type: b.type === 'fixed' ? 'fixed' : 'variable' };
    });
    return { name: p.name || id, cats, meta, profiles: Object.keys(profiles).map((k) => ({ id: k, name: profiles[k].name || k })) };
  }

  const Core = {
    parseAmount, formatMoney, formatAmountCsv,
    toISO, addDays, diffDays, dayOfWeek, isValidISO, todayISO, formatDate, formatDateShort, dowName, excelSerialToISO, parseDateAny, MONTHS,
    DEFAULT_PERIOD_CFG, naturalPeriodStart, getPeriod, periodIdForDate, shiftPeriodId, detectPeriodId, periodLabel, dueDateInPeriod,
    normText, tokens, similarity, merchantKey, ruleMatches,
    parseCSV, csvField, hashId, assignIds,
    parseBankRows, parseBankText, parseToshl, bizumMessage,
    matchMovements, pairKey, matchId,
    DEFAULT_RULES, suggestForBank, learnRule,
    buildLedger, isPending,
    colorFor, matchSubNames, inferDueDays, summarize, projectBalance, buildHistory, householdSummary,
    TOSHL_HEADER, toToshlCSV, toLedgerJSON, fromV2Profiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
