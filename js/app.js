/* app.js — Interfaz. Lee y escribe el estado, usa Core (funciones puras) y DB (IndexedDB). */
(function () {
  'use strict';
  const C = window.Core, DB = window.DB;
  const APP_VERSION = '1.7.0';

  // ───────────────────────── Utilidades ─────────────────────────
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c, o) => C.formatMoney(c, o);
  const signedMoney = (e) => {
    const v = e.sign < 0 ? -e.cents : e.cents;
    return '<span class="amt' + (v > 0 ? ' pos' : '') + '">' + money(v, { sign: true }) + '</span>';
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  /** Botón ⓘ para explicar una cifra (si las explicaciones están activadas). */
  const infoBtn = (key) => (S.settings && S.settings.explainOn !== false ? '<span class="info" role="button" tabindex="0" data-a="explain" data-v="' + esc(key) + '" aria-label="Cómo se calcula">ⓘ</span>' : '');
  /** Comentario del banco (p. ej. el mensaje de un Bizum). */
  const commentLine = (txt) => (txt ? '<div class="comment">💬 ' + esc(txt) + '</div>' : '');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const DEFAULT_CATS = {
    'Groceries': { icon: '🛒', type: 'variable' },
    'Eating out': { icon: '🍽️', type: 'variable' },
    'Extra': { icon: '🎯', type: 'variable' },
    'HouseHold': { icon: '🧹', type: 'variable' },
    'Clothing': { icon: '👕', type: 'variable' },
    'Transporte': { icon: '🚌', type: 'variable' },
    'Rent': { icon: '🏠', type: 'fixed' },
    'Health Insurance': { icon: '🏥', type: 'fixed' },
    'House Services': { icon: '💡', type: 'fixed', estimate: true },
    'Subscriptions': { icon: '📺', type: 'fixed' },
    'Investment': { icon: '📈', type: 'fixed', savings: true },
    'Salario': { icon: '💼', type: 'income' },
  };
  const ICON_GUESS = [[/GROCER|SUPER|ALIMENT/, '🛒'], [/EAT|RESTAU|COMIDA|CAFE/, '🍽️'], [/RENT|ALQUILER|HIPOTECA/, '🏠'],
    [/MEDIC|FARMA/, '💊'], [/HEALTH|SALUD/, '🏥'], [/INSUR|SEGURO/, '🛡️'], [/SUBSCR|SUSCRI/, '📺'], [/HOUSEHOLD|HOGAR/, '🧹'],
    [/CLOTH|ROPA/, '👕'], [/SERVIC|LUZ|AGUA|SUMINIS/, '💡'], [/TRANSP|COCHE|GASOL|CAR\b/, '🚌'], [/INVEST|AHORRO|SAVING/, '📈'],
    [/SALAR|NOMINA|INGRESO|INCOME/, '💼'], [/HAIR|PELU/, '💇'], [/KID|NIN|COLE|SCHOOL|GYM/, '🎒'], [/GIFT|REGALO/, '🎁'],
    [/TRAVEL|VIAJE|HOLIDAY/, '✈️'], [/PET|MASCOT/, '🐾'], [/EXTRA|OCIO|FUN/, '🎯']];
  const guessIcon = (name) => { const n = C.normText(name); const f = ICON_GUESS.find(([re]) => re.test(n)); return f ? f[1] : '📌'; };
  const TREAT_LABEL = { expense: 'Gasto', income: 'Ingreso', refund: 'Reembolso', excluded: 'Excluido' };
  const STATUS_PILL = {
    matched: '<span class="pill ok">✅</span>', possible: '<span class="pill warn">⚠️ posible</span>',
    bank_only: '<span class="pill bank">🏦 solo banco</span>', toshl_only: '<span class="pill toshl">📱 solo Toshl</span>',
  };

  // ───────────────────────── Estado ─────────────────────────
  const S = { settings: null, categories: null, budgets: null, rules: null, decisions: null, rejected: null, partner: null, savings: null, movements: {}, matches: {} };
  const UI = {
    tab: 'home', sub: null, periodId: null,
    conc: { group: 'pending', q: '', limit: 80 },
    mov: { q: '', kind: 'expense', cat: '', type: '', status: '', source: '', sort: 'date', limit: 150 },
    open: {}, draft: null, link: null, persisted: false, budgetView: 'period', histOpen: {}, homeView: 'me', back: null, savUnlocked: false, pinFails: 0, pinLockUntil: 0,
  };
  const L = { all: [], byPeriod: {}, known: [] };

  function defaultSettings() {
    return {
      startDay: 25, skipWeekends: true, skipHolidays: true, overrides: {},
      holidays: [{ date: '2026-12-25', name: 'Navidad' }, { date: '2026-12-26', name: 'Sant Esteve' }, { date: '2027-12-25', name: 'Navidad' }],
      lastBackupAt: 0, dataChangedAt: 0, balance: null,
    };
  }
  function periodCfg() {
    const s = S.settings;
    return { startDay: s.startDay, skipWeekends: s.skipWeekends, skipHolidays: s.skipHolidays, holidays: (s.holidays || []).map((h) => h.date), overrides: s.overrides || {} };
  }
  const period = (id) => C.getPeriod(id || UI.periodId, periodCfg());
  const today = () => C.todayISO();
  const entries = (id) => L.byPeriod[id || UI.periodId] || [];
  const catIcon = (name) => (S.categories[name] && S.categories[name].icon) || guessIcon(name || '');
  const isIncomeCat = (name) => S.categories[name] && S.categories[name].type === 'income';
  const budgetCats = () => Object.keys(S.categories).filter((c) => !isIncomeCat(c)).sort((a, b) => a.localeCompare(b, 'es'));

  function recompute() {
    const known = new Set(Object.keys(S.categories));
    let added = false;
    Object.values(S.movements).forEach((m) => {
      if (m.source === 'toshl' && m.category && !known.has(m.category)) {
        S.categories[m.category] = { icon: guessIcon(m.category), type: m.cents > 0 ? 'income' : 'variable' };
        known.add(m.category); added = true;
      }
    });
    Object.values(S.decisions).forEach((d) => {
      if (d.category && !known.has(d.category)) { S.categories[d.category] = { icon: guessIcon(d.category), type: 'variable' }; known.add(d.category); added = true; }
    });
    if (added) DB.setKV('categories', S.categories);
    L.known = [...known];
    L.all = C.buildLedger({ movements: S.movements, matches: S.matches, decisions: S.decisions, rules: S.rules, knownCats: L.known });
    const cfg = periodCfg(); L.byPeriod = {};
    L.all.forEach((e) => { e.periodId = C.periodIdForDate(e.date, cfg); (L.byPeriod[e.periodId] = L.byPeriod[e.periodId] || []).push(e); });
  }

  function metaForSummary() {
    const fixed = Object.keys(S.categories).filter((c) => S.categories[c].type === 'fixed');
    const inferred = C.inferDueDays(L.all, fixed);
    const meta = {};
    const anyBudget = budgetInfo().budget || { cats: {} };
    Object.entries(S.categories).forEach(([c, m]) => {
      const hasSubs = Object.keys(((anyBudget.cats || {})[c] || {}).subs || {}).length > 0;
      const subDue = {};
      Object.keys(inferred).forEach((k) => { if (k.startsWith(c + '|')) subDue[k.slice(c.length + 1)] = inferred[k]; });
      const inf = hasSubs ? null : inferred[c];
      meta[c] = Object.assign({}, m, { dueDay: m.dueDay || inf || null, dueInferred: !m.dueDay && !!inf, subDue });
    });
    return meta;
  }
  /** Presupuesto del periodo o, si no tiene, el último anterior (provisional). */
  function budgetInfo(id) {
    id = id || UI.periodId;
    if (S.budgets[id]) return { budget: S.budgets[id], from: null };
    const prev = Object.keys(S.budgets).filter((k) => k < id).sort().pop() || Object.keys(S.budgets).sort().pop();
    if (!prev) return { budget: null, from: null };
    const b = Object.assign({}, S.budgets[prev]); delete b.closed;
    return { budget: b, from: prev };
  }
  function summary(id) {
    const info = budgetInfo(id);
    return C.summarize(entries(id), info.budget || { cats: {} }, metaForSummary(), period(id), today());
  }
  function pendingCount(id) { return entries(id).filter(C.isPending).length; }

  // ───────────────────────── Persistencia ─────────────────────────
  async function load() {
    const { kv, movements, matches } = await DB.loadAll();
    S.settings = Object.assign(defaultSettings(), kv.settings || {});
    S.categories = kv.categories || clone(DEFAULT_CATS);
    S.budgets = kv.budgets || {};
    S.rules = kv.rules || C.DEFAULT_RULES.map((r, i) => Object.assign({ id: 'r_def' + i, manual: true }, r));
    S.decisions = kv.decisions || {};
    S.rejected = kv.rejected || {};
    S.partner = kv.partner || { name: 'Pareja', periods: {} };
    S.savings = kv.savings || { entries: [] };
    S.savingsPin = kv.savingsPin || null;
    S.movements = {}; movements.forEach((m) => { S.movements[m.id] = m; });
    // Movimientos importados antes de v1.3.2: sacar el mensaje de los Bizum de la descripción.
    const fixed = movements.filter((m) => m.source === 'bank' && !m.comment && C.bizumMessage(m.description));
    fixed.forEach((m) => { m.comment = C.bizumMessage(m.description); });
    if (fixed.length) await DB.putMany('movements', fixed);
    S.matches = {}; matches.forEach((m) => { S.matches[m.id] = m; });
    if (!kv.settings) await Promise.all([DB.setKV('settings', S.settings), DB.setKV('categories', S.categories), DB.setKV('rules', S.rules)]);
    if (!S.settings.migratedVariables141) {
      const changed = ['Groceries', 'Eating out', 'HouseHold'].filter((c) => S.categories[c] && S.categories[c].type === 'fixed');
      changed.forEach((c) => { S.categories[c].type = 'variable'; });
      S.settings.migratedVariables141 = true;
      await Promise.all([DB.setKV('settings', S.settings), DB.setKV('categories', S.categories)]);
      if (changed.length) setTimeout(() => toast(changed.join(', ') + ' ahora son Variable'), 800);
    }
  }
  function markChanged() { S.settings.dataChangedAt = Date.now(); }
  async function persistCore() {
    markChanged();
    await Promise.all([
      DB.replaceAll('matches', Object.values(S.matches)), DB.setKV('decisions', S.decisions), DB.setKV('rejected', S.rejected),
      DB.setKV('rules', S.rules), DB.setKV('settings', S.settings), DB.setKV('categories', S.categories), DB.setKV('budgets', S.budgets),
      DB.setKV('partner', S.partner), DB.setKV('savings', S.savings),
    ]);
  }
  const snapshot = () => JSON.stringify({ matches: S.matches, decisions: S.decisions, rejected: S.rejected, rules: S.rules, budgets: S.budgets, categories: S.categories, partner: S.partner, savings: S.savings });

  /** Cambia el estado, guarda, recalcula, pinta y ofrece “Deshacer”. */
  async function mutate(label, fn, opts) {
    const snap = snapshot();
    try { fn(); } catch (e) { toast('Error: ' + e.message); return; }
    await persistCore(); recompute(); render();
    if (!(opts && opts.silent)) toast(label, async () => {
      Object.assign(S, JSON.parse(snap)); await persistCore(); recompute(); render(); toast('Deshecho');
    });
  }

  // ───────────────────────── Avisos y hojas ─────────────────────────
  let toastTimer;
  function toast(text, undo) {
    const root = $('#toast-root');
    root.innerHTML = '<div class="toast" role="status"><span>' + esc(text) + '</span>' + (undo ? '<button data-a="toast-undo">Deshacer</button>' : '') + '</div>';
    toast.undo = undo || null;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { root.innerHTML = ''; toast.undo = null; }, undo ? 6000 : 3500);
  }
  function openSheet(title, body, foot, onClose) {
    $('#sheet-root').innerHTML = '<div class="sheet-wrap"><div class="dim" data-a="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="sheet-head"><div class="grab"></div><h2>' + esc(title) + '</h2><button class="x" data-a="sheet-close">Cerrar</button></div>' +
      '<div class="sheet-body" id="sheet-body">' + body + '</div>' + (foot ? '<div class="sheet-foot" id="sheet-foot">' + foot + '</div>' : '') + '</div></div>';
    openSheet.onClose = onClose || null;
    document.body.style.overflow = 'hidden';
    $('#toast-root').innerHTML = '';
  }
  function closeSheet() {
    $('#sheet-root').innerHTML = ''; document.body.style.overflow = '';
    const f = openSheet.onClose; openSheet.onClose = null; UI.link = null; if (f) f();
  }

  async function downloadFile(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    try {
      const file = new File([blob], name, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: name }); return true;
      }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); return true;
  }

  // ───────────────────────── Render general ─────────────────────────
  const TABS = [['home', '🏠', 'Inicio'], ['movs', '🧾', 'Movimientos'], ['conc', '🔗', 'Conciliar'], ['budget', '📊', 'Presupuesto'], ['settings', '⚙️', 'Ajustes']];

  function render() {
    const p = period();
    const pill = '<button class="period" data-a="period-sheet" aria-label="Cambiar periodo"><span class="dot' + (p.end < today() ? ' past' : '') + '"></span>' + esc(C.periodLabel(p)) + '</button>';
    const titles = { home: 'Inicio', movs: 'Movimientos', conc: 'Conciliar', budget: 'Presupuesto', settings: 'Ajustes' };
    let head;
    const backBtn = UI.back ? '<button class="back" data-a="nav-back">‹ ' + esc(titles[UI.back.tab]) + '</button>' : '';
    if (UI.back && UI.tab === 'movs') head = backBtn + pill;
    else if (UI.back && UI.tab === 'conc' && UI.sub !== 'import') head = backBtn + '<button class="btn ghost sm" data-a="go-import">📥 Importar</button>';
    else if (UI.tab === 'conc' && UI.sub === 'import') head = '<button class="back" data-a="import-back">‹ Conciliar</button>' + pill;
    else if (UI.tab === 'conc') head = '<h1>Conciliar</h1><button class="btn ghost sm" data-a="go-import">📥 Importar</button>';
    else if (UI.tab === 'settings') head = '<h1>Ajustes</h1>';
    else head = '<h1>' + titles[UI.tab] + '</h1>' + pill;
    $('#appbar').innerHTML = head;

    const pend = pendingCount();
    $('#tabbar').innerHTML = TABS.map(([id, ic, label]) => '<button class="tab' + (UI.tab === id ? ' on' : '') + '" data-a="tab" data-v="' + id + '"' + (UI.tab === id ? ' aria-current="page"' : '') + '>' +
      '<span class="ic">' + ic + '</span>' + label + (id === 'conc' && pend ? '<span class="badge">' + pend + '</span>' : '') + '</button>').join('');

    const pageTitle = UI.back && (UI.tab === 'movs' || (UI.tab === 'conc' && UI.sub !== 'import')) ? '<h1 style="font-size:28px;letter-spacing:-.02em;margin:0 0 10px">' + titles[UI.tab] + '</h1>' : '';
    const views = { home: renderHome, movs: renderMovs, conc: UI.sub === 'import' ? renderImport : renderConc, budget: renderBudget, settings: renderSettings };
    $('#view').innerHTML = pageTitle + views[UI.tab]();
    if (UI.tab === 'movs') renderMovList();
    if (UI.tab === 'conc' && UI.sub !== 'import') renderConcList();
  }

  // ───────────────────────── Inicio ─────────────────────────
  function needsBackup() {
    if (!Object.keys(S.movements).length) return false;
    const s = S.settings;
    if (!s.lastBackupAt) return true;
    return s.dataChangedAt > s.lastBackupAt && Date.now() - s.lastBackupAt > 7 * 864e5;
  }
  function backupBanner() {
    if (!needsBackup()) return '';
    const last = S.settings.lastBackupAt ? C.formatDate(C.todayISO(new Date(S.settings.lastBackupAt))) : 'nunca';
    return '<button class="banner info" data-a="backup">💾 <span class="grow"><b>Haz una copia de seguridad.</b> Última: ' + last + '. Tus datos solo están en este iPhone.</span><span class="chev">›</span></button>';
  }

  function renderHome() {
    if (!Object.keys(S.movements).length) {
      return '<div class="empty"><div class="big-ic">🔗</div><h2>Empieza importando</h2><p>Carga el archivo del banco y el export de Toshl. Todo se queda en este iPhone.</p>' +
        '<button class="btn" data-a="go-import">📥 Importar archivos</button>' +
        '<button class="btn plain" style="margin-top:8px" data-a="v2-sheet">Importar presupuesto de la v2</button></div>' + installHint();
    }
    const seg = '<div class="seg" style="margin-top:0">' + [['me', 'Yo'], ['home', 'Hogar'], ['savings', 'Ahorros']].map(([v, l]) =>
      '<button class="' + (UI.homeView === v ? 'on' : '') + '" data-a="home-view" data-v="' + v + '">' + l + '</button>').join('') + '</div>';
    if (UI.homeView === 'home') return seg + renderHousehold();
    if (UI.homeView === 'savings') return seg + renderSavings();
    const s = summary(); const p = period(); const info = budgetInfo();
    const pend = pendingCount();
    let h = seg + backupBanner();
    if (pend) h += '<button class="banner warn" data-a="go-pending">⚠️ <span class="grow"><b>' + pend + ' movimiento' + (pend > 1 ? 's' : '') + ' sin revisar.</b> Las cifras pueden cambiar.</span><span class="chev">›</span></button>';
    if (!info.budget) {
      h += '<button class="banner info" data-a="budget-edit">📊 <span class="grow"><b>Define tu presupuesto</b> para ver cuánto te queda y qué falta por pagar.</span><span class="chev">›</span></button>';
      h += '<div class="tiles"><div class="tile"><small>Ingresos</small><b>' + money(s.income) + '</b></div><div class="tile"><small>Gastado</small><b>' + money(s.spentTotal) + '</b></div></div>';
      return h + balanceCard(s, p) + alertsCard(s);
    }
    const avail = s.available;
    const base = Math.max(1, s.spentTotal + s.pendingTotal + Math.max(0, avail) + Math.max(0, s.margin));
    const w = (v) => (Math.max(0, v) / base * 100).toFixed(2) + '%';
    h += '<div class="hero"><div class="lbl">' + (avail >= 0 ? 'Te quedan para el día a día' : 'Te has pasado en el día a día') + ' ' + infoBtn('available') + '</div>' +
      '<div class="big' + (avail < 0 ? ' neg' : '') + '">' + money(avail) + '</div>' +
      '<div class="perday">' + (s.daysLeft > 0 ? s.daysLeft + ' día' + (s.daysLeft > 1 ? 's' : '') + ' · <b>≈ ' + money(s.perDay) + ' / día</b> ' + infoBtn('perDay') : (p.end < today() ? 'Periodo cerrado' : 'El periodo aún no ha empezado')) + '</div>' +
      '<div class="bar-stack" aria-hidden="true"><i style="width:' + w(s.spentTotal) + ';background:var(--seg-spent)"></i><i style="width:' + w(s.pendingTotal) + ';background:var(--seg-due)"></i><i style="width:' + w(avail) + ';background:var(--seg-free)"></i><i style="width:' + w(s.margin) + ';background:var(--seg-save)"></i></div>' +
      '<div class="legend"><span style="--c:var(--seg-spent)"><em>Gastado ' + infoBtn('spent') + '</em><b>' + money(s.spentTotal) + '</b></span><span style="--c:var(--seg-due)"><em>Por pagar ' + infoBtn('pending') + '</em><b>' + money(s.pendingTotal) + '</b></span>' +
      '<span style="--c:var(--seg-free)"><em>Disponible</em><b>' + money(Math.max(0, avail)) + '</b></span><span style="--c:var(--seg-save)"><em>' + (s.margin >= 0 ? 'Ahorro' : 'Déficit') + ' ' + infoBtn('margin') + '</em><b>' + money(s.margin) + '</b></span></div>' + closedVarLine(s) +
      '<div class="sub" style="margin-top:8px">' + (s.income ? 'Sobre ingresos de ' + money(s.income) : 'Aún no hay ingresos en este periodo') + (info.from ? ' · presupuesto de ' + esc(C.periodLabel(period(info.from))) : '') + '</div></div>';
    h += '<div class="tiles"><div class="tile"><small>Saldo hoy ' + infoBtn('balance') + '</small><b>' + money(s.balance, { sign: true }) + '</b><span class="s">ingresos − gastado</span></div>' +
      '<div class="tile"><small>Previsión al cierre ' + infoBtn('closing') + '</small><b style="color:var(' + (s.closing >= 0 ? '--ok' : '--bad') + ')">' + money(s.closing, { sign: true }) + '</b><span class="s">al ritmo actual</span></div></div>';
    h += balanceCard(s, p);
    h += '<div class="card"><div class="row-between"><h3>⏳ Por pagar ' + infoBtn('pending') + '</h3><span class="amt">' + money(s.pendingTotal) + '</span></div><div style="margin-top:6px">';
    if (!s.pending.length) h += '<p class="sub" style="padding:8px 0">Nada pendiente de los gastos fijos. 🎉</p>';
    const meta = metaForSummary();
    s.pending.forEach((it) => {
      const est = it.estimate ? '~' : '';
      const dueTxt = it.due ? (it.due === today() ? 'Hoy' : it.due === C.addDays(today(), 1) ? 'Mañana' : it.due < today() ? 'Pendiente desde el día ' + Number(it.due.slice(8)) : 'Habitual día ' + Number(it.due.slice(8))) : 'Sin día de pago';
      const inf = meta[it.category] && meta[it.category].dueInferred ? ' · deducido' : '';
      h += '<div class="due"><div class="d">' + (it.due ? C.dowName(it.due) + '<b>' + Number(it.due.slice(8)) + '</b>' : '—') + '</div><div class="n">' + catIcon(it.category) + ' ' + esc(it.category) + (it.sub ? ' › ' + esc(it.sub) : '') +
        '<div class="sub">' + dueTxt + inf + (it.estimate ? ' · estimado' : '') + '</div><button class="mini" data-a="close-item" data-v="' + esc(it.sub ? it.category + '|' + it.sub : it.category) + '">No se pagará este periodo</button></div><span class="amt">' + est + money(it.cents) + '</span></div>';
    });
    h += '</div>';
    h += closedFixedLines(s);
    if (s.paid.length) h += '<div class="sub" style="margin-top:6px">✓ Ya pagado: ' + s.paid.map((c) => esc(c.name)).join(', ') + ' · ' + money(s.paid.reduce((a, c) => a + c.spent, 0)) + '</div>';
    h += '</div>';
    return h + alertsCard(s);
  }
  function balanceCard(s, p) {
    const t = today();
    const b = S.settings.balance;
    if (t < p.start || t > p.end) {
      return '<button class="banner info" data-a="balance-sheet">💶 <span class="grow">Saldo del banco: ' + (b ? '<b>' + money(b.cents) + '</b> (' + C.formatDateShort(b.date) + ')' : 'sin poner') + '. El cálculo de cierre se ve en el periodo actual.</span><span class="chev">›</span></button>';
    }
    if (!b) return '<button class="banner info" data-a="balance-sheet">💶 <span class="grow"><b>¿Con cuánto acabarás el periodo?</b> Añade tu saldo del banco (opcional).</span><span class="chev">›</span></button>';
    const pr = C.projectBalance(s, b.cents);
    const stale = b.date < p.start;
    const origin = (b.source === 'banco' ? 'del banco' : 'tuyo') + ', ' + C.formatDateShort(b.date);
    return '<button class="card" style="width:100%;text-align:left;display:block" data-a="balance-sheet"><div class="row-between"><h3>💶 Al final del periodo ' + infoBtn('endBalance') + '</h3><span class="chev">›</span></div>' +
      '<div class="row-between" style="margin-top:8px;align-items:baseline"><span class="sub">Si cumples el presupuesto</span><b class="amt" style="font-size:22px;color:var(' + (pr.ifBudget >= 0 ? '--ok' : '--bad') + ')">' + money(pr.ifBudget) + '</b></div>' +
      '<div class="row-between" style="margin-top:4px"><span class="sub">Al ritmo actual</span><b class="amt">' + money(pr.atPace) + '</b></div>' +
      '<div class="sub" style="margin-top:8px">Saldo ' + money(b.cents) + ' (' + origin + ') − por pagar ' + money(pr.pending) + ' − resto del día a día ' + money(pr.restBudget) + '</div>' +
      (stale ? '<div class="sub" style="color:var(--warn);margin-top:4px">El saldo es de antes de este periodo. Actualízalo.</div>' : '') + '</button>';
  }
  function openBalanceSheet() {
    const b = S.settings.balance;
    openSheet('Saldo del banco', '<p class="sub">Opcional. Sirve para estimar con cuánto acabarás el periodo, incluido lo que tengas además del sueldo. Se actualiza solo al importar el archivo del banco (columna SALDO). Solo se guarda en este iPhone.</p>' +
      '<label class="field"><span>Saldo actual</span><input class="input" id="bal-in" inputmode="decimal" placeholder="Ej. 2.450,00" value="' + (b ? money(b.cents, { plain: true }).replace('\u2212', '-') : '') + '"></label>' +
      (b ? '<p class="note">Último dato: ' + money(b.cents) + ' del ' + C.formatDate(b.date) + ' (' + (b.source === 'banco' ? 'archivo del banco' : 'escrito a mano') + ').</p><button class="btn plain" style="margin-top:12px" data-a="balance-clear">Quitar saldo</button>' : ''),
    '<button class="btn" data-a="balance-save">Guardar</button>');
  }
  // ───────────────────────── Ahorros ─────────────────────────
  const SAV_LABEL = { deposit: 'Aportación', loan: 'Préstamo', withdrawal: 'Retirada' };
  // ── PIN de Ahorros: nunca está en el código. Se crea en el dispositivo y se guarda como hash PBKDF2 con sal aleatoria.
  const PIN_ITER = 150000;
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  async function pinHash(pin, saltB64, iter) {
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter || PIN_ITER, hash: 'SHA-256' }, key, 256);
    return b64(new Uint8Array(bits));
  }
  async function setPin(pin) {
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    S.savingsPin = { salt, iter: PIN_ITER, hash: await pinHash(pin, salt, PIN_ITER) };
    await DB.setKV('savingsPin', S.savingsPin);
  }
  async function checkPin(pin) { const p = S.savingsPin; return !!p && (await pinHash(pin, p.salt, p.iter)) === p.hash; }
  function lockSavings() { if (UI.savUnlocked) { UI.savUnlocked = false; if (UI.tab === 'home' && UI.homeView === 'savings') render(); } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) lockSavings(); });
  function renderPinGate() {
    const create = !S.savingsPin;
    const wait = Math.ceil((UI.pinLockUntil - Date.now()) / 1000);
    const inp = (id, ph) => '<input class="input" id="' + id + '" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="' + ph + '" style="text-align:center;font-size:28px;letter-spacing:12px;margin-top:10px" data-i="pin-in" data-v="' + (create ? 'create' : 'check') + '">';
    return '<div class="empty" style="padding-top:20px"><div class="big-ic">🔒</div><h2>' + (create ? 'Crea un PIN para Ahorros' : 'Ahorros protegidos') + '</h2>' +
      '<p>' + (create ? 'Elige 4 números. Solo se guarda en este iPhone y no aparece en el código.' : 'Introduce tu PIN de 4 números.') + '</p>' +
      (wait > 0 ? '<p style="color:var(--bad)">Demasiados intentos. Espera ' + wait + ' s.</p>' :
        inp('pin1', '••••') + (create ? inp('pin2', 'Repite') + '<button class="btn" style="margin-top:12px" data-a="pin-create">Guardar PIN</button>' : '')) +
      '<p class="sub" id="pin-msg" style="margin-top:10px;min-height:20px"></p>' +
      (create ? '' : '<button class="btn plain sm" style="margin-top:8px" data-a="pin-forgot">¿Olvidaste el PIN?</button>') + '</div>';
  }
  function renderSavings() {
    if (!UI.savUnlocked) return renderPinGate();
    const E = S.savings.entries; const sv = C.savingsSummary(E);
    if (!E.length) {
      return '<div class="empty"><div class="big-ic">🐷</div><h2>Tus ahorros</h2><p>Apunta lo que vas ahorrando. Si tomas algo prestado de tus ahorros, apúntalo como préstamo y márcalo cuando lo devuelvas.</p>' +
        '<button class="btn" data-a="sav-new" data-v="deposit">+ Primera aportación</button></div>';
    }
    const pct = sv.total > 0 ? Math.max(0, Math.min(100, Math.round((sv.available / sv.total) * 100))) : 0;
    let h = '<div class="hero"><div class="lbl">Ahorros disponibles</div><div class="big' + (sv.available < 0 ? ' neg' : '') + '">' + money(sv.available) + '</div>' +
      '<div class="bar-stack" aria-hidden="true"><i style="width:' + pct + '%;background:var(--seg-save)"></i><i style="width:' + (100 - pct) + '%;background:var(--seg-due)"></i></div>' +
      '<div class="legend"><span style="--c:var(--seg-save)"><em>Disponible</em><b>' + money(sv.available) + '</b></span><span style="--c:var(--seg-due)"><em>Prestado</em><b>' + money(sv.lent) + '</b></span></div>' +
      '<div class="sub" style="margin-top:8px">Total ahorrado ' + money(sv.total) + (sv.lent ? ' (incluye ' + money(sv.lent) + ' prestados)' : '') + '</div></div>';
    if (sv.accounts.length) {
      const max = Math.max(1, ...sv.accounts.map((a) => Math.abs(a.total)));
      h += '<div class="card"><div class="row-between"><h3>🏦 Dónde están</h3><button class="btn plain sm" data-a="sav-lock">🔒 Bloquear</button></div><div style="margin-top:6px">' + sv.accounts.map((a) =>
        '<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="row-between"><b>' + esc(a.name) + '</b><span class="amt">' + money(a.available) + '</span></div>' +
        '<div class="bar-stack" style="margin:6px 0 2px;height:8px"><i style="width:' + (Math.max(0, a.available) / max * 100).toFixed(1) + '%;background:var(--seg-save)"></i><i style="width:' + (a.lent / max * 100).toFixed(1) + '%;background:var(--seg-due)"></i></div>' +
        (a.lent ? '<div class="sub">prestado ' + money(a.lent) + ' · total ' + money(a.total) + '</div>' : '') + '</div>').join('') + '</div></div>';
    }
    h += '<div class="btn-row" style="margin:0 0 12px"><button class="btn sm" data-a="sav-new" data-v="deposit">+ Añadir</button><button class="btn ghost sm" data-a="sav-new" data-v="loan">↗ Préstamo</button><button class="btn plain sm" data-a="sav-new" data-v="withdrawal">− Retirar</button></div>';
    if (sv.pendingLoans.length) {
      h += '<div class="card"><div class="row-between"><h3>↗ Prestado pendiente</h3><span class="amt">' + money(sv.lent) + '</span></div><div style="margin-top:4px">' +
        sv.pendingLoans.map((e) => loanRow(e)).join('') + '</div><p class="note" style="margin:6px 0 0">Marca la casilla cuando lo devuelvas.</p></div>';
    }
    h += '<div class="sec-h"><b>Movimientos</b><span>' + E.length + '</span></div><div class="list">';
    E.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt || 0) < (b.createdAt || 0) ? 1 : -1)).forEach((e) => {
      const sign = e.type === 'deposit' ? '+' : '−';
      const col = e.type === 'deposit' ? 'var(--ok)' : e.type === 'loan' && e.repaidAt ? 'var(--muted)' : 'var(--text)';
      const src = e.from && S.savings.entries.find((x) => x.id === e.from);
      const state = e.type === 'loan' ? (e.repaidAt ? '<span class="pill ok">✓ devuelto ' + C.formatDateShort(e.repaidAt) + '</span>' : '<span class="pill warn">pendiente</span>') : '';
      h += '<button class="tx" data-a="sav-edit" data-v="' + esc(e.id) + '"><span class="ico">' + (e.type === 'deposit' ? '🐷' : e.type === 'loan' ? '↗' : '➖') + '</span>' +
        '<span class="m"><span class="t" style="display:block">' + esc(e.name || SAV_LABEL[e.type]) + '</span><span class="c" style="white-space:normal;flex-wrap:wrap">' + C.formatDate(e.date) + ' · ' + SAV_LABEL[e.type] + (src ? ' de “' + esc(src.name) + '”' : '') +
        ((e.account || (src && src.account)) ? ' · 🏦 ' + esc(e.account || src.account) : '') + ' ' + state + '</span>' +
        (e.comment ? '<span class="c" style="display:block;white-space:normal">💬 ' + esc(e.comment) + '</span>' : '') + '</span>' +
        '<span class="amt" style="color:' + col + (e.type === 'loan' && e.repaidAt ? ';text-decoration:line-through' : '') + '">' + sign + money(e.cents) + '</span></button>';
    });
    h += '</div><p class="note">Solo se guarda en este iPhone. No se mezcla con tu presupuesto ni con la conciliación.</p>';
    return h;
  }
  function loanRow(e) {
    const src = e.from && S.savings.entries.find((x) => x.id === e.from);
    return '<div class="due"><button class="ck' + (e.repaidAt ? ' on' : '') + '" style="width:30px;height:30px;min-width:30px" data-a="sav-repay" data-v="' + esc(e.id) + '" aria-label="Marcar como devuelto">' + (e.repaidAt ? '✓' : '') + '</button>' +
      '<div class="n">' + esc(e.name || 'Préstamo') + '<div class="sub">' + C.formatDate(e.date) + (src ? ' · de “' + esc(src.name) + '”' : '') + (e.comment ? ' · ' + esc(e.comment) : '') + '</div></div><span class="amt">' + money(e.cents) + '</span></div>';
  }
  function openSavingsForm(type, id) {
    const e = id ? S.savings.entries.find((x) => x.id === id) : { type, name: '', cents: 0, date: today(), comment: '', from: '' };
    if (!e) return;
    UI.savType = e.type;
    const deposits = S.savings.entries.filter((x) => x.type === 'deposit');
    const ph = { deposit: 'Ej. Inicio de ahorros', loan: 'Ej. Para el alquiler', withdrawal: 'Ej. Vacaciones' };
    const body = '<div class="seg" id="sav-type" style="grid-template-columns:repeat(3,1fr)">' + ['deposit', 'loan', 'withdrawal'].map((t) => '<button class="' + (e.type === t ? 'on' : '') + '" data-a="sav-type" data-v="' + t + '">' + { deposit: '+ Aportación', loan: '↗ Préstamo', withdrawal: '− Retirada' }[t] + '</button>').join('') + '</div>' +
      '<p class="sub" id="sav-help">' + savHelp(e.type) + '</p>' +
      '<label class="field"><span>Nombre</span><input class="input" id="sav-name" value="' + esc(e.name) + '" placeholder="' + ph[e.type] + '" autocomplete="off"></label>' +
      '<label class="field"><span>Importe</span><input class="input" id="sav-amount" inputmode="decimal" value="' + (e.cents ? money(e.cents, { plain: true }) : '') + '" placeholder="0,00"></label>' +
      '<label class="field"><span>Fecha</span><input class="input" type="date" id="sav-date" value="' + esc(e.date) + '"></label>' +
      '<label class="field"><span>Cuenta (dónde está el dinero)</span><input class="input" id="sav-account" value="' + esc(e.account || '') + '" list="sav-accounts" placeholder="Ej. N26, ING, Efectivo" autocomplete="off"></label>' +
      '<div class="chips">' + savAccounts().map((a) => '<button class="chip" data-a="sav-acc" data-v="' + esc(a) + '">' + esc(a) + '</button>').join('') + '</div>' +
      '<datalist id="sav-accounts">' + savAccounts().map((a) => '<option value="' + esc(a) + '">').join('') + '</datalist>' +
      '<label class="field"><span>Comentario</span><input class="input" id="sav-comment" value="' + esc(e.comment || '') + '" placeholder="Ej. primeros ahorros en N26" autocomplete="off"></label>' +
      '<label class="field' + (e.type === 'loan' && deposits.length ? '' : ' hidden') + '" id="sav-from-wrap"><span>¿De qué ahorro? (opcional)</span><select class="select" id="sav-from"><option value="">—</option>' +
      deposits.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === e.from ? ' selected' : '') + '>' + esc((d.name || 'Aportación') + ' · ' + money(d.cents)) + '</option>').join('') + '</select></label>' +
      (id && e.type === 'loan' ? '<label class="check" style="margin-top:10px"><input type="checkbox" id="sav-repaid"' + (e.repaidAt ? ' checked' : '') + '> Ya lo he devuelto</label>' : '') +
      (id ? '<button class="btn danger" style="margin-top:14px" data-a="sav-del" data-v="' + esc(id) + '">Borrar</button>' : '');
    openSheet(id ? 'Editar ahorro' : 'Nuevo apunte de ahorro', body, '<button class="btn" data-a="sav-save" data-v="' + esc(id || '') + '">Guardar</button>');
  }
  function savAccounts() {
    const set = new Set(S.savings.entries.map((x) => x.account).filter(Boolean));
    ['N26', 'ING', 'Efectivo'].forEach((a) => set.add(a));
    return [...set];
  }
  function savHelp(t) {
    return { deposit: 'Dinero que añades a tus ahorros.', loan: 'Dinero que tomas de tus ahorros y piensas devolver. Resta de lo disponible hasta que lo marques como devuelto.', withdrawal: 'Dinero que sacas para siempre (no se devuelve).' }[t];
  }

  // ───────────────────────── Hogar (visión compartida) ─────────────────────────
  function partnerInfo(id) {
    id = id || UI.periodId;
    const per = S.partner.periods || {};
    if (per[id]) return { data: per[id], from: null };
    const prev = Object.keys(per).filter((k) => k < id).sort().pop();
    return prev ? { data: per[prev], from: prev } : { data: null, from: null };
  }
  function renderHousehold() {
    const pi = partnerInfo(); const name = S.partner.name || 'Pareja';
    if (!pi.data) {
      return '<div class="empty"><div class="big-ic">🏡</div><h2>Visión compartida</h2><p>Añade el sueldo de ' + esc(name.toLowerCase() === 'pareja' ? 'tu pareja' : name) + ' y los gastos que paga para ver el total del hogar. Es opcional y solo se guarda en este iPhone.</p>' +
        '<button class="btn" data-a="partner-edit">Configurar</button></div>';
    }
    const s = summary(); const hh = C.householdSummary(s, pi.data);
    let h = '';
    if (pi.from) h += '<button class="banner info" data-a="partner-copy">📋 <span class="grow">Usando los datos de ' + esc(name) + ' de <b>' + esc(C.periodLabel(period(pi.from))) + '</b>. Toca para guardarlos en este periodo.</span><span class="chev">›</span></button>';
    const pendM = pendingCount(); if (pendM) h += '<p class="note" style="margin:0 4px 10px">⚠️ Tus cifras tienen ' + pendM + ' movimientos sin revisar.</p>';
    h += '<div class="hero"><div class="lbl">Saldo del hogar en el periodo</div><div class="big' + (hh.balance.total < 0 ? ' neg' : '') + '">' + money(hh.balance.total, { sign: true }) + '</div>' +
      '<div class="perday">Ingresos ' + money(hh.income.total) + ' − gastos ' + money(hh.expenses.total) + '</div>' + splitBar('Ingresos', hh.income, hh.mePctIncome, name) + splitBar('Gastos', hh.expenses, hh.mePctExpenses, name) +
      (hh.projected ? '<div class="sub" style="margin-top:8px">Tus gastos: previstos para el periodo (fijos + variables al ritmo actual). Los de ' + esc(name) + ': los que has escrito.</div>' : '') + '</div>';
    h += '<div class="tiles"><div class="tile"><small>Tu saldo</small><b style="color:var(' + (hh.balance.me >= 0 ? '--ok' : '--bad') + ')">' + money(hh.balance.me, { sign: true }) + '</b></div>' +
      '<div class="tile"><small>Saldo de ' + esc(name) + '</small><b style="color:var(' + (hh.balance.partner >= 0 ? '--ok' : '--bad') + ')">' + money(hh.balance.partner, { sign: true }) + '</b></div></div>';
    h += '<div class="sec-h"><b>Gastos del hogar por categoría</b><span>tú · ' + esc(name) + '</span></div><div class="list">' + hh.cats.map((c) =>
      '<div class="li2"><span class="l">' + catIcon(c.name) + ' ' + esc(c.name) + '<span class="sub" style="display:block">' + money(c.me) + ' · ' + money(c.partner) + '</span></span><b class="amt">' + money(c.total) + '</b></div>').join('') + '</div>';
    h += '<button class="btn ghost" style="margin-top:12px" data-a="partner-edit">✏️ Editar sueldo y gastos de ' + esc(name) + '</button>';
    return h;
  }
  function splitBar(label, v, mePct, name) {
    return '<div style="margin-top:12px"><div class="row-between sub"><span>' + label + '</span><span>Tú ' + money(v.me) + ' · ' + esc(name) + ' ' + money(v.partner) + '</span></div>' +
      '<div class="bar-stack" style="margin:6px 0 0"><i style="width:' + mePct + '%;background:var(--seg-free)"></i><i style="width:' + (100 - mePct) + '%;background:var(--toshl)"></i></div></div>';
  }
  function partnerRow(it) {
    return '<div class="subrow" style="flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)"><input class="input" style="flex:1 1 100%" data-p="name" value="' + esc(it.name || '') + '" placeholder="Concepto (ej. Guardería)">' +
      '<input class="input" style="flex:1;min-width:0" data-p="category" value="' + esc(it.category || '') + '" placeholder="Categoría" list="p-cats">' +
      '<input class="input" style="width:110px;flex:0 0 110px;text-align:right" inputmode="decimal" data-p="amount" value="' + (it.cents ? money(it.cents, { plain: true }) : '') + '" placeholder="0,00">' +
      '<button class="btn plain sm" data-a="p-del" aria-label="Quitar">✕</button></div>';
  }
  function openPartnerEditor() {
    const pi = partnerInfo(); const d = pi.data || { income: 0, items: [] };
    const body = '<p class="sub">Solo para la vista “Hogar”. Tu vista personal no cambia. Importes del periodo ' + esc(C.periodLabel(period())) + '.</p>' +
      '<label class="field"><span>Nombre</span><input class="input" id="p-name" value="' + esc(S.partner.name || 'Pareja') + '" autocomplete="off"></label>' +
      '<label class="field"><span>Sueldo / ingresos del periodo</span><input class="input" id="p-income" inputmode="decimal" value="' + (d.income ? money(d.income, { plain: true }) : '') + '" placeholder="0,00"></label>' +
      '<div class="field"><span>Gastos que paga (usa tus categorías para sumarlos por categoría)</span><div id="p-items">' + (d.items.length ? d.items : [{}]).map(partnerRow).join('') + '</div>' +
      '<button class="btn plain sm" style="margin-top:8px" data-a="p-add">+ Gasto</button></div>' +
      '<datalist id="p-cats">' + L.known.filter((c) => !isIncomeCat(c)).map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      (pi.data && !pi.from ? '<button class="btn plain" style="margin-top:14px" data-a="partner-clear">Quitar datos de este periodo</button>' : '');
    openSheet('Datos de tu pareja', body, '<button class="btn" data-a="partner-save">Guardar</button>');
  }
  function savePartnerEditor() {
    const inc = C.parseAmount($('#p-income').value);
    if (!Number.isFinite(inc) || inc < 0) { toast('Revisa el sueldo (ej. 2.100,00)'); return; }
    const items = []; let bad = false;
    $$('#p-items .subrow').forEach((r) => {
      const name = $('[data-p="name"]', r).value.trim(), category = $('[data-p="category"]', r).value.trim();
      const raw = $('[data-p="amount"]', r).value.trim(); if (!name && !raw) return;
      const c = C.parseAmount(raw); if (!Number.isFinite(c) || c <= 0) { bad = true; return; }
      items.push({ name: name || category || 'Gasto', category, cents: c });
    });
    if (bad) { toast('Revisa los importes de los gastos'); return; }
    const nm = $('#p-name').value.trim() || 'Pareja';
    closeSheet();
    mutate('Datos de ' + nm + ' guardados', () => { S.partner.name = nm; S.partner.periods[UI.periodId] = { income: inc, items }; });
  }

  function closedFixedLines(s) {
    const out = [];
    s.fixed.forEach((c) => {
      if (c.closed && c.originalBudget > c.spent) out.push([c.name, c.name, c.originalBudget - c.spent]);
      c.subs.forEach((x) => { if (x.closed && x.originalBudget > x.spent) out.push([c.name + '|' + x.name, c.name + ' › ' + x.name, x.originalBudget - x.spent]); });
    });
    if (!out.length) return '';
    return '<div style="margin-top:8px;padding-top:6px;border-top:1px dashed var(--line)">' + out.map(([k, label, cents]) =>
      '<div class="row-between sub" style="min-height:40px"><span>🚫 No se pagará: ' + esc(label) + ' (' + money(cents) + ')</span><button class="mini" data-a="reopen-key" data-v="' + esc(k) + '">Deshacer</button></div>').join('') + '</div>';
  }
  function closedVarLine(s) {
    const cl = s.variable.filter((c) => c.closed && c.originalBudget > c.spent);
    if (!cl.length) return '';
    return '<div style="margin-top:8px">' + cl.map((c) => '<div class="row-between sub" style="min-height:40px"><span>🚫 Cerrada: ' + esc(c.name) + ' (no cuentan ' + money(c.originalBudget - c.spent) + ')</span><button class="mini" data-a="reopen-key" data-v="' + esc(c.name) + '">Deshacer</button></div>').join('') + '</div>';
  }
  function alertsCard(s) {
    if (!s.alerts.length) return '';
    const dot = { r: '🔴', a: '🟠', g: '🟢' };
    return '<div class="card"><h3>👀 Para vigilar</h3><div style="margin-top:6px">' + s.alerts.map((a) =>
      '<button class="alert" data-a="cat-movs" data-v="' + esc(a.cat) + '">' + dot[a.level] + '<span><b>' + esc(a.cat) + '</b> ' + esc(a.text) + '</span></button>').join('') + '</div></div>';
  }
  function installHint() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return '';
    return '<p class="note" style="text-align:center">Consejo: en Safari pulsa Compartir → “Añadir a pantalla de inicio”. Así funciona sin conexión y el iPhone no borra tus datos.</p>';
  }

  // ───────────────────────── Movimientos ─────────────────────────
  function renderMovs() {
    const f = UI.mov; const E = entries();
    const cats = [...new Set(E.map((e) => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const sel = (key, label, opts) => '<select class="chip' + (f[key] ? ' on' : '') + '" data-c="mov-filter" data-v="' + key + '" aria-label="' + label + '"><option value="">' + label + '</option>' +
      opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (f[key] === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
    const kinds = [['expense', 'Gastos'], ['income', 'Ingresos'], ['refund', 'Reembolsos'], ['excluded', 'Excluidos'], ['all', 'Todos']];
    return '<div class="filters"><label class="search">🔍<input type="search" placeholder="Buscar comercio, nota, importe…" value="' + esc(f.q) + '" data-i="mov-q" enterkeyhint="search" autocomplete="off"></label>' +
      '<div class="chips">' + kinds.map(([k, l]) => '<button class="chip' + (f.kind === k ? ' on' : '') + '" data-a="mov-kind" data-v="' + k + '">' + l + '</button>').join('') +
      sel('cat', 'Categoría: todas', cats.map((c) => [c, c])) +
      sel('type', 'Fijo / variable', [['fixed', 'Fijos'], ['variable', 'Variables']]) +
      sel('status', 'Estado', [['pending', 'Pendientes'], ['matched', 'Conciliados'], ['possible', 'Posibles'], ['bank_only', 'Solo banco'], ['toshl_only', 'Solo Toshl']]) +
      sel('source', 'Fuente', [['bank', 'Banco'], ['toshl', 'Toshl'], ['both', 'En los dos']]) +
      '<select class="chip" data-c="mov-filter" data-v="sort" aria-label="Orden"><option value="date"' + (f.sort === 'date' ? ' selected' : '') + '>Fecha ↓</option><option value="amount"' + (f.sort === 'amount' ? ' selected' : '') + '>Importe ↓</option></select>' +
      '</div></div><div id="mov-list"></div>';
  }
  function filterMovs() {
    const f = UI.mov; const q = C.normText(f.q);
    let list = entries().filter((e) => {
      if (f.kind !== 'all' && e.treatment !== f.kind) return false;
      if (f.cat && e.category !== f.cat) return false;
      if (f.type) { const t = (S.categories[e.category] || {}).type || 'variable'; if (t !== f.type) return false; }
      if (f.status) { if (f.status === 'pending' ? !C.isPending(e) : e.status !== f.status) return false; }
      if (f.source) {
        const hb = e.bankIds.length > 0, ht = e.toshlIds.length > 0;
        if (f.source === 'bank' && !hb) return false; if (f.source === 'toshl' && !ht) return false; if (f.source === 'both' && !(hb && ht)) return false;
      }
      if (q) {
        const hay = C.normText([e.description, e.bankDescription, e.comment, e.category, e.subcategory, money(e.cents, { plain: true })].join(' '));
        if (!q.split(' ').every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    if (f.sort === 'amount') list = list.slice().sort((a, b) => b.cents - a.cents);
    return list;
  }
  function renderMovList() {
    const el = $('#mov-list'); if (!el) return;
    const list = filterMovs(); const f = UI.mov;
    const total = list.reduce((s, e) => s + (e.treatment === 'expense' ? -e.cents : e.treatment === 'excluded' ? 0 : e.cents), 0);
    let h = '<div class="resultbar"><span>' + list.length + ' movimiento' + (list.length === 1 ? '' : 's') + '</span><span>Total ' + money(total, { sign: true }) + '</span></div>';
    if (!list.length) { el.innerHTML = h + '<p class="empty muted">No hay movimientos con estos filtros.</p>'; return; }
    const shown = list.slice(0, f.limit);
    const row = (e) => '<button class="tx' + (e.treatment === 'excluded' ? ' excluded' : '') + '" data-a="edit-entry" data-v="' + esc(e.id) + '"><span class="ico">' + (e.treatment === 'refund' ? '↩︎' : catIcon(e.category)) + '</span>' +
      '<span class="m"><span class="t" style="display:block">' + esc(e.description || '(sin descripción)') + '</span>' + (e.comment ? '<span class="c" style="display:block;overflow:hidden;text-overflow:ellipsis">💬 ' + esc(e.comment) + '</span>' : '') + '<span class="c"><span class="cat">' + esc(e.category || 'Sin categoría') + (e.subcategory ? ' › ' + esc(e.subcategory) : '') +
      (e.treatment === 'refund' ? ' · reembolso' : '') + '</span>' + (STATUS_PILL[e.status] || '') + (!e.resolved && e.status !== 'possible' ? '<span class="pill mut">sin revisar</span>' : '') + '</span></span>' + signedMoney(e) + '</button>';
    if (f.sort === 'date') {
      const days = {}; const order = [];
      shown.forEach((e) => { if (!days[e.date]) { days[e.date] = []; order.push(e.date); } days[e.date].push(e); });
      order.forEach((d) => {
        const sum = days[d].reduce((s, e) => s + (e.treatment === 'expense' ? -e.cents : e.treatment === 'excluded' ? 0 : e.cents), 0);
        h += '<div class="day-h"><span>' + capital(C.dowName(d)) + ' ' + C.formatDateShort(d) + '</span><span>' + money(sum, { sign: true }) + '</span></div><div class="list">' + days[d].map(row).join('') + '</div>';
      });
    } else h += '<div class="list">' + shown.map(row).join('') + '</div>';
    if (list.length > shown.length) h += '<button class="btn plain more" data-a="mov-more">Mostrar más (' + (list.length - shown.length) + ')</button>';
    h += '<p class="note">Toca un movimiento para cambiar su categoría, subcategoría o excluirlo.</p>';
    el.innerHTML = h;
  }

  // ───────────────────────── Conciliar ─────────────────────────
  function concGroups(E) {
    return {
      pending: E.filter(C.isPending), possible: E.filter((e) => e.status === 'possible'),
      bank: E.filter((e) => e.status === 'bank_only'), toshl: E.filter((e) => e.status === 'toshl_only'),
      matched: E.filter((e) => e.status === 'matched'), all: E,
    };
  }
  function renderConc() {
    const E = entries();
    if (!Object.keys(S.movements).length) return '<div class="empty"><div class="big-ic">📥</div><h2>Sin datos todavía</h2><p>Importa el archivo del banco y el de Toshl para conciliarlos.</p><button class="btn" data-a="go-import">Importar archivos</button></div>';
    const g = concGroups(E); const c = UI.conc;
    const chip = (k, label) => '<button class="chip' + (c.group === k ? ' on' : '') + '" data-a="conc-group" data-v="' + k + '">' + label + ' <span class="c">' + g[k].length + '</span></button>';
    return '<div class="filters"><label class="search">🔍<input type="search" placeholder="Buscar…" value="' + esc(c.q) + '" data-i="conc-q" autocomplete="off"></label><div class="chips">' +
      chip('pending', 'Pendientes') + chip('possible', '⚠️ Posibles') + chip('bank', '🏦 Solo banco') + chip('toshl', '📱 Solo Toshl') + chip('matched', '✅ Conciliados') + chip('all', 'Todos') +
      '</div></div><div id="conc-list"></div>';
  }
  function renderConcList() {
    const el = $('#conc-list'); if (!el) return;
    const c = UI.conc; const q = C.normText(c.q);
    let E = entries();
    if (q) E = E.filter((e) => { const hay = C.normText([e.description, e.bankDescription, e.comment, e.category, e.subcategory, money(e.cents, { plain: true })].join(' ')); return q.split(' ').every((w) => hay.includes(w)); });
    const g = concGroups(E);
    const sections = {
      pending: [['⚠️ Posibles', g.possible], ['🏦 Solo en banco', g.bank.filter((e) => !e.resolved)], ['📱 Solo en Toshl', g.toshl.filter((e) => !e.resolved)]],
      possible: [['⚠️ Posibles', g.possible]], bank: [['🏦 Solo en banco', g.bank]], toshl: [['📱 Solo en Toshl', g.toshl]],
      matched: [['✅ Conciliados', g.matched]],
      all: [['⚠️ Posibles', g.possible], ['🏦 Solo en banco', g.bank], ['📱 Solo en Toshl', g.toshl], ['✅ Conciliados', g.matched]],
    }[c.group];
    let h = ''; let shownCount = 0; let hidden = 0;
    sections.forEach(([title, list]) => {
      if (!list.length) return;
      const items = []; const seen = new Set();
      list.forEach((e) => { if (e.status === 'possible') { if (seen.has(e.matchId)) return; seen.add(e.matchId); } items.push(e); });
      h += '<div class="group-h"><span>' + title + '</span><span class="n">' + items.length + '</span></div>';
      items.forEach((e) => {
        if (shownCount >= c.limit) { hidden++; return; }
        shownCount++;
        h += e.status === 'possible' ? possibleCard(e) : e.status === 'bank_only' ? bankCard(e) : e.status === 'toshl_only' ? toshlCard(e) : matchedCard(e);
      });
    });
    if (!h) h = c.group === 'pending' ? '<div class="empty"><div class="big-ic">🎉</div><h2>Todo revisado</h2><p>No queda nada pendiente en este periodo.</p></div>' : '<p class="empty muted">Nada en este grupo.</p>';
    if (hidden) h += '<button class="btn plain more" data-a="conc-more">Mostrar más (' + hidden + ')</button>';
    if (entries().length) {
      h += '<div class="btn-row" style="margin-top:16px"><button class="btn plain sm" data-a="export-csv">⬇️ CSV para Toshl</button><button class="btn plain sm" data-a="export-json">⬇️ JSON</button></div>' +
        '<button class="btn plain sm" style="width:100%;margin-top:8px" data-a="rematch">🔄 Volver a emparejar lo pendiente</button>';
    }
    el.innerHTML = h;
  }
  function mvLine(id) {
    const m = S.movements[id]; if (!m) return '';
    const isB = m.source === 'bank';
    const cm = isB && m.comment ? '<span class="comment" style="grid-column:1 / -1;margin:0 0 2px 0">💬 ' + esc(m.comment) + '</span>' : '';
    return '<span class="l"><span class="pill ' + (isB ? 'bank' : 'toshl') + '">' + (isB ? 'Banco' : 'Toshl') + '</span><span>' + C.formatDateShort(m.date) + ' · ' +
      esc(isB ? m.description : [m.category, m.subcategory].filter(Boolean).join(' › ') + (m.description ? ' · ' + m.description : '')) + '</span></span><span class="amt">' + money(m.cents) + '</span>' + cm;
  }
  function possibleCard(e) {
    const m = S.matches[e.matchId];
    const tSum = m.toshlIds.reduce((s, id) => s + (S.movements[id] ? S.movements[id].cents : 0), 0);
    const bSum = m.bankIds.reduce((s, id) => s + (S.movements[id] ? S.movements[id].cents : 0), 0);
    const diff = Math.abs(tSum - bSum);
    const tag = diff ? '<span class="pill warn">±' + money(diff) + '</span>' : '<span class="pill warn">Suma</span>';
    return '<div class="mv"><div class="top"><div class="desc">' + esc(e.description || e.category) + ' · ' + esc(m.reason || 'posible') + '</div>' + tag + '</div>' +
      '<div class="pair">' + m.toshlIds.map((id) => mvLine(id)).join('') + m.bankIds.map((id) => mvLine(id)).join('') + '</div>' +
      '<div class="actions"><button class="yes" data-a="confirm-match" data-v="' + esc(m.id) + '">✓ Confirmar</button><button class="chg" data-a="change-match" data-v="' + esc(m.id) + '">⇄ Cambiar…</button><button class="no" data-a="reject-match" data-v="' + esc(m.id) + '">✕ Rechazar</button></div></div>';
  }
  function topCats(exclude) {
    const count = {};
    L.all.forEach((e) => { if (e.treatment === 'expense' && e.category) count[e.category] = (count[e.category] || 0) + 1; });
    const list = Object.keys(count).sort((a, b) => count[b] - count[a]);
    budgetCats().forEach((c) => { if (!list.includes(c)) list.push(c); });
    return list.filter((c) => c !== exclude && !isIncomeCat(c)).slice(0, 4);
  }
  function catOptions(selected, includeIncome) {
    const cats = L.known.filter((c) => includeIncome || !isIncomeCat(c)).sort((a, b) => a.localeCompare(b, 'es'));
    return '<option value="">Elige categoría…</option>' + cats.map((c) => '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(catIcon(c) + ' ' + c) + '</option>').join('');
  }
  function bankCard(e) {
    const head = '<div class="top"><div><div class="desc">' + esc(e.description) + '</div><div class="meta">' + C.formatDateShort(e.date) + (e.bankCategory ? ' · Banco: ' + esc(e.bankCategory) : '') + '</div></div>' + signedMoney(e) + '</div>' + commentLine(e.comment);
    if (e.resolved) {
      return '<div class="mv">' + head + '<div class="resolved-line"><span>' + (e.treatment === 'excluded' ? '🚫 Excluido' : '→ ' + esc(TREAT_LABEL[e.treatment]) + (e.category ? ' · <b>' + esc(e.category) + '</b>' : '') + (e.subcategory ? ' › ' + esc(e.subcategory) : '')) +
        '</span><button class="btn plain sm" data-a="edit-entry" data-v="' + esc(e.id) + '">Cambiar</button></div></div>';
    }
    const sug = e.suggestion || {};
    const src = { regla: 'regla “' + esc(sug.pattern) + '”', historial: 'como otras veces', banco: 'categoría del banco', defecto: 'por defecto' }[sug.source] || '';
    let body = '';
    if (e.sign > 0) {
      const isRefund = e.treatment === 'refund';
      body = '<div class="seg"><button class="' + (isRefund ? 'on' : '') + '" data-a="set-treat" data-v="' + esc(e.id) + '|refund">↩︎ Reembolso</button><button class="' + (e.treatment === 'income' ? 'on' : '') + '" data-a="set-treat" data-v="' + esc(e.id) + '|income">Ingreso</button><button class="' + (e.treatment === 'excluded' ? 'on' : '') + '" data-a="set-treat" data-v="' + esc(e.id) + '|excluded">Excluir</button></div>';
      if (isRefund) body += '<label class="field" style="margin-top:0"><span>Restar de la categoría</span><select class="select" data-c="refund-cat" data-v="' + esc(e.id) + '">' + catOptions(e.category) + '</select></label>';
      else body += '<div class="actions"><button class="pri" data-a="accept-sug" data-v="' + esc(e.id) + '">✓ Aceptar como ' + esc(TREAT_LABEL[e.treatment].toLowerCase()) + (e.category ? ' · ' + esc(e.category) : '') + '</button></div>';
      return '<div class="mv">' + head + body + '</div>';
    }
    if (e.treatment === 'excluded') {
      body = '<div class="suggest"><span class="t">Sugerido: <b>Excluir</b> · ' + src + '</span><button class="btn" data-a="accept-sug" data-v="' + esc(e.id) + '" aria-label="Aceptar">✓</button></div>' +
        '<div class="chips"><button class="chip" data-a="edit-entry" data-v="' + esc(e.id) + '">Es un gasto…</button><button class="chip" data-a="link" data-v="' + esc(e.id) + '">⇄ Enlazar con Toshl</button></div>';
    } else {
      body = (e.category ? '<div class="suggest"><span class="t">Sugerido: <b>' + esc(e.category) + (e.subcategory ? ' › ' + esc(e.subcategory) : '') + '</b> <span class="sub">· ' + src + '</span></span><button class="btn" data-a="accept-sug" data-v="' + esc(e.id) + '" aria-label="Aceptar">✓</button></div>' : '') +
        '<div class="chips">' + topCats(e.category).map((cat) => '<button class="chip" data-a="quick-cat" data-v="' + esc(e.id) + '|' + esc(cat) + '">' + esc(cat) + '</button>').join('') +
        '<button class="chip" data-a="edit-entry" data-v="' + esc(e.id) + '">Otra…</button><button class="chip" data-a="quick-exclude" data-v="' + esc(e.id) + '">Excluir</button><button class="chip" data-a="link" data-v="' + esc(e.id) + '">⇄ Enlazar con Toshl</button></div>';
    }
    return '<div class="mv">' + head + body + '</div>';
  }
  function toshlCard(e) {
    const head = '<div class="top"><div><div class="desc">' + esc(e.description) + '</div><div class="meta">' + C.formatDateShort(e.date) + ' · ' + esc(e.category) + (e.subcategory ? ' › ' + esc(e.subcategory) : '') + (e.account ? ' · ' + esc(e.account) : '') + '</div></div>' + signedMoney(e) + '</div>';
    if (e.resolved) {
      return '<div class="mv">' + head + '<div class="resolved-line"><span>' + (e.treatment === 'excluded' ? '🚫 Excluido' : '✓ Mantenido (efectivo u otra tarjeta)') + '</span><button class="btn plain sm" data-a="edit-entry" data-v="' + esc(e.id) + '">Cambiar</button></div></div>';
    }
    return '<div class="mv">' + head + '<div class="actions"><button data-a="toshl-keep" data-v="' + esc(e.id) + '">Mantener</button><button data-a="quick-exclude" data-v="' + esc(e.id) + '">Excluir</button><button class="chg" data-a="link" data-v="' + esc(e.id) + '">⇄ Enlazar…</button></div></div>';
  }
  function matchedCard(e) {
    const days = e.bankDate && e.bankDate !== e.date ? ' (' + (C.diffDays(e.date, e.bankDate) > 0 ? '+' : '') + C.diffDays(e.date, e.bankDate) + ' d)' : '';
    return '<button class="mv" style="width:100%;text-align:left;display:block" data-a="edit-entry" data-v="' + esc(e.id) + '"><div class="top"><div><div class="desc">' + esc(e.description) + ' · ' + esc(e.category) + (e.subcategory ? ' › ' + esc(e.subcategory) : '') + '</div>' +
      '<div class="meta">Toshl ' + C.formatDateShort(e.date) + ' ↔ Banco ' + C.formatDateShort(e.bankDate) + days + ' · ' + esc(e.bankDescription) + '</div></div>' + signedMoney(e) + '</div>' + commentLine(e.comment) + '</button>';
  }

  // ───────────────────────── Importar ─────────────────────────
  function newDraft() { return { bank: null, toshl: null, bankMode: 'file', toshlMode: 'file', periodId: null }; }
  function draftResult(r, label) {
    if (!r) return '';
    if (r.error) return '<div class="file-res err"><span class="fi">⚠️</span><div><b>No se pudo leer</b><br><span class="sub">' + esc(r.error) + '</span></div></div>';
    const ds = r.movements.map((m) => m.date).sort();
    return '<div class="file-res ok"><span class="fi">✅</span><div><b>' + esc(r.name || label) + '</b><br><span class="sub">' + r.movements.length + ' movimientos' +
      (ds.length ? ' · ' + C.formatDate(ds[0]) + ' – ' + C.formatDate(ds[ds.length - 1]) : '') + (r.skipped ? ' · ' + r.skipped + ' filas ignoradas' : '') +
      (r.kind === 'bank' && r.balance ? '<br>Saldo: ' + money(r.balance.cents) + ' el ' + C.formatDate(r.balance.date) : '') +
      (r.kind === 'bank' ? '<br>Cuenta y titular ignorados (no se guardan)' : '') + '</span></div></div>';
  }
  function renderImport() {
    const d = UI.draft || (UI.draft = newDraft());
    const card = (kind, icon, title, ext, accept, ph) => {
      const mode = d[kind + 'Mode'];
      return '<div class="card"><div class="row-between"><h3>' + icon + ' ' + title + '</h3><span class="pill ' + (kind === 'bank' ? 'bank' : 'toshl') + '">' + ext + '</span></div>' +
        '<div class="seg"><button class="' + (mode === 'file' ? 'on' : '') + '" data-a="imp-mode" data-v="' + kind + '|file">Elegir archivo</button><button class="' + (mode === 'paste' ? 'on' : '') + '" data-a="imp-mode" data-v="' + kind + '|paste">Pegar</button></div>' +
        (mode === 'file'
          ? '<label class="btn ghost file-btn">📂 Elegir de Archivos<input type="file" accept="' + accept + '" data-c="imp-file" data-v="' + kind + '"></label>'
          : '<textarea class="input" placeholder="' + esc(ph) + '" data-i="imp-paste" data-v="' + kind + '" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>') +
        '<div id="res-' + kind + '">' + draftResult(d[kind], title) + '</div></div>';
    };
    let h = '<h1 style="font-size:28px;letter-spacing:-.02em;margin:4px 0 12px">Importar</h1>';
    h += card('bank', '🏦', 'Banco', '.xls', '.xls,.xlsx,.csv,.txt,application/vnd.ms-excel', 'Copia las filas en Excel o Numbers (incluida la cabecera F. VALOR …) y pégalas aquí');
    h += card('toshl', '📱', 'Toshl', '.csv', '.csv,text/csv,text/plain', 'Pega aquí el contenido del CSV de Toshl');
    h += '<div id="imp-period">' + importPeriodCard() + '</div>';
    h += '<button class="btn" data-a="imp-commit"' + (canCommit() ? '' : ' disabled') + ' id="imp-commit">Conciliar →</button>';
    h += '<p class="note">Si importas otra vez el mismo archivo, no se duplica nada. Lo ya revisado se mantiene.</p>';
    return h;
  }
  const canCommit = () => { const d = UI.draft; return !!d && ((d.bank && !d.bank.error && d.bank.movements.length) || (d.toshl && !d.toshl.error && d.toshl.movements.length)); };
  function importPeriodCard() {
    const d = UI.draft; if (!canCommit()) return '';
    const dates = (d.toshl && !d.toshl.error && d.toshl.movements.length ? d.toshl : d.bank).movements.map((m) => m.date);
    const all = [].concat(d.bank && !d.bank.error ? d.bank.movements : [], d.toshl && !d.toshl.error ? d.toshl.movements : []).map((m) => m.date);
    const cfg = periodCfg();
    const detected = C.detectPeriodId(dates, cfg);
    if (!d.periodId) d.periodId = detected;
    const p = period(d.periodId);
    const ids = [...new Set(all.map((x) => C.periodIdForDate(x, cfg)))].sort();
    const outside = all.filter((x) => x < p.start || x > p.end).length;
    return '<div class="card"><h3>📅 Periodo ' + (d.periodId === detected ? 'detectado' : 'elegido') + '</h3>' +
      '<div class="kv" style="margin-top:6px"><span>Desde</span><b>' + C.dowName(p.start) + ' ' + C.formatDate(p.start) + '</b></div>' +
      '<div class="kv"><span>Hasta</span><b>' + C.dowName(p.end) + ' ' + C.formatDate(p.end) + '</b></div>' +
      (outside ? '<div class="kv"><span>Fuera del periodo</span><span class="sub">' + outside + ' movimientos (se guardan en su periodo)</span></div>' : '') +
      (ids.length > 1 ? '<label class="field"><span>Cambiar periodo</span><select class="select" data-c="imp-period">' + ids.map((id) => '<option value="' + id + '"' + (id === d.periodId ? ' selected' : '') + '>' + esc(C.periodLabel(period(id))) + '</option>').join('') + '</select></label>' : '') + '</div>';
  }
  async function readBankFile(file) {
    const name = file.name.toLowerCase();
    if (/\.(csv|txt|tsv)$/.test(name)) return C.parseBankText(await file.text());
    if (typeof XLSX === 'undefined') return { movements: [], error: 'Falta el lector de Excel (vendor/xlsx.full.min.js).' };
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return C.parseBankRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }));
  }
  function refreshImport() {
    const d = UI.draft;
    ['bank', 'toshl'].forEach((k) => { const el = $('#res-' + k); if (el) el.innerHTML = draftResult(d[k], k === 'bank' ? 'Banco' : 'Toshl'); });
    d.periodId = null;
    $('#imp-period').innerHTML = importPeriodCard();
    $('#imp-commit').disabled = !canCommit();
  }
  function runMatching() {
    const used = new Set();
    Object.values(S.matches).forEach((m) => { m.toshlIds.forEach((i) => used.add(i)); m.bankIds.forEach((i) => used.add(i)); });
    const free = Object.values(S.movements).filter((m) => !used.has(m.id));
    const res = C.matchMovements(free.filter((m) => m.source === 'bank'), free.filter((m) => m.source === 'toshl'), { rejected: S.rejected });
    const n = { auto: 0, possible: 0 };
    res.forEach((m) => { m.createdAt = Date.now(); S.matches[m.id] = m; n[m.status === 'auto' ? 'auto' : 'possible']++; if (m.status === 'auto') learnFromMatch(m); });
    return n;
  }
  function learnFromMatch(m) {
    if (m.toshlIds.length !== 1) return;
    const t = S.movements[m.toshlIds[0]]; if (!t || t.cents > 0 || !t.category) return;
    m.bankIds.forEach((bid) => { const b = S.movements[bid]; if (b) S.rules = C.learnRule(S.rules, b.description, t.category, t.subcategory, 'expense', false); });
  }
  async function commitImport() {
    const d = UI.draft; if (!canCommit()) return;
    const incoming = [].concat(d.bank && !d.bank.error ? d.bank.movements : [], d.toshl && !d.toshl.error ? d.toshl.movements : []);
    const fresh = []; let dup = 0;
    incoming.forEach((m) => {
      const old = S.movements[m.id];
      if (old) { dup++; if (!old.comment && m.comment) { old.comment = m.comment; fresh.push(old); } }
      else { S.movements[m.id] = m; fresh.push(m); }
    });
    await DB.putMany('movements', fresh);
    const nb = d.bank && !d.bank.error && d.bank.balance;
    if (nb && (!S.settings.balance || nb.date >= S.settings.balance.date)) S.settings.balance = { cents: nb.cents, date: nb.date, source: 'banco' };
    const n = runMatching();
    await persistCore(); recompute();
    UI.periodId = d.periodId || UI.periodId; UI.draft = null; UI.sub = null; UI.tab = 'conc'; UI.conc.group = 'pending';
    render(); window.scrollTo(0, 0);
    toast(fresh.length + ' nuevos · ' + dup + ' ya estaban · ' + n.auto + ' conciliados · ' + n.possible + ' posibles');
  }

  // ───────────────────────── Hoja: enlazar / cambiar ─────────────────────────
  function openLink(anchorIds, otherSide, preselect, replaceMatchId) {
    UI.link = { anchorIds, otherSide, sel: new Set(preselect || []), replace: replaceMatchId || null, filter: 'near', q: '' };
    const anchor = anchorIds.map((id) => S.movements[id]);
    const isT = anchor[0].source === 'toshl';
    const body = '<div class="origin' + (isT ? '' : ' bank') + '">' + anchor.map((m) => '<div class="row-between"><span><span class="pill ' + (isT ? 'toshl' : 'bank') + '">' + (isT ? 'Toshl' : 'Banco') + '</span> <b>' +
      esc(m.description || m.category) + '</b> · ' + C.formatDateShort(m.date) + '</span><span class="amt">' + money(m.cents) + '</span></div>' + (isT ? '<div class="sub">' + esc([m.category, m.subcategory].filter(Boolean).join(' › ')) + '</div>' : '')).join('') + '</div>' +
      '<label class="search">🔍<input type="search" placeholder="Buscar en ' + (otherSide === 'bank' ? 'el banco' : 'Toshl') + '…" data-i="link-q" autocomplete="off"></label>' +
      '<div class="chips" id="link-chips"></div><div id="link-list" style="margin-top:6px"></div>';
    openSheet(otherSide === 'bank' ? 'Enlazar con el banco' : 'Enlazar con Toshl', body, '<div id="link-foot"></div>');
    renderLink();
  }
  function linkCandidates() {
    const k = UI.link; const anchor = k.anchorIds.map((id) => S.movements[id]);
    const sum = anchor.reduce((s, m) => s + m.cents, 0); const date = anchor[0].date;
    const used = new Set();
    Object.values(S.matches).forEach((m) => { if (m.id === k.replace) return; m.toshlIds.forEach((i) => used.add(i)); m.bankIds.forEach((i) => used.add(i)); });
    const q = C.normText(k.q);
    return Object.values(S.movements).filter((m) => m.source === k.otherSide && !used.has(m.id) && Math.sign(m.cents) === Math.sign(sum))
      .filter((m) => k.sel.has(m.id) || (k.filter === 'near' ? Math.abs(C.diffDays(date, m.date)) <= 7 : k.filter === 'amount' ? Math.abs(m.cents - sum) <= Math.max(100, Math.abs(sum) * 0.1) : Math.abs(C.diffDays(date, m.date)) <= 45))
      .filter((m) => !q || C.normText([m.description, m.comment, m.category, m.subcategory, money(m.cents, { plain: true })].join(' ')).includes(q))
      .map((m) => ({ m, score: Math.abs(C.diffDays(date, m.date)) + Math.abs(m.cents - sum) / 100 - C.similarity(m.description, anchor[0].description) * 3 }))
      .sort((a, b) => (k.sel.has(b.m.id) - k.sel.has(a.m.id)) || a.score - b.score).slice(0, 80).map((x) => x.m);
  }
  function renderLink() {
    const k = UI.link; if (!k) return;
    const anchorSum = k.anchorIds.reduce((s, id) => s + S.movements[id].cents, 0);
    $('#link-chips').innerHTML = [['near', '±7 días'], ['amount', 'Importe parecido'], ['period', 'Más fechas']].map(([v, l]) => '<button class="chip' + (k.filter === v ? ' on' : '') + '" data-a="link-filter" data-v="' + v + '">' + l + '</button>').join('');
    const list = linkCandidates();
    $('#link-list').innerHTML = list.length ? list.map((m) => '<button class="cand" data-a="link-toggle" data-v="' + esc(m.id) + '"><span class="ck' + (k.sel.has(m.id) ? ' on' : '') + '">' + (k.sel.has(m.id) ? '✓' : '') + '</span>' +
      '<span class="m"><span class="t" style="display:block">' + esc(m.description || m.category) + '</span><span class="c">' + C.formatDate(m.date) + ' · ' + (C.diffDays(S.movements[k.anchorIds[0]].date, m.date) >= 0 ? '+' : '') + C.diffDays(S.movements[k.anchorIds[0]].date, m.date) + ' días' +
      (m.source === 'toshl' ? ' · ' + esc(m.category) : '') + (m.comment ? ' · 💬 ' + esc(m.comment) : '') + '</span></span><span class="amt">' + money(m.cents) + '</span></button>').join('')
      : '<p class="empty muted">No hay movimientos libres aquí. Prueba “Más fechas” o busca.</p>';
    const selSum = [...k.sel].reduce((s, id) => s + (S.movements[id] ? S.movements[id].cents : 0), 0);
    const diff = selSum - anchorSum;
    $('#link-foot').innerHTML = '<div class="sumline"><span>' + k.sel.size + ' seleccionado' + (k.sel.size === 1 ? '' : 's') + (k.sel.size ? ' · ' + money(selSum) : '') + '</span>' +
      (k.sel.size ? (diff === 0 ? '<b style="color:var(--ok)">Cuadra ✓</b>' : '<b style="color:var(--warn)">Diferencia ' + money(Math.abs(diff)) + '</b>') : '') + '</div>' +
      '<div class="btn-row" style="margin-top:0"><button class="btn plain" data-a="link-none">Dejar sin pareja</button><button class="btn" data-a="link-save"' + (k.sel.size ? '' : ' disabled') + '>Enlazar</button></div>';
  }
  function rejectPairs(tids, bids) { tids.forEach((t) => bids.forEach((b) => { S.rejected[C.pairKey(t, b)] = true; })); }
  function saveLink(none) {
    const k = UI.link; if (!k) return;
    const anchorIsT = S.movements[k.anchorIds[0]].source === 'toshl';
    const sel = [...k.sel];
    closeSheet();
    mutate(none ? 'Sin pareja' : 'Enlazado', () => {
      if (k.replace && S.matches[k.replace]) {
        const old = S.matches[k.replace];
        if (none) rejectPairs(old.toshlIds, old.bankIds);
        delete S.matches[k.replace];
      }
      if (none) {
        // Si el ancla no tenía emparejamiento, queda tal cual (solo en su lado).
        return;
      }
      const tids = anchorIsT ? k.anchorIds : sel, bids = anchorIsT ? sel : k.anchorIds;
      const m = { id: C.matchId(tids, bids), toshlIds: tids, bankIds: bids, status: 'manual', reason: 'Enlazado a mano', createdAt: Date.now() };
      S.matches[m.id] = m;
      // Las decisiones de “solo banco/solo Toshl” dejan de aplicar.
      tids.forEach((id) => delete S.decisions['t:' + id]); bids.forEach((id) => delete S.decisions['b:' + id]);
      learnFromMatch(m);
    });
  }

  // ───────────────────────── Hoja: editar movimiento ─────────────────────────
  function findEntry(id) { return L.all.find((e) => e.id === id); }
  function openExplain(key) {
    const s = summary();
    const f = C.explainFigure(key, s, { balance: S.settings.balance, incomeEntries: entries().filter((e) => e.treatment === 'income') });
    if (!f) return;
    let body = '';
    if (f.lines.length) {
      body += '<div class="list">' + f.lines.map((l) => '<div class="li2"><span class="l">' + (l.op ? '<b style="display:inline-block;width:18px">' + esc(l.op) + '</b>' : '<span style="display:inline-block;width:18px"></span>') + esc(l.label) + '</span>' + (l.cents === null || l.cents === undefined ? '' : '<b class="amt">' + money(l.cents) + '</b>') + '</div>').join('') +
        '<div class="li2" style="background:var(--surface2)"><span class="l"><b>= ' + esc(f.result.label) + '</b></span><b class="amt">' + money(f.result.cents) + '</b></div></div>';
    } else body += '<div class="hero" style="margin:0"><div class="lbl">' + esc(f.result.label) + '</div><div class="big" style="font-size:34px">' + money(f.result.cents) + '</div></div>';
    if (f.breakdown && f.breakdown.length) body += '<div class="set-h">Desglose</div><div class="list">' + f.breakdown.map((b) => '<div class="li2"><span class="l">' + esc(b.label) + (b.sub ? '<span class="sub" style="display:block">' + esc(b.sub) + '</span>' : '') + '</span><b class="amt">' + money(b.cents) + '</b></div>').join('') + '</div>';
    if (f.top && f.top.length) body += '<div class="set-h">Movimientos más grandes</div><div class="list">' + f.top.map((e) => '<button class="li2" data-a="edit-entry" data-v="' + esc(e.id) + '"><span class="l">' + C.formatDateShort(e.date) + ' · ' + esc(e.description || e.category) + '</span><span class="r"><b class="amt">' + money(e.cents) + '</b> ›</span></button>').join('') + '</div>';
    if (f.note) body += '<p class="note">' + esc(f.note) + '</p>';
    openSheet('ⓘ ' + f.title, body);
  }
  function explainBlock(e) {
    if (S.settings.explainOn === false) return '';
    const ex = C.explainEntry(e, { movements: S.movements, matches: S.matches, decisions: S.decisions, catType: (c) => (S.categories[c] || {}).type, periodLabel: C.periodLabel(period(e.periodId)) });
    return '<details class="explain"><summary>🔎 De dónde sale</summary>' + ex.steps.map((st) => '<div class="ex-step"><b>' + st.icon + ' ' + esc(st.title) + '</b>' + st.lines.map((l) => '<div>' + esc(l) + '</div>').join('') + '</div>').join('') + '</details>';
  }
  function openEditEntry(id) {
    const e = findEntry(id); if (!e) return;
    UI.editTreat = e.treatment;
    const subs = [...new Set(L.all.filter((x) => x.category === e.category && x.subcategory).map((x) => x.subcategory))];
    let body = '<div class="origin' + (e.bankIds.length && !e.toshlIds.length ? ' bank' : '') + '"><div class="row-between"><b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.description || '(sin descripción)') + '</b>' + signedMoney(e) + '</div>' +
      '<div class="sub">' + C.formatDate(e.date) + ' · ' + (STATUS_PILL[e.status] || '') + (e.bankDescription && e.bankDescription !== e.description ? '<br>Banco: ' + esc(e.bankDescription) : '') + '</div>' + commentLine(e.comment) + '</div>';
    body += explainBlock(e);
    body += '<div class="seg" id="treat-seg">' + ['expense', 'income', 'refund', 'excluded'].map((t) => '<button class="' + (e.treatment === t ? 'on' : '') + '" data-a="edit-treat" data-v="' + t + '">' + TREAT_LABEL[t] + '</button>').join('') + '</div>';
    body += '<label class="field"><span>Categoría</span><select class="select" id="ed-cat">' + catOptions(e.category, true) + '<option value="__new">+ Nueva categoría…</option></select></label>' +
      '<label class="field hidden" id="ed-new-wrap"><span>Nombre de la nueva categoría</span><input class="input" id="ed-new" autocomplete="off"></label>' +
      '<label class="field"><span>Subcategoría (etiqueta)</span><input class="input" id="ed-sub" value="' + esc(e.subcategory) + '" list="ed-subs" autocomplete="off"><datalist id="ed-subs">' + subs.map((s) => '<option value="' + esc(s) + '">').join('') + '</datalist></label>';
    if (e.bankDescription) body += '<label class="check"><input type="checkbox" id="ed-learn" checked> Recordar para “' + esc(C.merchantKey(e.bankDescription)) + '”</label>';
    let extra = '';
    if (e.matchId && e.status !== 'possible') extra += '<button class="btn danger" style="margin-top:12px" data-a="unmatch" data-v="' + esc(e.matchId) + '">Deshacer emparejamiento</button>';
    if (e.status === 'bank_only' || e.status === 'toshl_only') extra += '<button class="btn ghost" style="margin-top:12px" data-a="link" data-v="' + esc(e.id) + '">⇄ Enlazar con ' + (e.status === 'bank_only' ? 'Toshl' : 'el banco') + '</button>';
    if (S.decisions[e.id]) extra += '<button class="btn plain" style="margin-top:8px" data-a="reset-entry" data-v="' + esc(e.id) + '">Volver a como estaba</button>';
    openSheet('Editar movimiento', body + extra, '<button class="btn" data-a="save-entry" data-v="' + esc(e.id) + '">Guardar</button>');
  }
  function saveEditEntry(id) {
    const e = findEntry(id); if (!e) return;
    let cat = $('#ed-cat').value;
    if (cat === '__new') cat = ($('#ed-new').value || '').trim();
    const sub = ($('#ed-sub').value || '').trim();
    const treatment = UI.editTreat || e.treatment;
    if (treatment === 'refund' && !cat) { toast('Elige de qué categoría se resta el reembolso'); return; }
    if (treatment === 'expense' && !cat) { toast('Elige una categoría'); return; }
    const learn = $('#ed-learn') && $('#ed-learn').checked;
    closeSheet();
    mutate('Guardado', () => {
      if (cat && !S.categories[cat]) S.categories[cat] = { icon: guessIcon(cat), type: treatment === 'income' ? 'income' : 'variable' };
      S.decisions[id] = { category: cat, subcategory: sub, treatment };
      if (learn && e.bankDescription) S.rules = C.learnRule(S.rules, e.bankDescription.split(' + ')[0], cat, sub, treatment, false);
    });
  }

  // ───────────────────────── Presupuesto ─────────────────────────
  function budgetSeg() {
    return '<div class="seg" style="margin-top:0">' + [['period', 'Este periodo'], ['history', 'Histórico']].map(([v, l]) =>
      '<button class="' + (UI.budgetView === v ? 'on' : '') + '" data-a="budget-view" data-v="' + v + '">' + l + '</button>').join('') + '</div>';
  }
  function renderBudget() {
    if (UI.budgetView === 'history') return budgetSeg() + renderHistory();
    return budgetSeg() + renderBudgetPeriod();
  }
  function renderBudgetPeriod() {
    const info = budgetInfo(); const s = summary(); const p = period();
    let h = '';
    if (!info.budget) {
      return '<div class="empty"><div class="big-ic">📊</div><h2>Aún no tienes presupuesto</h2><p>Pon un importe por categoría. Se copia al siguiente periodo con un toque.</p>' +
        '<button class="btn" data-a="budget-edit">Crear presupuesto</button><button class="btn plain" style="margin-top:8px" data-a="v2-sheet">Importar de la v2 (JSON)</button></div>';
    }
    h += '<div class="row-between" style="margin:0 2px 10px"><span class="sub">Presupuesto de este periodo: <b>' + money(budgetTotalOf(info.budget)) + '</b>' + (info.from ? ' (heredado)' : '') + '</span></div>' +
      '<div class="btn-row" style="margin:0 0 12px"><button class="btn ghost sm" data-a="budget-edit">✏️ Editar</button><button class="btn ghost sm" data-a="budget-dup">📋 Duplicar a otro mes</button></div>';
    if (info.from) h += '<button class="banner info" data-a="budget-copy">📋 <span class="grow">Usando el presupuesto de <b>' + esc(C.periodLabel(period(info.from))) + '</b>. Toca para guardarlo en este periodo.</span><span class="chev">›</span></button>';
    const t = (l, v, st) => '<div class="tile"><small>' + l + '</small><b' + (st ? ' style="' + st + '"' : '') + '>' + v + '</b></div>';
    h += '<div class="sumgrid">' + t('Ingresos ' + infoBtn('income'), money(s.income)) + t('Gastos ' + infoBtn('spent'), money(s.consumption)) + t('Ahorro / inversión', money(s.savings)) +
      t('Saldo del periodo ' + infoBtn('balance'), money(s.balance, { sign: true }), 'color:var(' + (s.balance >= 0 ? '--ok' : '--bad') + ')') + t('Presupuesto', money(s.budgetTotal)) + t('Por pagar ' + infoBtn('pending'), money(s.pendingTotal), 'color:var(--warn)') + '</div>';
    h += '<div class="sec-h"><b>Variables ' + infoBtn('available') + '</b><span>' + money(s.varBudget) + ' · ' + (s.available >= 0 ? 'quedan ' + money(s.available) : 'pasado ' + money(-s.available)) + '</span></div>';
    h += '<div class="pace"><i></i> Ritmo esperado hoy: ' + s.elapsedPct + ' % (día ' + s.elapsed + ' de ' + s.totalDays + ')</div>';
    if (s.daysLeft <= 5 && s.available > 0) h += '<p class="note" style="margin:0 4px 10px">Final del periodo: si no vas a gastar lo que queda en alguna categoría, pulsa “Cerrar este periodo” en ella.</p>';
    s.variable.forEach((c) => { h += budCard(c, s); });
    if (!s.variable.length) h += '<p class="note">Sin categorías variables.</p>';
    h += '<div class="sec-h"><b>Fijos</b><span>' + money(s.fixedBudget) + ' · por pagar ' + money(s.pendingTotal) + '</span></div><div class="list">';
    const meta = metaForSummary();
    s.fixed.forEach((c) => {
      const pend = s.pending.filter((x) => x.category === c.name);
      const lastPaid = c.entries.filter((e) => e.treatment === 'expense').map((e) => e.bankDate || e.date).sort().pop();
      const m = meta[c.name] || {};
      const pill = pend.length
        ? '<span class="pill warn">⏳ ' + (pend[0].due ? '~' + C.formatDateShort(pend[0].due) : 'pendiente') + '</span>'
        : (c.budget ? '<span class="pill ok">✓' + (lastPaid ? ' ' + C.formatDateShort(lastPaid) : '') + '</span>' : '<span class="pill bad">sin presupuesto</span>');
      const detail = (c.spent && c.spent !== c.budget ? money(c.spent) + ' de ' + money(c.budget) : money(c.budget || c.spent)) +
        (pend.some((x) => x.sub) ? ' · falta ' + pend.filter((x) => x.sub).map((x) => esc(x.sub)).join(', ') : '') + (m.dueInferred && pend.length ? ' · día deducido' : '');
      const closedSubs = c.subs.filter((x) => x.closed).map((x) => x.name);
      const pillF = c.closed ? '<span class="pill mut">cerrado</span>' : pill;
      const extra = c.closed || closedSubs.length
        ? '<button class="mini" data-a="reopen-cat" data-v="' + esc(c.name) + '">↩︎ Deshacer' + (closedSubs.length && !c.closed ? ' ' + esc(closedSubs.join(', ')) : '') + '</button>'
        : (pend.length ? '<button class="mini" data-a="close-item" data-v="' + esc(c.name) + '">No se pagará este periodo</button>' : '');
      h += '<div class="fixed"><button class="nm" style="text-align:left;flex:1;min-height:44px" data-a="cat-movs" data-v="' + esc(c.name) + '">' + catIcon(c.name) + ' ' + esc(c.name) +
        '<span class="sub">' + (c.closed ? money(c.spent) + ' pagado · lo que faltaba no se pagará' : detail) + '</span></button><span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">' + pillF + extra + '</span></div>';
    });
    if (!s.fixed.length) h += '<p class="note" style="padding:12px">Sin gastos fijos.</p>';
    h += '</div>';
    h += '<div class="btn-row" style="margin-top:14px"><button class="btn ghost" data-a="budget-edit">✏️ Editar presupuesto</button></div>';
    const prev = C.shiftPeriodId(UI.periodId, -1);
    if (S.budgets[prev] && !info.from) h += '<button class="btn plain" style="margin-top:8px" data-a="budget-copy-prev">📋 Copiar del periodo anterior</button>';
    return h;
  }
  // ───────────────────────── Histórico ─────────────────────────
  function historyData() {
    const ids = Object.keys(L.byPeriod).filter((id) => (L.byPeriod[id] || []).length).sort();
    const items = ids.map((id) => ({ id, label: C.periodLabel(period(id)), summary: summary(id), pending: pendingCount(id) }));
    return C.buildHistory(items);
  }
  const monthName = (id) => C.MONTHS[Number(id.slice(5, 7)) - 1];
  function historyChart(rows) {
    const last = rows.slice(-12);
    const max = Math.max(1, ...last.map((r) => Math.max(r.income, r.total)));
    const W = 340, H = 150, pad = 18, gw = (W - 8) / last.length, bw = Math.min(14, gw / 3);
    let bars = '';
    last.forEach((r, i) => {
      const x = 4 + i * gw + gw / 2;
      const hi = (r.income / max) * (H - pad - 6), hs = (r.total / max) * (H - pad - 6);
      bars += '<rect x="' + (x - bw - 1).toFixed(1) + '" y="' + (H - pad - hi).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hi).toFixed(1) + '" rx="3" fill="var(--seg-save)"><title>' + esc(r.label) + ' · ingresos ' + money(r.income) + '</title></rect>' +
        '<rect x="' + (x + 1).toFixed(1) + '" y="' + (H - pad - hs).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hs).toFixed(1) + '" rx="3" fill="var(--seg-spent)"><title>' + esc(r.label) + ' · gastos ' + money(r.total) + '</title></rect>' +
        '<text x="' + x.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + monthName(r.id) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Ingresos y gastos por periodo"><line x1="0" x2="' + W + '" y1="' + (H - pad) + '" y2="' + (H - pad) + '" stroke="var(--line)"/>' + bars + '</svg>' +
      '<div class="legend" style="grid-template-columns:auto auto;justify-content:start;gap:4px 16px;margin-top:4px"><span style="--c:var(--seg-save)"><em>Ingresos</em></span><span style="--c:var(--seg-spent)"><em>Gastos (incl. ahorro)</em></span></div>';
  }
  function miniBars(series) {
    const s = series.slice(-6); const max = Math.max(1, ...s.map((v) => Math.abs(v)));
    return '<span style="display:inline-flex;align-items:flex-end;gap:2px;height:22px" aria-hidden="true">' + s.map((v, i) =>
      '<i style="display:block;width:6px;border-radius:2px;height:' + Math.max(2, Math.round((Math.abs(v) / max) * 22)) + 'px;background:' + (i === s.length - 1 ? 'var(--accent)' : 'var(--line)') + '"></i>').join('') + '</span>';
  }
  function renderHistory() {
    const hd = historyData();
    if (!hd.count) return '<div class="empty"><div class="big-ic">📈</div><h2>Sin histórico todavía</h2><p>Aparece en cuanto importes datos. Para rellenar meses anteriores, importa también sus archivos del banco y de Toshl.</p></div>';
    const t = (l, v, st) => '<div class="tile"><small>' + l + '</small><b' + (st ? ' style="' + st + '"' : '') + '>' + v + '</b></div>';
    let h = '<div class="sumgrid">' + t('Ingreso medio', money(hd.avgIncome)) + t('Gasto medio', money(hd.avgSpent)) +
      t('Ahorro / inversión medio', money(hd.avgSavings)) + t('Saldo medio', money(hd.avgBalance, { sign: true }), 'color:var(' + (hd.avgBalance >= 0 ? '--ok' : '--bad') + ')') + '</div>';
    h += '<div class="card">' + historyChart(hd.rows) + '</div>';
    if (hd.count > 1) h += '<p class="note" style="margin:-4px 4px 12px">Mejor periodo: <b>' + esc(hd.best.label) + '</b> (' + money(hd.best.balance, { sign: true }) + ') · Peor: <b>' + esc(hd.worst.label) + '</b> (' + money(hd.worst.balance, { sign: true }) + ')</p>';
    h += '<div class="sec-h"><b>Periodos</b><span>' + hd.count + ' · toca uno para abrirlo</span></div><div class="list">';
    hd.rows.slice().reverse().forEach((r) => {
      const pctPill = r.pct === null ? '' : '<span class="pill ' + (r.pct > 100 ? 'bad' : r.pct >= 80 ? 'warn' : 'ok') + '">' + r.pct + ' %</span>';
      h += '<button class="li2" data-a="hist-open" data-v="' + r.id + '"><span class="l"><b>' + esc(r.label) + ' ' + r.id.slice(0, 4) + '</b><span class="sub" style="display:block">Ingresos ' + money(r.income) + ' · Gastos ' + money(r.total) +
        (r.pending ? ' · <span style="color:var(--warn)">' + r.pending + ' sin revisar</span>' : '') + '</span></span><span class="r" style="flex-direction:column;align-items:flex-end;gap:2px"><b class="amt" style="color:var(' + (r.balance >= 0 ? '--ok' : '--bad') + ')">' + money(r.balance, { sign: true }) + '</b>' + pctPill + '</span></button>';
    });
    h += '</div>';
    h += '<div class="sec-h"><b>Por categoría</b><span>media · último periodo</span></div><div class="list">';
    hd.categories.forEach((c) => {
      const diff = c.prevAvg !== null && c.prevAvg > 0 ? Math.round(((c.last - c.prevAvg) / c.prevAvg) * 100) : null;
      const trend = diff === null ? '' : '<span class="sub" style="color:var(' + (diff > 10 ? '--bad' : diff < -10 ? '--ok' : '--muted') + ')">' + (diff > 0 ? '+' : '') + diff + ' % vs media</span>';
      const open = UI.histOpen[c.name];
      h += '<button class="li2" data-a="hist-cat" data-v="' + esc(c.name) + '" aria-expanded="' + (open ? 'true' : 'false') + '"><span class="l">' + catIcon(c.name) + ' <b>' + esc(c.name) + '</b><span class="sub" style="display:block">Media ' + money(c.avg) + ' · último ' + money(c.last) + ' ' + trend + '</span></span><span class="r">' + miniBars(c.series) + '</span></button>';
      if (open) {
        h += '<div style="padding:4px 14px 10px">' + hd.rows.map((r, i) => '<div class="kv"><span>' + esc(r.label) + ' ' + r.id.slice(0, 4) + '</span><b class="amt">' + money(c.series[i]) + '</b></div>').reverse().join('') + '</div>';
      }
    });
    h += '</div><p class="note">Los periodos con movimientos sin revisar pueden cambiar. Para ver meses anteriores, importa sus archivos del banco y de Toshl.</p>';
    return h;
  }

  function budCard(c, s) {
    const open = UI.open[c.name];
    const width = Math.min(100, c.budget > 0 ? (c.spent / c.budget) * 100 : (c.spent > 0 ? 100 : 0));
    let h = '<div class="bud"><button style="width:100%;text-align:left;display:block" data-a="toggle-cat" data-v="' + esc(c.name) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<div class="h"><span class="name">' + catIcon(c.name) + ' ' + esc(c.name) + '</span><span class="nums">' + money(c.spent) + ' / ' + money(c.budget) + '</span></div>' +
      '<div class="bar"><div class="f ' + c.color + '" style="width:' + Math.max(0, width).toFixed(1) + '%"></div><div class="m" style="left:' + s.elapsedPct + '%"></div></div>' +
      '<div class="foot"><span>' + (c.closed ? 'Cerrada · presupuesto era ' + money(c.originalBudget) : c.remaining >= 0 ? money(c.remaining) + ' restante' : money(-c.remaining) + ' pasado') + '</span><span class="p ' + c.color + '">' + (c.budget > 0 || c.closed ? c.pct + ' %' : 'sin presupuesto') + '</span></div>';
    const subs = c.subs.filter((x) => x.name);
    if (subs.length) h += '<div class="subcats">' + subs.map((x) => esc(x.name) + (x.alias ? ' (' + esc(x.alias) + ')' : '') + ' ' + money(x.spent, { plain: true }) + (x.budget ? '/' + money(x.budget, { plain: true }) : '')).join(' · ') + '</div>';
    h += '</button>';
    if (c.closed) h += '<button class="mini" data-a="reopen-key" data-v="' + esc(c.name) + '">↩︎ Deshacer cierre</button>';
    if (!open && !c.closed && c.originalBudget > c.spent && c.spent >= 0 && s.daysLeft <= 5) {
      h += '<button class="mini" data-a="close-item" data-v="' + esc(c.name) + '">Cerrar este periodo (quedan ' + money(c.originalBudget - c.spent) + ')</button>';
    }
    if (open) {
      const list = c.entries.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      h += '<div class="detail">' + list.slice(0, 6).map((e) => '<div class="li"><span>' + C.formatDateShort(e.date) + '</span><span>' + (e.treatment === 'refund' ? '↩︎ ' : '') + esc(e.description) + '</span>' + signedMoney(e) + '</div>').join('') +
        '<button class="link" data-a="cat-movs" data-v="' + esc(c.name) + '">Ver ' + (list.length > 6 ? 'los ' + list.length : 'todos') + ' en Movimientos ›</button>' +
        (S.settings.explainOn !== false ? '<button class="mini" style="display:block" data-a="explain" data-v="cat:' + esc(c.name) + '">ⓘ Cómo se calcula</button>' : '') +
        (c.closed ? ''
          : (c.originalBudget > c.spent ? '<button class="mini" data-a="close-item" data-v="' + esc(c.name) + '">Cerrar este periodo (no gastaré más aquí)</button>' : '')) + '</div>';
    }
    return h + '</div>';
  }

  function budgetTotalOf(b) { return Object.values((b && b.cats) || {}).reduce((a, c) => a + (c.cents || 0), 0); }
  function openBudgetEditor() {
    const info = budgetInfo(); const b = clone((info.budget && info.budget.cats) || {});
    const prevId = C.shiftPeriodId(UI.periodId, -1);
    const prev = (budgetInfo(prevId).budget || { cats: {} }).cats || {};
    UI.bedPrevTotal = budgetTotalOf(budgetInfo(prevId).budget); UI.bedPrevLabel = C.periodLabel(period(prevId));
    const meta = metaForSummary();
    const cats = budgetCats();
    Object.keys(b).forEach((c) => { if (!cats.includes(c) && !isIncomeCat(c)) cats.push(c); });
    const order = (c) => ((S.categories[c] || {}).type === 'fixed' ? 0 : 1);
    cats.sort((a, c) => order(a) - order(c) || a.localeCompare(c, 'es'));
    const val = (cents) => (cents ? money(cents, { plain: true }) : '');
    const card = (c) => {
      const m = S.categories[c] || { type: 'variable' }; const bc = b[c] || { cents: 0, subs: {} };
      const subs = Object.entries(bc.subs || {});
      const pc = (prev[c] && prev[c].cents) || 0;
      const hint = pc !== (bc.cents || 0) ? '<span class="sub" style="display:block;font-weight:400">antes: ' + money(pc) + '</span>' : '';
      return '<div class="bed" data-cat="' + esc(c) + '"><div class="h"><span class="nm">' + catIcon(c) + ' ' + esc(c) + hint + '</span>' +
        '<input class="money-in" inputmode="decimal" data-f="amount" data-i="bed-sum" value="' + val(bc.cents) + '" placeholder="0,00" aria-label="Presupuesto de ' + esc(c) + '">' +
        '<button class="more-btn" data-a="bed-more" aria-label="Más opciones">⋯</button></div>' +
        '<div class="opts hidden"><div class="seg" style="margin:0 0 8px"><button class="' + (m.type === 'fixed' ? 'on' : '') + '" data-a="bed-type" data-v="fixed">Fijo</button><button class="' + (m.type !== 'fixed' ? 'on' : '') + '" data-a="bed-type" data-v="variable">Variable</button></div>' +
        '<label class="field" style="margin-top:4px"><span>Día habitual de pago (fijos)</span><input class="input" inputmode="numeric" data-f="due" value="' + (m.dueDay || '') + '" placeholder="' + (meta[c] && meta[c].dueInferred ? 'Deducido: ' + meta[c].dueDay : 'Ej. 1') + '"></label>' +
        '<label class="check"><input type="checkbox" data-f="estimate"' + (m.estimate ? ' checked' : '') + '> Importe que cambia (luz, agua…): mostrar como estimado</label>' +
        '<label class="check"><input type="checkbox" data-f="savings"' + (m.savings ? ' checked' : '') + '> Es ahorro / inversión</label>' +
        '<label class="field" style="margin-top:4px"><span>Icono</span><input class="input" data-f="icon" value="' + esc(m.icon || '') + '" maxlength="4"></label>' +
        '<div class="field"><span>Subcategorías con presupuesto (opcional)</span><div class="subs">' +
        subs.map(([n, v]) => subRow(n, v)).join('') + '</div><button class="btn plain sm" style="margin-top:6px" data-a="bed-addsub">+ Subcategoría</button></div>' +
        '<button class="mini" style="color:var(--bad)" data-a="bed-clear">Quitar de este mes (poner a 0)</button></div></div>';
    };
    const body = '<p class="sub" style="margin-bottom:10px">Presupuesto de <b>' + esc(C.periodLabel(period())) + ' ' + period().start.slice(0, 4) + '</b>' + (info.from ? ' (copiado de ' + esc(C.periodLabel(period(info.from))) + ')' : '') + '. Toca ⋯ para tipo, día de pago, subcategorías o quitar.</p>' +
      cats.map(card).join('') + '<div class="row-between" style="margin-top:8px;gap:8px"><input class="input" id="bed-newcat" placeholder="Nueva categoría" autocomplete="off"><button class="btn ghost sm" data-a="bed-addcat">Añadir</button></div>';
    openSheet('Presupuesto', body, '<div class="sumline"><span>Total</span><b id="bed-total"></b></div><div class="sub" id="bed-diff" style="margin:-4px 0 8px"></div>' +
      '<button class="btn" data-a="budget-save">Guardar para ' + esc(C.periodLabel(period())) + '</button>');
    bedRecalc();
  }
  function bedRecalc() {
    const el = $('#bed-total'); if (!el) return;
    let total = 0;
    $$('.bed').forEach((card) => {
      const a = C.parseAmount($('[data-f="amount"]', card).value);
      const subs = $$('.subrow [data-s="amount"]', card).reduce((acc, i) => { const v = C.parseAmount(i.value); return acc + (Number.isFinite(v) && v > 0 ? v : 0); }, 0);
      total += Math.max(Number.isFinite(a) && a > 0 ? a : 0, subs);
    });
    el.textContent = money(total);
    const d = total - (UI.bedPrevTotal || 0);
    $('#bed-diff').textContent = UI.bedPrevTotal ? (d === 0 ? 'Igual que ' + UI.bedPrevLabel : (d > 0 ? '+' : '−') + money(Math.abs(d), { plain: true }) + ' € respecto a ' + UI.bedPrevLabel + ' (' + money(UI.bedPrevTotal) + ')') : '';
  }
  function subRow(n, v) {
    return '<div class="subrow"><input class="input" data-s="name" value="' + esc(n || '') + '" placeholder="Subcategoría"><input class="money-in" style="width:100px;min-height:46px;border-radius:12px" inputmode="decimal" data-i="bed-sum" data-s="amount" value="' + (v ? money(v, { plain: true }) : '') + '" placeholder="0,00"><button class="btn plain sm" data-a="bed-delsub" aria-label="Quitar">✕</button></div>';
  }
  function saveBudgetEditor() {
    const cats = {}; let bad = false;
    const newMeta = clone(S.categories);
    $$('.bed').forEach((el) => {
      const c = el.dataset.cat;
      const a = C.parseAmount($('[data-f="amount"]', el).value);
      if (!Number.isFinite(a) || a < 0) { bad = true; return; }
      const subs = {};
      $$('.subrow', el).forEach((r) => { const n = $('[data-s="name"]', r).value.trim(); const v = C.parseAmount($('[data-s="amount"]', r).value); if (n && Number.isFinite(v) && v > 0) subs[n] = v; });
      const subSum = Object.values(subs).reduce((s, v) => s + v, 0);
      cats[c] = { cents: Math.max(a, subSum), subs };
      const typeOn = $('.seg button.on', el);
      const due = parseInt($('[data-f="due"]', el).value, 10);
      newMeta[c] = Object.assign({}, newMeta[c] || {}, {
        type: typeOn ? typeOn.dataset.v : 'variable', dueDay: due >= 1 && due <= 31 ? due : null,
        estimate: $('[data-f="estimate"]', el).checked, savings: $('[data-f="savings"]', el).checked,
        icon: $('[data-f="icon"]', el).value.trim() || guessIcon(c),
      });
    });
    if (bad) { toast('Revisa los importes (ej. 150 o 150,00)'); return; }
    closeSheet();
    mutate('Presupuesto guardado', () => { const prevClosed = S.budgets[UI.periodId] && S.budgets[UI.periodId].closed; S.budgets[UI.periodId] = { cats }; if (prevClosed) S.budgets[UI.periodId].closed = prevClosed; S.categories = newMeta; });
  }

  // ───────────────────────── Ajustes ─────────────────────────
  function renderSettings() {
    const s = S.settings; const p = period();
    const ov = s.overrides && s.overrides[UI.periodId];
    const last = s.lastBackupAt ? C.formatDate(C.todayISO(new Date(s.lastBackupAt))) : 'nunca';
    let h = '<div class="set-h">Saldo del banco (opcional)</div><div class="list">' +
      '<button class="li2" data-a="balance-sheet"><span class="l">💶 Saldo actual</span><span class="r">' + (s.balance ? money(s.balance.cents) + ' · ' + C.formatDateShort(s.balance.date) : 'Añadir') + ' <span class="chev">›</span></span></button></div>';
    h += '<div class="set-h">Explicaciones</div><div class="list"><label class="li2"><span class="l">ⓘ Cómo se calcula y 🔎 De dónde sale</span><input type="checkbox" class="switch" data-c="set-toggle" data-v="explainOn"' + (S.settings.explainOn !== false ? ' checked' : '') + '></label></div>';
    if (S.savingsPin) h += '<div class="set-h">Ahorros</div><div class="list"><button class="li2" data-a="pin-change"><span class="l">🔒 Cambiar PIN de Ahorros</span><span class="chev">›</span></button></div>';
    h += '<div class="set-h">Periodo</div><div class="list">' +
      '<label class="li2"><span class="l">Día de inicio</span><input class="num-input" type="number" inputmode="numeric" min="1" max="28" value="' + s.startDay + '" data-c="set-startday"></label>' +
      '<label class="li2"><span class="l">Saltar sábados y domingos</span><input type="checkbox" class="switch" data-c="set-toggle" data-v="skipWeekends"' + (s.skipWeekends ? ' checked' : '') + '></label>' +
      '<label class="li2"><span class="l">Saltar festivos</span><input type="checkbox" class="switch" data-c="set-toggle" data-v="skipHolidays"' + (s.skipHolidays ? ' checked' : '') + '></label>' +
      '<button class="li2" data-a="period-sheet"><span class="l">Periodo actual</span><span class="r">' + esc(C.periodLabel(p)) + (ov ? ' · a mano' : '') + ' <span class="chev">›</span></span></button></div>';
    h += '<div class="set-h">Festivos</div><div class="list">' + (s.holidays || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) =>
      '<div class="li2"><span class="l">' + C.formatDate(x.date) + (x.name ? ' · ' + esc(x.name) : '') + '</span><button class="r" data-a="hol-del" data-v="' + x.date + '" aria-label="Quitar" style="min-width:44px;min-height:44px;justify-content:center">✕</button></div>').join('') +
      '<div class="li2" style="gap:6px"><input class="input" type="date" id="hol-date" style="flex:1;min-width:0"><input class="input" id="hol-name" placeholder="Nombre" style="flex:1;min-width:0"><button class="btn ghost sm" data-a="hol-add">Añadir</button></div></div>';
    h += '<div class="set-h">Categorías y presupuesto</div><div class="list">' +
      '<button class="li2" data-a="budget-edit"><span class="l">Presupuesto, tipo (fijo/variable) y día de pago</span><span class="r">' + budgetCats().length + ' <span class="chev">›</span></span></button>' +
      '<button class="li2" data-a="v2-sheet"><span class="l">Importar presupuesto de la v2 (JSON)</span><span class="chev">›</span></button>' +
      '<button class="li2" data-a="partner-edit"><span class="l">Visión compartida: sueldo y gastos de ' + esc(S.partner.name || 'tu pareja') + '</span><span class="chev">›</span></button>' +
      '</div>';
    const learned = S.rules.filter((r) => r.learned).length;
    h += '<div class="set-h">Reglas · ' + S.rules.length + '</div><div class="list">' +
      S.rules.slice(0, 5).map((r) => '<button class="li2 rule" data-a="rule-edit" data-v="' + esc(r.id) + '"><span class="l"><code>' + esc(r.pattern) + '</code> → ' + esc(ruleTarget(r)) + '</span><span class="chev">›</span></button>').join('') +
      '<button class="li2 accent" data-a="rules-sheet"><span class="l">Ver y editar todas (' + learned + ' aprendidas)</span><span class="chev">›</span></button></div>';
    h += '<div class="set-h">Datos</div><div class="list">' +
      '<button class="li2" data-a="export-csv"><span class="l">Exportar libro del periodo · CSV (Toshl)</span><span class="chev">›</span></button>' +
      '<button class="li2" data-a="export-json"><span class="l">Exportar libro del periodo · JSON</span><span class="chev">›</span></button>' +
      '<button class="li2" data-a="backup"><span class="l">Copia de seguridad (JSON)</span><span class="r">Última: ' + last + ' <span class="chev">›</span></span></button>' +
      '<label class="li2" style="position:relative"><span class="l">Restaurar copia</span><span class="chev">›</span><input type="file" accept=".json,application/json" data-c="restore" style="position:absolute;inset:0;opacity:0"></label>' +
      '<button class="li2 danger" data-a="clear-all"><span class="l">Borrar todos los datos</span></button></div>';
    h += '<p class="note">🔒 Todo se guarda solo en este iPhone (IndexedDB). La app no se conecta a internet. No se guardan número de cuenta ni titular.' +
      (UI.persisted ? ' Almacenamiento protegido ✓.' : '') + ' · v' + APP_VERSION + ' · <a href="tests.html" style="color:var(--accent)">tests</a></p>' +
      '<button class="btn plain" style="margin-top:12px" data-a="check-update">🔄 Buscar actualización</button>';
    return h;
  }
  function ruleTarget(r) {
    if (r.treatment === 'excluded') return 'Excluir';
    if (r.treatment === 'refund') return 'Reembolso' + (r.category ? ' · ' + r.category : '');
    if (r.treatment === 'income') return 'Ingreso' + (r.category ? ' · ' + r.category : '');
    return (r.category || '?') + (r.subcategory ? ' › ' + r.subcategory : '');
  }
  function openRules() {
    const list = S.rules.slice().sort((a, b) => a.pattern.localeCompare(b.pattern));
    openSheet('Reglas', '<p class="sub" style="margin-bottom:8px">Si la descripción del banco contiene el patrón, se sugiere esa categoría. Las reglas manuales ganan a las aprendidas.</p><div class="list">' +
      list.map((r) => '<button class="li2 rule" data-a="rule-edit" data-v="' + esc(r.id) + '"><span class="l"><code>' + esc(r.pattern) + '</code> → ' + esc(ruleTarget(r)) + '</span><span class="r">' + (r.learned ? 'aprendida' : 'manual') + ' ›</span></button>').join('') + '</div>',
    '<button class="btn" data-a="rule-edit" data-v="">+ Nueva regla</button>');
  }
  function openRuleEdit(id) {
    const r = S.rules.find((x) => x.id === id) || { id: '', pattern: '', category: '', subcategory: '', treatment: 'expense' };
    const body = '<label class="field"><span>Patrón (palabras de la descripción del banco)</span><input class="input" id="ru-pat" value="' + esc(r.pattern) + '" autocapitalize="characters" autocomplete="off" placeholder="Ej. MERCADONA"></label>' +
      '<label class="field"><span>Tratamiento</span><select class="select" id="ru-treat">' + ['expense', 'income', 'refund', 'excluded'].map((t) => '<option value="' + t + '"' + (r.treatment === t ? ' selected' : '') + '>' + TREAT_LABEL[t] + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Categoría</span><select class="select" id="ru-cat">' + catOptions(r.category, true) + '</select></label>' +
      '<label class="field"><span>Subcategoría</span><input class="input" id="ru-sub" value="' + esc(r.subcategory) + '" autocomplete="off"></label>' +
      (r.id ? '<button class="btn danger" style="margin-top:14px" data-a="rule-del" data-v="' + esc(r.id) + '">Borrar regla</button>' : '');
    openSheet(r.id ? 'Editar regla' : 'Nueva regla', body, '<button class="btn" data-a="rule-save" data-v="' + esc(r.id) + '">Guardar</button>');
  }

  function openPeriodSheet() {
    const cfg = periodCfg();
    const ids = new Set(Object.keys(L.byPeriod)); ids.add(C.periodIdForDate(today(), cfg)); ids.add(UI.periodId);
    const list = [...ids].sort().reverse();
    const ov = S.settings.overrides[UI.periodId] || {}; const p = period();
    const body = '<div class="list">' + list.map((id) => {
      const pp = period(id); const n = (L.byPeriod[id] || []).length; const pend = pendingCount(id);
      return '<button class="li2" data-a="period-pick" data-v="' + id + '"><span class="l">' + (id === UI.periodId ? '● ' : '') + esc(C.periodLabel(pp)) + ' ' + pp.start.slice(0, 4) + '</span><span class="r">' + n + ' mov.' + (pend ? ' · ' + pend + ' pend.' : '') + ' ›</span></button>';
    }).join('') + '</div>' +
      '<div class="btn-row"><button class="btn plain sm" data-a="period-pick" data-v="' + C.shiftPeriodId(UI.periodId, -1) + '">‹ Anterior</button><button class="btn plain sm" data-a="period-pick" data-v="' + C.shiftPeriodId(UI.periodId, 1) + '">Siguiente ›</button></div>' +
      '<div class="set-h">Ajustar fechas de este periodo</div><div class="card"><div class="row-between" style="gap:8px"><label class="field" style="margin:0;flex:1"><span>Desde</span><input class="input" type="date" id="ov-start" value="' + (ov.start || p.start) + '"></label>' +
      '<label class="field" style="margin:0;flex:1"><span>Hasta</span><input class="input" type="date" id="ov-end" value="' + (ov.end || p.end) + '"></label></div>' +
      '<div class="btn-row"><button class="btn plain sm" data-a="ov-reset">Automático</button><button class="btn sm" data-a="ov-save">Guardar fechas</button></div></div>';
    openSheet('Periodo', body);
  }

  function openV2Sheet() {
    openSheet('Presupuesto de la v2', '<p class="sub">En tu app v2 pulsa “Export All” para descargar el JSON de perfiles y elígelo aquí. Se aplicará al periodo ' + esc(C.periodLabel(period())) + '.</p>' +
      '<label class="btn ghost file-btn" style="margin-top:12px">📂 Elegir JSON<input type="file" accept=".json,application/json" data-c="v2-file"></label><div id="v2-res"></div>');
  }

  // ───────────────────────── Copias y exportación ─────────────────────────
  async function doBackup() {
    const data = {
      app: 'conciliador', version: 1, exportedAt: new Date().toISOString(),
      kv: { settings: S.settings, categories: S.categories, budgets: S.budgets, rules: S.rules, decisions: S.decisions, rejected: S.rejected, partner: S.partner, savings: S.savings, savingsPin: S.savingsPin },
      movements: Object.values(S.movements), matches: Object.values(S.matches),
    };
    const ok = await downloadFile('copia-conciliador-' + today() + '.json', JSON.stringify(data), 'application/json');
    if (ok) { S.settings.lastBackupAt = Date.now(); await DB.setKV('settings', S.settings); render(); toast('Copia creada. Guárdala en Archivos o iCloud.'); }
  }
  async function doRestore(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'conciliador' || !data.kv) throw new Error('No es una copia de esta app.');
      if (!confirm('¿Restaurar la copia del ' + (data.exportedAt || '').slice(0, 10) + '? Se reemplazan todos los datos actuales.')) return;
      await DB.restoreAll(data); await load(); recompute(); pickInitialPeriod(); render(); toast('Copia restaurada');
    } catch (e) { toast('No se pudo restaurar: ' + e.message); }
  }
  function exportCSV() {
    const p = period(); const E = entries();
    if (!E.length) { toast('No hay movimientos en este periodo'); return; }
    const pend = pendingCount();
    if (pend && !confirm('Quedan ' + pend + ' movimientos sin revisar. ¿Exportar igualmente?')) return;
    downloadFile('toshl-conciliado-' + p.start + '_' + p.end + '.csv', C.toToshlCSV(E), 'text/csv');
  }
  function exportJSON() {
    const p = period(); const E = entries();
    if (!E.length) { toast('No hay movimientos en este periodo'); return; }
    downloadFile('libro-' + p.id + '.json', C.toLedgerJSON(E, p), 'application/json');
  }

  // ───────────────────────── Eventos ─────────────────────────
  /** Ir a otra pestaña recordando de dónde vienes (para el botón ‹ Volver). */
  function goWithBack(tab, setup) {
    UI.back = { tab: UI.tab, sub: UI.sub, budgetView: UI.budgetView, homeView: UI.homeView, y: window.scrollY, mov: clone(UI.mov), conc: clone(UI.conc), open: clone(UI.open) };
    if (setup) setup();
    UI.tab = tab; render(); window.scrollTo(0, 0);
    try { history.pushState({ back: true }, ''); } catch (e) { /* sin historial */ }
  }
  function goBack() {
    const b = UI.back; if (!b) return;
    UI.back = null; closeSheet();
    Object.assign(UI, { tab: b.tab, sub: b.sub, budgetView: b.budgetView, homeView: b.homeView, mov: b.mov, conc: b.conc, open: b.open });
    render(); requestAnimationFrame(() => window.scrollTo(0, b.y));
  }
  try { history.scrollRestoration = 'manual'; } catch (e) { /* no soportado */ }
  window.addEventListener('popstate', () => { if (UI.back) goBack(); });

  const A = {
    'tab': (v) => { UI.back = null; UI.savUnlocked = false; UI.tab = v; if (v !== 'conc') UI.sub = null; render(); window.scrollTo(0, 0); },
    'nav-back': () => { if (history.state && history.state.back) history.back(); else goBack(); },
    'go-import': () => { UI.tab = 'conc'; UI.sub = 'import'; render(); window.scrollTo(0, 0); },
    'import-back': () => { UI.sub = null; render(); },
    'go-pending': () => goWithBack('conc', () => { UI.sub = null; UI.conc.group = 'pending'; }),
    'toast-undo': () => { const f = toast.undo; $('#toast-root').innerHTML = ''; if (f) f(); },
    'sheet-close': () => closeSheet(),
    'period-sheet': () => openPeriodSheet(),
    'period-pick': (v) => { UI.periodId = v; closeSheet(); render(); },
    'ov-save': () => {
      const st = $('#ov-start').value, en = $('#ov-end').value;
      if (!C.isValidISO(st) || !C.isValidISO(en) || en < st) { toast('Fechas no válidas'); return; }
      closeSheet(); mutate('Fechas del periodo guardadas', () => { S.settings.overrides[UI.periodId] = { start: st, end: en }; });
    },
    'ov-reset': () => { closeSheet(); mutate('Periodo automático', () => { delete S.settings.overrides[UI.periodId]; }); },
    'mov-kind': (v) => { UI.mov.kind = v; UI.mov.limit = 150; render(); },
    'mov-more': () => { UI.mov.limit += 200; renderMovList(); },
    'cat-movs': (v) => { closeSheet(); goWithBack('movs', () => { UI.mov = Object.assign({}, UI.mov, { cat: v, kind: 'all', q: '', status: '', type: '', source: '', limit: 150 }); }); },
    'conc-group': (v) => { UI.conc.group = v; UI.conc.limit = 80; render(); },
    'conc-more': () => { UI.conc.limit += 100; renderConcList(); },
    'confirm-match': (v) => mutate('Confirmado', () => { const m = S.matches[v]; m.status = 'confirmed'; learnFromMatch(m); }),
    'reject-match': (v) => mutate('Rechazado: quedan separados', () => { const m = S.matches[v]; rejectPairs(m.toshlIds, m.bankIds); delete S.matches[v]; }),
    'unmatch': (v) => { closeSheet(); mutate('Emparejamiento deshecho', () => { const m = S.matches[v]; if (!m) return; rejectPairs(m.toshlIds, m.bankIds); delete S.matches[v]; }); },
    'change-match': (v) => {
      const m = S.matches[v]; if (!m) return;
      if (m.toshlIds.length === 1) openLink(m.toshlIds, 'bank', m.bankIds, v); else openLink(m.bankIds, 'toshl', m.toshlIds, v);
    },
    'link': (v) => {
      const e = findEntry(v); if (!e) return; closeSheet();
      if (e.status === 'bank_only') openLink(e.bankIds, 'toshl', [], null); else if (e.status === 'toshl_only') openLink(e.toshlIds, 'bank', [], null);
    },
    'link-filter': (v) => { UI.link.filter = v; renderLink(); },
    'link-toggle': (v) => { const s = UI.link.sel; if (s.has(v)) s.delete(v); else s.add(v); renderLink(); },
    'link-save': () => saveLink(false),
    'link-none': () => saveLink(true),
    'accept-sug': (v) => {
      const e = findEntry(v); if (!e) return;
      if (e.treatment === 'refund' && !e.category) { toast('Elige de qué categoría se resta'); return; }
      mutate('Aceptado', () => {
        S.decisions[v] = { category: e.category, subcategory: e.subcategory, treatment: e.treatment };
        if (e.bankDescription && e.treatment !== 'excluded') S.rules = C.learnRule(S.rules, e.bankDescription, e.category, e.subcategory, e.treatment, false);
      });
    },
    'quick-cat': (v) => {
      const [id, cat] = v.split('|'); const e = findEntry(id); if (!e) return;
      mutate(cat + ' asignado', () => {
        const treatment = e.sign > 0 ? 'refund' : 'expense';
        S.decisions[id] = { category: cat, subcategory: '', treatment };
        if (e.bankDescription) S.rules = C.learnRule(S.rules, e.bankDescription, cat, '', treatment, false);
      });
    },
    'quick-exclude': (v) => { const e = findEntry(v); if (!e) return; mutate('Excluido', () => { S.decisions[v] = { category: e.category, subcategory: e.subcategory, treatment: 'excluded' }; }); },
    'toshl-keep': (v) => { const e = findEntry(v); if (!e) return; mutate('Mantenido', () => { S.decisions[v] = { category: e.category, subcategory: e.subcategory, treatment: e.treatment }; }); },
    'set-treat': (v) => {
      const [id, t] = v.split('|'); const e = findEntry(id); if (!e) return;
      if (t === 'refund') { mutate('Reembolso: elige la categoría', () => { S.decisions[id] = { category: e.category || '', subcategory: '', treatment: 'refund' }; }, { silent: true }); return; }
      mutate(TREAT_LABEL[t], () => {
        S.decisions[id] = { category: t === 'income' ? (e.category && isIncomeCat(e.category) ? e.category : (L.known.find(isIncomeCat) || '')) : e.category, subcategory: '', treatment: t };
        if (e.bankDescription) S.rules = C.learnRule(S.rules, e.bankDescription, S.decisions[id].category, '', t, false);
      });
    },
    'edit-entry': (v) => openEditEntry(v),
    'edit-treat': (v) => { UI.editTreat = v; $$('#treat-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); },
    'save-entry': (v) => saveEditEntry(v),
    'reset-entry': (v) => { closeSheet(); mutate('Restablecido', () => { delete S.decisions[v]; }); },
    'export-csv': () => exportCSV(),
    'export-json': () => exportJSON(),
    'rematch': () => mutate('Emparejamiento repetido', () => { const n = runMatching(); setTimeout(() => toast(n.auto + ' conciliados · ' + n.possible + ' posibles nuevos'), 50); }, { silent: true }),
    'toggle-cat': (v) => { UI.open[v] = !UI.open[v]; render(); },
    'budget-view': (v) => { UI.budgetView = v; render(); },
    'check-update': async () => {
      if (!navigator.onLine) { toast('Sin conexión. Conéctate para buscar la versión nueva.'); return; }
      toast('Buscando versión nueva…');
      try {
        const reg = UI.swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
        if (reg) await reg.update();
        const res = await fetch('js/app.js?ts=' + Date.now(), { cache: 'no-store' });
        const m = (await res.text()).match(/APP_VERSION = '([^']+)'/);
        if (m && m[1] !== APP_VERSION) {
          toast('Instalando v' + m[1] + '…');
          if (reg && reg.waiting) reg.waiting.postMessage('skip');
          setTimeout(() => location.reload(), 2500);
        } else if (m) toast('Ya tienes la última versión (v' + APP_VERSION + ').');
        else toast('No se pudo comprobar. ¿Está activo GitHub Pages?');
      } catch (e) { toast('No se pudo comprobar: ' + e.message); }
    },
    'close-item': (v) => {
      const [cat, sub] = v.split('|');
      mutate((sub ? cat + ' › ' + sub : cat) + ': no cuenta lo que faltaba', () => {
        const id = UI.periodId; const info = budgetInfo(id);
        if (!S.budgets[id]) S.budgets[id] = clone(info.budget || { cats: {} });
        delete S.budgets[id].closedFrom;
        S.budgets[id].closed = Object.assign({}, S.budgets[id].closed || {}, { [v]: true });
      });
    },
    'explain': (v) => { closeSheet(); openExplain(v); },
    'reopen-key': (v) => mutate('Deshecho: ' + v.replace('|', ' › ') + ' vuelve a contar', () => {
      const b = S.budgets[UI.periodId]; if (b && b.closed) delete b.closed[v];
    }),
    'reopen-cat': (v) => mutate(v + ' reabierta', () => {
      const b = S.budgets[UI.periodId]; if (!b || !b.closed) return;
      Object.keys(b.closed).forEach((k) => { if (k === v || k.startsWith(v + '|')) delete b.closed[k]; });
    }),
    'hist-open': (v) => { UI.periodId = v; UI.budgetView = 'period'; render(); window.scrollTo(0, 0); },
    'hist-cat': (v) => { UI.histOpen[v] = !UI.histOpen[v]; render(); },
    'budget-edit': () => openBudgetEditor(),
    'bed-clear': (v, el) => { const card = el.closest('.bed'); $('[data-f="amount"]', card).value = ''; $$('.subrow', card).forEach((r) => r.remove()); bedRecalc(); toast('Se guardará a 0 al pulsar Guardar'); },
    'budget-dup': () => {
      const rows = [1, 2, 3, -1, -2].map((k) => C.shiftPeriodId(UI.periodId, k)).map((id) => {
        const own = !!S.budgets[id]; const pp = period(id);
        return '<button class="li2" data-a="budget-dup-to" data-v="' + id + '"><span class="l"><b>' + esc(C.periodLabel(pp)) + ' ' + pp.start.slice(0, 4) + '</b><span class="sub" style="display:block">' +
          (own ? 'Ya tiene presupuesto propio (' + money(budgetTotalOf(S.budgets[id])) + '): se reemplazará' : 'Sin presupuesto propio') + '</span></span><span class="chev">›</span></button>';
      });
      openSheet('Duplicar presupuesto', '<p class="sub">Se copia el presupuesto de <b>' + esc(C.periodLabel(period())) + '</b> (' + money(budgetTotalOf(budgetInfo().budget)) + ') al mes que elijas, y se abre para que lo cambies.</p><div class="set-h">Próximos meses</div><div class="list">' + rows.slice(0, 3).join('') + '</div><div class="set-h">Meses anteriores</div><div class="list">' + rows.slice(3).join('') + '</div>');
    },
    'budget-dup-to': async (v) => {
      const src = budgetInfo().budget; if (!src) { toast('Este periodo no tiene presupuesto que copiar'); return; }
      if (S.budgets[v] && !confirm('Ese mes ya tiene presupuesto propio. ¿Reemplazarlo por una copia de este?')) return;
      closeSheet();
      await mutate('Copiado a ' + C.periodLabel(period(v)), () => { const b = clone(src); delete b.closed; S.budgets[v] = b; });
      UI.periodId = v; render(); openBudgetEditor();
    },
    'budget-save': () => saveBudgetEditor(),
    'budget-copy': () => { const info = budgetInfo(); if (!info.budget) return; mutate('Presupuesto guardado en este periodo', () => { S.budgets[UI.periodId] = clone(info.budget); delete S.budgets[UI.periodId].closed; }); },
    'budget-copy-prev': () => {
      const prev = S.budgets[C.shiftPeriodId(UI.periodId, -1)]; if (!prev) return;
      if (S.budgets[UI.periodId] && !confirm('¿Reemplazar el presupuesto de este periodo por el del anterior?')) return;
      mutate('Copiado del periodo anterior', () => { S.budgets[UI.periodId] = clone(prev); delete S.budgets[UI.periodId].closed; });
    },
    'bed-more': (v, el) => { $('.opts', el.closest('.bed')).classList.toggle('hidden'); },
    'bed-type': (v, el) => { $$('.seg button', el.closest('.seg')).forEach((b) => b.classList.toggle('on', b === el)); },
    'bed-addsub': (v, el) => { $('.subs', el.closest('.field')).insertAdjacentHTML('beforeend', subRow('', 0)); },
    'bed-delsub': (v, el) => { el.closest('.subrow').remove(); },
    'bed-addcat': () => {
      const name = $('#bed-newcat').value.trim(); if (!name) return;
      if ($$('.bed').some((b) => b.dataset.cat === name)) { toast('Ya existe'); return; }
      S.categories[name] = S.categories[name] || { icon: guessIcon(name), type: 'variable' };
      DB.setKV('categories', S.categories); L.known.push(name);
      const tmp = document.createElement('div');
      tmp.innerHTML = '<div class="bed" data-cat="' + esc(name) + '"><div class="h"><span class="nm">' + guessIcon(name) + ' ' + esc(name) + '</span><input class="money-in" inputmode="decimal" data-f="amount" data-i="bed-sum" placeholder="0,00"><button class="more-btn" data-a="bed-more">⋯</button></div>' +
        '<div class="opts"><div class="seg" style="margin:0 0 8px"><button data-a="bed-type" data-v="fixed">Fijo</button><button class="on" data-a="bed-type" data-v="variable">Variable</button></div>' +
        '<label class="field"><span>Día habitual de pago (fijos)</span><input class="input" inputmode="numeric" data-f="due"></label><label class="check"><input type="checkbox" data-f="estimate"> Importe que cambia: mostrar como estimado</label>' +
        '<label class="check"><input type="checkbox" data-f="savings"> Es ahorro / inversión</label><label class="field"><span>Icono</span><input class="input" data-f="icon" value="' + guessIcon(name) + '" maxlength="4"></label>' +
        '<div class="field"><span>Subcategorías con presupuesto (opcional)</span><div class="subs"></div><button class="btn plain sm" style="margin-top:6px" data-a="bed-addsub">+ Subcategoría</button></div></div></div>';
      $('#bed-newcat').closest('.row-between').before(tmp.firstChild); $('#bed-newcat').value = '';
    },
    'v2-sheet': () => openV2Sheet(),
    'home-view': (v) => { if (v !== 'savings') UI.savUnlocked = false; UI.homeView = v; render(); },
    'sav-new': (v) => openSavingsForm(v),
    'sav-acc': (v) => { $('#sav-account').value = v; },
    'sav-lock': () => lockSavings(),
    'pin-create': async () => {
      const a = $('#pin1').value, b = $('#pin2').value;
      if (!/^\d{4}$/.test(a)) { $('#pin-msg').textContent = 'El PIN debe tener 4 números.'; return; }
      if (a !== b) { $('#pin-msg').textContent = 'Los dos PIN no coinciden.'; return; }
      await setPin(a); UI.savUnlocked = true; render(); toast('PIN creado. Se pedirá cada vez que entres a Ahorros.');
    },
    'pin-forgot': async () => {
      if (!confirm('Sin el PIN no se pueden ver los ahorros. Puedes restaurar una copia de seguridad (Ajustes) o BORRAR los ahorros y crear un PIN nuevo. ¿Borrar ahorros y PIN?')) return;
      if (!confirm('Se borrarán todos los apuntes de ahorro de este iPhone. ¿Seguro?')) return;
      S.savings = { entries: [] }; S.savingsPin = null;
      await Promise.all([DB.setKV('savings', S.savings), DB.setKV('savingsPin', null)]); render(); toast('Ahorros y PIN borrados');
    },
    'pin-change': async () => {
      const cur = prompt('PIN actual'); if (cur === null) return;
      if (!(await checkPin(cur))) { toast('PIN incorrecto'); return; }
      const n1 = prompt('Nuevo PIN (4 números)'); if (n1 === null) return;
      if (!/^\d{4}$/.test(n1)) { toast('El PIN debe tener 4 números'); return; }
      const n2 = prompt('Repite el nuevo PIN'); if (n1 !== n2) { toast('No coinciden'); return; }
      await setPin(n1); toast('PIN cambiado');
    },
    'sav-edit': (v) => openSavingsForm(null, v),
    'sav-type': (v) => {
      UI.savType = v; $$('#sav-type button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      $('#sav-help').textContent = savHelp(v);
      $('#sav-from-wrap').classList.toggle('hidden', v !== 'loan' || !S.savings.entries.some((x) => x.type === 'deposit'));
    },
    'sav-save': (v) => {
      const cents = C.parseAmount($('#sav-amount').value);
      if (!Number.isFinite(cents) || cents <= 0) { toast('Escribe un importe mayor que 0'); return; }
      const date = $('#sav-date').value;
      if (!C.isValidISO(date)) { toast('Elige una fecha'); return; }
      const type = UI.savType;
      const from = type === 'loan' ? ($('#sav-from') ? $('#sav-from').value : '') : '';
      let account = $('#sav-account').value.trim();
      if (!account && from) { const src = S.savings.entries.find((x) => x.id === from); if (src) account = src.account || ''; }
      const data = { type, cents: Math.abs(cents), date, name: $('#sav-name').value.trim(), comment: $('#sav-comment').value.trim(), from, account };
      const rp = $('#sav-repaid');
      closeSheet();
      mutate(v ? 'Guardado' : SAV_LABEL[type] + ' añadida' + (type === 'deposit' ? '' : ''), () => {
        if (v) {
          const e = S.savings.entries.find((x) => x.id === v); if (!e) return;
          Object.assign(e, data);
          if (type !== 'loan') delete e.repaidAt; else if (rp) e.repaidAt = rp.checked ? (e.repaidAt || today()) : null;
        } else S.savings.entries.push(Object.assign({ id: 's_' + C.hashId(String(Date.now()) + Math.random()), createdAt: Date.now() }, data));
      });
    },
    'sav-repay': (v) => {
      const e = S.savings.entries.find((x) => x.id === v); if (!e) return;
      mutate(e.repaidAt ? 'Préstamo marcado como pendiente' : 'Préstamo devuelto: ' + money(e.cents) + ' vuelven a tus ahorros', () => { e.repaidAt = e.repaidAt ? null : today(); });
    },
    'sav-del': (v) => {
      if (!confirm('¿Borrar este apunte de ahorro?')) return;
      closeSheet(); mutate('Apunte borrado', () => { S.savings.entries = S.savings.entries.filter((x) => x.id !== v); S.savings.entries.forEach((x) => { if (x.from === v) x.from = ''; }); });
    },
    'partner-edit': () => openPartnerEditor(),
    'partner-save': () => savePartnerEditor(),
    'partner-copy': () => { const pi = partnerInfo(); if (!pi.data) return; mutate('Guardado en este periodo', () => { S.partner.periods[UI.periodId] = clone(pi.data); }); },
    'partner-clear': () => { closeSheet(); mutate('Datos quitados', () => { delete S.partner.periods[UI.periodId]; }); },
    'p-add': () => { $('#p-items').insertAdjacentHTML('beforeend', partnerRow({})); },
    'p-del': (v, el) => { el.closest('.subrow').remove(); },
    'balance-sheet': () => openBalanceSheet(),
    'balance-save': () => {
      const c = C.parseAmount($('#bal-in').value);
      if (!Number.isFinite(c) || $('#bal-in').value.trim() === '') { toast('Escribe un importe (ej. 2450 o 2.450,00)'); return; }
      closeSheet(); mutate('Saldo guardado', () => { S.settings.balance = { cents: c, date: today(), source: 'manual' }; });
    },
    'balance-clear': () => { closeSheet(); mutate('Saldo quitado', () => { S.settings.balance = null; }); },
    'v2-apply': (v) => {
      const r = UI.v2; if (!r) return;
      const data = C.fromV2Profiles(r.raw, v);
      closeSheet();
      mutate('Presupuesto “' + data.name + '” importado', () => {
        S.budgets[UI.periodId] = { cats: data.cats };
        Object.entries(data.meta).forEach(([c, m]) => { S.categories[c] = Object.assign({ icon: guessIcon(c) }, S.categories[c] || {}, { type: m.type }); });
        if (S.categories.Investment) S.categories.Investment.savings = true;
      });
    },
    'hol-add': () => {
      const d = $('#hol-date').value, n = $('#hol-name').value.trim();
      if (!C.isValidISO(d)) { toast('Elige una fecha'); return; }
      mutate('Festivo añadido', () => { S.settings.holidays = (S.settings.holidays || []).filter((h) => h.date !== d).concat([{ date: d, name: n }]); }, { silent: true });
    },
    'hol-del': (v) => mutate('Festivo quitado', () => { S.settings.holidays = S.settings.holidays.filter((h) => h.date !== v); }),
    'rules-sheet': () => openRules(),
    'rule-edit': (v) => { closeSheet(); openRuleEdit(v); },
    'rule-save': (v) => {
      const pat = C.normText($('#ru-pat').value);
      if (pat.length < 3) { toast('El patrón necesita al menos 3 letras'); return; }
      const r = { id: v || 'r_' + C.hashId(pat + Date.now()), pattern: pat, treatment: $('#ru-treat').value, category: $('#ru-cat').value, subcategory: $('#ru-sub').value.trim(), manual: true, learned: false };
      if (r.treatment === 'expense' && !r.category) { toast('Elige una categoría'); return; }
      closeSheet();
      mutate('Regla guardada', () => { S.rules = S.rules.filter((x) => x.id !== r.id && C.normText(x.pattern) !== pat).concat([r]); });
    },
    'rule-del': (v) => { closeSheet(); mutate('Regla borrada', () => { S.rules = S.rules.filter((x) => x.id !== v); }); },
    'backup': () => doBackup(),
    'clear-all': async () => {
      if (!confirm('¿Borrar TODOS los datos de este iPhone? Haz antes una copia de seguridad.')) return;
      if (!confirm('Esto no se puede deshacer. ¿Seguro?')) return;
      await DB.clearAll(); await load(); recompute(); pickInitialPeriod(); UI.tab = 'home'; render(); toast('Datos borrados');
    },
    'imp-mode': (v) => { const [k, m] = v.split('|'); UI.draft[k + 'Mode'] = m; render(); },
    'imp-commit': () => commitImport(),
  };
  const CH = {
    'mov-filter': (v, el) => { UI.mov[v] = el.value; UI.mov.limit = 150; render(); },
    'refund-cat': (v, el) => {
      const e = findEntry(v); if (!e || !el.value) return;
      mutate('Reembolso de ' + el.value, () => {
        S.decisions[v] = { category: el.value, subcategory: '', treatment: 'refund' };
        if (e.bankDescription) S.rules = C.learnRule(S.rules, e.bankDescription, el.value, '', 'refund', false);
      });
    },
    'imp-file': async (v, el) => {
      const f = el.files && el.files[0]; if (!f) return;
      try {
        const r = v === 'bank' ? await readBankFile(f) : C.parseToshl(await f.text());
        r.name = f.name; r.kind = v; UI.draft[v] = r;
      } catch (e) { UI.draft[v] = { movements: [], error: 'Archivo no válido: ' + e.message, kind: v }; }
      refreshImport();
    },
    'imp-period': (v, el) => { UI.draft.periodId = el.value; $('#imp-period').innerHTML = importPeriodCard(); },
    'set-startday': (v, el) => {
      const n = parseInt(el.value, 10); if (!(n >= 1 && n <= 28)) { toast('Entre 1 y 28'); render(); return; }
      mutate('Día de inicio: ' + n, () => { S.settings.startDay = n; });
    },
    'set-toggle': (v, el) => mutate('Guardado', () => { S.settings[v] = el.checked; }, { silent: true }),
    'restore': (v, el) => { const f = el.files && el.files[0]; if (f) doRestore(f); el.value = ''; },
    'v2-file': async (v, el) => {
      const f = el.files && el.files[0]; if (!f) return;
      try {
        const raw = JSON.parse(await f.text()); const r = C.fromV2Profiles(raw);
        UI.v2 = { raw };
        $('#v2-res').innerHTML = '<div class="set-h">Elige el perfil</div><div class="list">' + r.profiles.map((p) => '<button class="li2" data-a="v2-apply" data-v="' + esc(p.id) + '"><span class="l">' + esc(p.name) + '</span><span class="chev">›</span></button>').join('') + '</div>';
      } catch (e) { $('#v2-res').innerHTML = '<div class="file-res err">⚠️ ' + esc(e.message) + '</div>'; }
    },
  };
  const IN = {
    'bed-sum': () => bedRecalc(),
    'pin-in': async (v, el) => {
      if (v !== 'check' || el.value.length < 4) return;
      if (Date.now() < UI.pinLockUntil) return;
      const ok = await checkPin(el.value);
      if (ok) { UI.savUnlocked = true; UI.pinFails = 0; render(); return; }
      UI.pinFails++; el.value = '';
      if (UI.pinFails >= 5) { UI.pinLockUntil = Date.now() + 30000; UI.pinFails = 0; render(); setTimeout(render, 30500); return; }
      $('#pin-msg').textContent = 'PIN incorrecto (' + UI.pinFails + '/5).';
    },
    'mov-q': debounce((v, el) => { UI.mov.q = el.value; UI.mov.limit = 150; renderMovList(); }, 180),
    'conc-q': debounce((v, el) => { UI.conc.q = el.value; renderConcList(); }, 180),
    'link-q': debounce((v, el) => { UI.link.q = el.value; renderLink(); }, 150),
    'imp-paste': debounce((v, el) => {
      const txt = el.value.trim();
      UI.draft[v] = txt ? Object.assign(v === 'bank' ? C.parseBankText(txt) : C.parseToshl(txt), { name: 'Texto pegado', kind: v }) : null;
      refreshImport();
    }, 300),
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-a]'); if (!el || el.disabled) return;
    const fn = A[el.dataset.a]; if (fn) { ev.preventDefault(); fn(el.dataset.v, el, ev); }
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-c]'); if (el && CH[el.dataset.c]) CH[el.dataset.c](el.dataset.v, el, ev);
    if (ev.target.id === 'ed-cat') $('#ed-new-wrap').classList.toggle('hidden', ev.target.value !== '__new');
  });
  document.addEventListener('input', (ev) => { const el = ev.target.closest('[data-i]'); if (el && IN[el.dataset.i]) IN[el.dataset.i](el.dataset.v, el, ev); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet(); });

  // ───────────────────────── Inicio de la app ─────────────────────────
  function pickInitialPeriod() {
    const cfg = periodCfg();
    const cur = C.periodIdForDate(today(), cfg);
    const withData = Object.keys(L.byPeriod).sort();
    UI.periodId = L.byPeriod[cur] || !withData.length ? cur : withData[withData.length - 1];
  }
  async function start() {
    try {
      await load(); recompute(); pickInitialPeriod(); render();
      UI.persisted = await DB.persist();
    } catch (e) {
      $('#view').innerHTML = '<div class="empty"><div class="big-ic">⚠️</div><h2>No se pudo abrir el almacenamiento</h2><p>' + esc(e.message) + '. Si usas navegación privada, ábrela en modo normal.</p></div>';
    }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      // Cuando se activa una versión nueva, recarga sola (una vez) para usarla.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded || $('#sheet-root').innerHTML) return;
        reloaded = true; location.reload();
      });
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then((reg) => {
        UI.swReg = reg;
        reg.update().catch(() => {});
      }).catch(() => { /* sin service worker: la app funciona igual con conexión */ });
    }
  }
  window.addEventListener('pageshow', () => { if (S.settings) render(); });
  start();
})();
