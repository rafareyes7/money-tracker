/* tests.js — Tests de las funciones puras. Se ejecutan en tests.html (navegador) o con: node js/tests.js */
(function () {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports !== undefined && typeof require === 'function' && typeof window === 'undefined'
    ? require('./core.js') : window.Core;
  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, msg: e.message }); }
  }
  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'esperado ' + b + ', obtenido ' + a);
  }
  function ok(v, msg) { if (!v) throw new Error(msg || 'esperado verdadero'); }

  // ─── Datos de ejemplo (formatos reales) ───
  const BANK_ROWS = [
    ['Número de cuenta: ES00 0000 0000 0000 0000 0000'],
    ['Titular: NOMBRE APELLIDO'],
    ['Fecha de exportación: 24/10/2026'],
    ['F. VALOR', 'CATEGORÍA', 'SUBCATEGORÍA', 'DESCRIPCIÓN', 'COMENTARIO', 'IMPORTE (€)', 'SALDO (€)'],
    [46314, 'Compras', 'Suscripciones', 'Pago en CLAUDE.AI SUBSCRIPTION SAN FRANCISCO US', '', -18, 1200.5], // 19/10/2026
    [46307, 'Salud', 'Farmacia', 'Pago en FARMACIA DIAGONAL 412 BARCELONA ES', '', -12.4, 1218.5],         // 12/10/2026
    [46297, 'Alimentación', 'Supermercado', 'Pago en LIDL BCN-MERCAT VALL D BARCELONA ES', '', -45.25, 1230.9], // 02/10/2026
    [46295, 'Ingresos', 'Nómina', 'Nomina recibida EMPRESA SA', '', 3850, 1276.15],                     // 30/09/2026
    [46291, 'Alimentación', 'Supermercado', 'Pago en CAPRABO 7762 BARCELONA ES', '', -21.66, -2573.85],  // 26/09/2026
    [46287, 'Alimentación', 'Supermercado', 'Pago en MERCADONA SANTS BARCELONA ES', '', -30, -2552.19],  // 22/09/2026
  ];
  const TOSHL_CSV = [
    '"Fecha","Cuenta","Categoría","Etiquetas","Cantidad de gasto","Cantidad de ingreso","Divisa","En la divisa principal","Divisa principal","Descripción"',
    '"25/9/26","Cash","Groceries","supermercado","21,66","0","EUR","-21,66","EUR","Caprabo"',
    '"30/9/26","Cash","Salario","","0","3.850,00","EUR","3.850,00","EUR",""',
    '"2/10/26","Cash","Groceries","","45,25","0","EUR","-45,25","EUR","Lidl"',
    '"16/10/26","Cash","Subscriptions","ia","18,00","0","EUR","-18,00","EUR","Claude"',
    '"6/10/26","Cash","Eating out","","3,20","0","EUR","-3,20","EUR","Café"',
  ].join('\n');

  // ─── Casos pedidos ───
  test('El periodo de oct-2026 empieza el 26/10 (el 25 es domingo)', () => {
    eq(C.getPeriod('2026-10').start, '2026-10-26');
  });
  test('"5.324,00" → 532400 céntimos', () => { eq(C.parseAmount('5.324,00'), 532400); });
  test('Caprabo 21,66 € (Toshl 25/09) se empareja con el cargo del banco del mismo importe', () => {
    const bank = C.parseBankRows(BANK_ROWS).movements, toshl = C.parseToshl(TOSHL_CSV).movements;
    const m = C.matchMovements(bank, toshl);
    const t = toshl.find((x) => x.description === 'Caprabo');
    const b = bank.find((x) => /CAPRABO/.test(x.description));
    const found = m.find((x) => x.toshlIds.includes(t.id));
    ok(found, 'no hay emparejamiento');
    eq(found.bankIds, [b.id]); eq(found.status, 'auto');
  });
  test('Un gasto solo en banco aparece en "Solo en banco"', () => {
    const bank = C.parseBankRows(BANK_ROWS).movements, toshl = C.parseToshl(TOSHL_CSV).movements;
    const movements = {}; bank.concat(toshl).forEach((x) => { movements[x.id] = x; });
    const matches = {}; C.matchMovements(bank, toshl).forEach((x) => { matches[x.id] = x; });
    const led = C.buildLedger({ movements, matches, decisions: {}, rules: C.DEFAULT_RULES, knownCats: ['Groceries', 'Extra', 'Health'] });
    const farm = led.find((e) => /FARMACIA/.test(e.description));
    eq(farm.status, 'bank_only'); eq(farm.resolved, false);
  });

  // ─── Importes ───
  test('Importes en varios formatos', () => {
    eq(C.parseAmount('21,66'), 2166); eq(C.parseAmount('-1.234,56'), -123456); eq(C.parseAmount('1.234'), 123400);
    eq(C.parseAmount('21.66'), 2166); eq(C.parseAmount('−12,40 €'), -1240); eq(C.parseAmount(-21.66), -2166);
    eq(C.parseAmount(''), 0); ok(Number.isNaN(C.parseAmount('abc')));
  });
  test('Formato es-ES con miles', () => { eq(C.formatMoney(123456), '1.234,56 €'); eq(C.formatMoney(-50), '−0,50 €'); });

  // ─── Fechas y periodo ───
  test('Fecha de Excel → ISO', () => { eq(C.excelSerialToISO(46291), '2026-09-26'); });
  test('Fechas d/m/aa de Toshl', () => { eq(C.parseDateAny('2/10/26'), '2026-10-02'); eq(C.parseDateAny('31/02/26'), null); });
  test('Periodo sep-2026: 25/09 – 25/10', () => { const p = C.getPeriod('2026-09'); eq([p.start, p.end], ['2026-09-25', '2026-10-25']); });
  test('Festivo configurado se salta', () => {
    eq(C.getPeriod('2026-12', { holidays: ['2026-12-25'] }).start, '2026-12-28'); // 25 vie festivo → lun 28
  });
  test('Periodo de una fecha y detección automática', () => {
    eq(C.periodIdForDate('2026-10-25', {}), '2026-09'); eq(C.periodIdForDate('2026-10-26', {}), '2026-10');
    eq(C.detectPeriodId(['2026-09-22', '2026-09-26', '2026-10-02', '2026-10-16'], {}), '2026-09');
  });

  // ─── Parseo ───
  test('Banco: ignora metadatos y lee movimientos', () => {
    const r = C.parseBankRows(BANK_ROWS);
    eq(r.movements.length, 6); eq(r.movements[0].date, '2026-10-19'); eq(r.movements[0].cents, -1800);
    ok(!JSON.stringify(r).includes('ES00'), 'no debe guardar la cuenta'); ok(!JSON.stringify(r).includes('Titular'));
  });
  test('Banco: lee el saldo del movimiento más reciente', () => {
    eq(C.parseBankRows(BANK_ROWS).balance, { cents: 120050, date: '2026-10-19' });
  });
  test('Proyección de saldo al final del periodo', () => {
    const p = C.projectBalance({ available: 30000, pendingTotal: 50000, varProjected: 90000, varSpent: 50000 }, 200000);
    eq(p.ifBudget, 120000); eq(p.atPace, 110000);
    eq(C.projectBalance({ available: 0 }, NaN), null);
  });
  test('Banco: texto pegado (tabulado)', () => {
    const txt = BANK_ROWS.slice(3).map((r, i) => i === 0 ? r.join('\t') : ['19/10/2026', r[1], r[2], r[3], r[4], String(r[5]).replace('.', ','), ''].join('\t')).join('\n');
    const r = C.parseBankText(txt); eq(r.movements.length, 6); eq(r.movements[4].cents, -2166);
  });
  test('Toshl: gasto, ingreso, etiqueta y descripción vacía', () => {
    const r = C.parseToshl(TOSHL_CSV).movements;
    eq(r.length, 5); eq(r[0].cents, -2166); eq(r[0].subcategory, 'supermercado'); eq(r[1].cents, 385000); eq(r[1].description, '');
  });
  test('IDs estables al reimportar (no se duplica)', () => {
    eq(C.parseToshl(TOSHL_CSV).movements.map((x) => x.id), C.parseToshl(TOSHL_CSV).movements.map((x) => x.id));
  });

  // ─── Emparejamiento ───
  test('Fecha valor 3 días después (Claude 16/10 ↔ 19/10)', () => {
    const bank = C.parseBankRows(BANK_ROWS).movements, toshl = C.parseToshl(TOSHL_CSV).movements;
    const m = C.matchMovements(bank, toshl);
    const t = toshl.find((x) => x.description === 'Claude');
    ok(m.some((x) => x.toshlIds[0] === t.id && x.status === 'auto'));
  });
  test('Similitud de comercios', () => {
    ok(C.similarity('Lidl', 'Pago en LIDL BCN-MERCAT VALL D BARCELONA ES') === 1);
    ok(C.similarity('Caprabo', 'Pago en CAPRABO 7762 BARCELONA ES') === 1);
    ok(C.similarity('Caprabo', 'Pago en LIDL BCN') === 0);
  });
  const mk = (src, id, date, cents, description) => ({ source: src, id, date, cents, description });
  test('Importe parecido → posible', () => {
    const m = C.matchMovements([mk('bank', 'b1', '2026-10-04', -3455, 'MERCADONA')], [mk('toshl', 't1', '2026-10-03', -3450, 'Mercadona')]);
    eq(m.length, 1); eq(m[0].status, 'possible');
  });
  test('Mismo importe y comercio con fecha lejana → conciliado', () => {
    const m = C.matchMovements([mk('bank', 'b1', '2026-10-09', -1299, 'Pago en NETFLIX.COM')], [mk('toshl', 't1', '2026-10-02', -1299, 'Netflix')]);
    eq(m[0].status, 'auto');
  });
  test('1 apunte de Toshl ↔ 2 cargos que suman', () => {
    const m = C.matchMovements(
      [mk('bank', 'b1', '2026-10-09', -2999, 'AMAZON'), mk('bank', 'b2', '2026-10-10', -1599, 'AMAZON'), mk('bank', 'b3', '2026-10-10', -700, 'OTRO')],
      [mk('toshl', 't1', '2026-10-08', -4598, 'Amazon')]);
    eq(m.length, 1); eq(m[0].bankIds.sort(), ['b1', 'b2']); eq(m[0].status, 'possible');
  });
  test('2 apuntes de Toshl ↔ 1 cargo', () => {
    const m = C.matchMovements([mk('bank', 'b1', '2026-10-09', -5000, 'IKEA')], [mk('toshl', 't1', '2026-10-09', -3000, 'Ikea'), mk('toshl', 't2', '2026-10-09', -2000, 'Ikea')]);
    eq(m[0].toshlIds.sort(), ['t1', 't2']);
  });
  test('Cada movimiento se usa una sola vez', () => {
    const m = C.matchMovements([mk('bank', 'b1', '2026-10-09', -1000, 'X')], [mk('toshl', 't1', '2026-10-09', -1000, ''), mk('toshl', 't2', '2026-10-09', -1000, '')]);
    eq(m.length, 1);
  });
  test('Un par rechazado no se vuelve a proponer', () => {
    const m = C.matchMovements([mk('bank', 'b1', '2026-10-09', -1000, 'X')], [mk('toshl', 't1', '2026-10-09', -1000, '')], { rejected: { 't1|b1': true } });
    eq(m.length, 0);
  });
  test('Gasto e ingreso del mismo importe no se emparejan', () => {
    eq(C.matchMovements([mk('bank', 'b1', '2026-10-09', 1000, 'Bizum recibido')], [mk('toshl', 't1', '2026-10-09', -1000, '')]).length, 0);
  });

  // ─── Sugerencias y tratamiento especial ───
  test('Nómina → ingreso; Bizum recibido → reembolso; traspaso → excluir', () => {
    const r = C.DEFAULT_RULES;
    eq(C.suggestForBank({ description: 'Nomina recibida EMPRESA', cents: 385000 }, r, ['Salario']).treatment, 'income');
    eq(C.suggestForBank({ description: 'Bizum recibido de MARTA G', cents: 1500 }, r, []).treatment, 'refund');
    eq(C.suggestForBank({ description: 'Traspaso a cuenta ahorro', cents: -20000 }, r, []).treatment, 'excluded');
  });
  test('Regla aprendida: comercio → categoría', () => {
    const rules = C.learnRule([], 'Pago en FARMACIA DIAGONAL 412', 'Health', '', 'expense', true);
    eq(rules[0].pattern, 'FARMACIA');
    eq(C.suggestForBank({ description: 'Pago en FARMACIA LOPEZ', cents: -500 }, rules, ['Health']).category, 'Health');
  });
  test('Una regla corta no coincide dentro de otra palabra (BAR ≠ BARCELONA)', () => {
    ok(C.ruleMatches('BAR', 'Pago en BAR RAMON')); ok(!C.ruleMatches('BAR', 'Pago en FARMACIA DIAGONAL BARCELONA ES'));
  });
  test('Sugerencia por categoría del banco como respaldo', () => {
    eq(C.suggestForBank({ description: 'Pago en BONPREU', cents: -900, bankCategory: 'Alimentación', bankSubcategory: 'Supermercado' }, [], ['Groceries']).category, 'Groceries');
  });

  // ─── Libro y presupuesto ───
  test('Resumen: por pagar, disponible y ritmo', () => {
    const P = C.getPeriod('2026-09');
    const E = (cat, cents, t, sub) => ({ id: cat + cents, date: '2026-10-01', cents, treatment: t || 'expense', category: cat, subcategory: sub || '' });
    const entries = [E('Salario', 385000, 'income'), E('Rent', 90000), E('Groceries', 41020), E('Eating out', 18640), E('Eating out', 1500, 'refund'),
      E('House Services', 4150, null, 'agua'), E('House Services', 7500, null, 'internet')];
    const budget = { cats: { Rent: { cents: 90000 }, Groceries: { cents: 60000 }, 'Eating out': { cents: 15000 }, 'Health Insurance': { cents: 30000 },
      'House Services': { cents: 35000, subs: { electricidad: 13000, agua: 5000, internet: 7500 } } } };
    const meta = { Rent: { type: 'fixed' }, 'Health Insurance': { type: 'fixed', dueDay: 20 }, 'House Services': { type: 'fixed', dueDay: 22 } };
    const s = C.summarize(entries, budget, meta, P, '2026-10-14');
    eq(s.income, 385000); eq(s.elapsed, 20); eq(s.daysLeft, 12);
    eq(s.available, 60000 + 15000 - 41020 - 17140);
    eq(s.pending.find((p) => p.category === 'Health Insurance').due, '2026-10-20');
    ok(s.pending.some((p) => p.sub === 'electricidad' && p.cents === 13000), 'electricidad pendiente');
    eq(s.pending.filter((p) => p.category === 'House Services').length, 1, 'agua ya cobrada (aunque más barata) no está pendiente');
    eq(s.cats.find((c) => c.name === 'Eating out').color, 'r');
    const s2 = C.summarize(entries.concat([{ id: 'x', date: '2026-10-02', cents: 999, treatment: 'refund', category: '' }]), budget, meta, P, '2026-10-14');
    eq(s2.spentTotal, s.spentTotal, 'reembolso sin categoría no cuenta');
  });
  test('Histórico: medias, mejor periodo y serie por categoría', () => {
    const mk = (income, spent, cats) => ({ income, consumption: spent, savings: 0, spentTotal: spent, budgetTotal: 0, cats });
    const h = C.buildHistory([
      { id: '2026-08', label: 'ago', summary: mk(300000, 200000, [{ name: 'Groceries', type: 'variable', spent: 50000 }]) },
      { id: '2026-09', label: 'sep', summary: mk(300000, 250000, [{ name: 'Groceries', type: 'variable', spent: 60000 }, { name: 'Extra', type: 'variable', spent: 1000 }]) },
    ]);
    eq(h.avgSpent, 225000); eq(h.best.id, '2026-08'); eq(h.categories[0].series, [50000, 60000]);
    eq(h.categories[0].prevAvg, 50000); eq(h.categories[1].series, [0, 1000]);
  });
  test('Hogar: suma tus gastos previstos y los de tu pareja por categoría', () => {
    const s = { income: 300000, elapsed: 10, totalDays: 30, cats: [
      { name: 'Rent', type: 'fixed', spent: 90000, budget: 90000 }, { name: 'Groceries', type: 'variable', spent: 10000, budget: 40000 },
      { name: 'Health Insurance', type: 'fixed', spent: 0, budget: 30000 }] };
    const h = C.householdSummary(s, { income: 200000, items: [{ name: 'Súper', category: 'Groceries', cents: 20000 }, { name: 'Gimnasio', category: '', cents: 4000 }] });
    eq(h.income.total, 500000); eq(h.expenses.me, 90000 + 30000 + 30000); eq(h.expenses.partner, 24000);
    eq(h.cats.find((c) => c.name === 'Groceries').total, 50000); ok(h.cats.some((c) => c.name === 'Gimnasio'));
    eq(h.balance.total, 500000 - 174000);
  });
  test('El comentario del banco (ej. mensaje de Bizum) llega al libro', () => {
    const b = { source: 'bank', id: 'b1', date: '2026-10-12', cents: 1500, description: 'Bizum recibido de MARTA G', comment: 'cena viernes' };
    const t = { source: 'toshl', id: 't1', date: '2026-10-09', cents: -4000, description: 'Cena', category: 'Eating out' };
    const led = C.buildLedger({ movements: { b1: b, t1: t }, matches: {}, decisions: {}, rules: C.DEFAULT_RULES, knownCats: ['Eating out'] });
    eq(led.find((e) => e.id === 'b:b1').comment, 'cena viernes');
    const m = { x: { id: 'x', toshlIds: ['t1'], bankIds: ['b2'], status: 'auto' } };
    const led2 = C.buildLedger({ movements: { t1: t, b2: { source: 'bank', id: 'b2', date: '2026-10-09', cents: -4000, description: 'Pago en BAR', comment: 'con amigos' } }, matches: m, decisions: {}, rules: [] });
    eq(led2[0].comment, 'con amigos');
  });
  test('Cerrar una categoría o un pago pendiente del periodo', () => {
    const P = C.getPeriod('2026-09');
    const E = (cat, cents, sub) => ({ id: cat + cents, date: '2026-10-01', cents, treatment: 'expense', category: cat, subcategory: sub || '' });
    const entries = [E('HouseHold', 2500), E('House Services', 4000, 'agua')];
    const budget = { cats: { HouseHold: { cents: 5000 }, 'Health Insurance': { cents: 30000 }, 'House Services': { cents: 15000, subs: { agua: 5000, electricidad: 10000 } } } };
    const meta = { 'Health Insurance': { type: 'fixed' }, 'House Services': { type: 'fixed' } };
    const open = C.summarize(entries, budget, meta, P, '2026-10-25');
    eq(open.available, 2500); eq(open.pendingTotal, 40000);
    const closed = C.summarize(entries, Object.assign({}, budget, { closed: { HouseHold: true, 'Health Insurance': true, 'House Services|electricidad': true } }), meta, P, '2026-10-25');
    eq(closed.available, 0, 'HouseHold cerrada: no queda nada');
    eq(closed.cats.find((c) => c.name === 'HouseHold').budget, 2500);
    eq(closed.pendingTotal, 0, 'nada por pagar');
    eq(closed.budgetTotal, 2500 + 0 + 5000, 'presupuesto efectivo = lo gastado en lo cerrado');
  });
  test('Subcategoría del presupuesto con otro nombre que la etiqueta (electricity ↔ electricidad)', () => {
    eq(C.matchSubNames(['electricity', 'internet'], ['electricidad', 'internet']), { electricity: 'electricidad' });
    eq(C.matchSubNames(['agua'], ['Agua']), { agua: 'Agua' });
    eq(C.matchSubNames(['gas'], ['gasolina']), {});
    const P = C.getPeriod('2026-09');
    const s = C.summarize([{ id: 'x', date: '2026-10-15', cents: 13489, treatment: 'expense', category: 'House Services', subcategory: 'electricidad' }],
      { cats: { 'House Services': { cents: 13000, subs: { electricity: 13000 } } } }, { 'House Services': { type: 'fixed' } }, P, '2026-10-25');
    eq(s.pendingTotal, 0, 'la luz está pagada');
  });
  test('Mensaje de Bizum dentro de la descripción', () => {
    eq(C.bizumMessage('Bizum enviado a ANA PEREZ LOPEZ Cena del viernes'), 'Cena del viernes');
    eq(C.bizumMessage('Bizum enviado a ANA PEREZ Sin concepto'), '');
    eq(C.bizumMessage('Pago en LIDL'), '');
  });
  test('Día de pago deducido del historial', () => {
    const d = C.inferDueDays([{ category: 'Rent', treatment: 'expense', date: '2026-10-01' }, { category: 'House Services', subcategory: 'agua', treatment: 'expense', date: '2026-10-05' }], ['Rent', 'House Services']);
    eq(d.Rent, 1); eq(d['House Services|agua'], 5);
  });
  test('CSV para Toshl: misma cabecera y se vuelve a leer igual', () => {
    const csv = C.toToshlCSV([{ date: '2026-09-25', cents: 123456, treatment: 'expense', category: 'Groceries', subcategory: 'super', description: 'Caprabo, "centro"' },
      { date: '2026-09-30', cents: 1500, treatment: 'refund', category: 'Eating out', description: 'Bizum' }]);
    const back = C.parseToshl(csv).movements;
    eq(back.length, 2); eq(back[0].cents, -123456); eq(back[0].description, 'Caprabo, "centro"'); eq(back[1].cents, 1500);
    ok(csv.startsWith('"Fecha","Cuenta","Categoría"'));
  });
  test('Presupuesto de la v2 → céntimos', () => {
    const r = C.fromV2Profiles({ activeProfileId: 'd', profiles: { d: { name: 'Mensual', budgets: { Rent: { total: 900, tags: {}, type: 'fixed' }, 'House Services': { total: 350, tags: { agua: 50 }, type: 'fixed' } } } } });
    eq(r.cats.Rent.cents, 90000); eq(r.cats['House Services'].subs.agua, 5000); eq(r.meta.Rent.type, 'fixed');
  });

  // ─── Salida ───
  const passed = results.filter((r) => r.ok).length;
  if (typeof document !== 'undefined') {
    const el = document.getElementById('out');
    el.innerHTML = '<h1>' + (passed === results.length ? '✅' : '❌') + ' ' + passed + ' / ' + results.length + ' tests</h1>' +
      results.map((r) => '<div class="' + (r.ok ? 'ok' : 'ko') + '">' + (r.ok ? '✓ ' : '✗ ') + r.name + (r.msg ? '<br><small>' + r.msg + '</small>' : '') + '</div>').join('');
    document.title = passed + '/' + results.length + ' tests';
  } else {
    results.forEach((r) => console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.msg ? '\n    ' + r.msg : '')));
    console.log('\n' + passed + ' / ' + results.length + ' tests');
    if (passed !== results.length) process.exitCode = 1;
  }
})();
