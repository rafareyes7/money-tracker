# Conciliar · Presupuesto (PWA offline)

App personal para iPhone que concilia los movimientos del banco (`movements-DDMMAAAA.xls`) con el export de Toshl (`.csv`) y compara el gasto real con un presupuesto mensual. Funciona **100 % sin conexión**, sin servidor. Los datos se guardan **solo en el dispositivo**.

## 1. Publicar e instalar (una sola vez)

1. Crea un repositorio en GitHub (puede ser privado si tienes GitHub Pro; si es público, solo se ve el **código**, nunca tus datos).
2. Sube **todo el contenido** de esta carpeta a la raíz del repositorio.
3. En GitHub: *Settings → Pages → Source: Deploy from a branch → `main` / root* → Guardar.
4. En 1–2 minutos tendrás una URL del tipo `https://TU-USUARIO.github.io/NOMBRE-REPO/`.
5. Ábrela en **Safari** del iPhone → *Compartir → Añadir a pantalla de inicio*.
6. Abre la app desde el icono una vez con conexión. A partir de ahí funciona en modo avión.

**Actualizar:** sube los archivos nuevos y cambia `CACHE` en `service-worker.js` (por ejemplo, `conciliador-v1.0.1`). La app descarga la nueva versión la próxima vez que se abra con conexión.

**Tests:** abre `tests.html` (o ejecuta `node js/tests.js`).

## 2. Arquitectura

```
index.html            Estructura: cabecera, vista, barra de 5 pestañas
css/app.css           Estilos mobile-first, modo oscuro automático, safe-area
js/core.js            Funciones PURAS (sin DOM): parseo, periodo, emparejamiento, libro, presupuesto, exportación
js/db.js              IndexedDB (stores: kv, movements, matches)
js/app.js             Interfaz: render por pestaña, hojas inferiores, eventos delegados, deshacer
js/tests.js           Tests de core.js (navegador y Node)
service-worker.js     Cache-first de todos los archivos
manifest.json, icons/ Instalación como app
vendor/xlsx.full.min.js  SheetJS 0.18.5 (local, sin CDN) para leer el .xls BIFF8
```

Flujo: **Importar** (parsear → IDs estables → fusionar sin duplicar) → **emparejar** solo lo que no tiene pareja → **libro conciliado** = `buildLedger(movimientos, emparejamientos, decisiones, reglas)`. El libro no se guarda como copia: se recalcula siempre desde las fuentes y tus decisiones, así nunca queda desincronizado.

Vanilla JS (ES2020), sin paso de build.

## 3. Modelo de datos

Dinero siempre en **céntimos enteros**. Fechas en ISO `AAAA-MM-DD`.

| Store / clave | Contenido |
|---|---|
| `movements` | `{ id, source: 'bank'|'toshl', date, cents (con signo: − gasto, + ingreso), description, category, subcategory, account, bankCategory, bankSubcategory }` |
| `matches` | `{ id, toshlIds[], bankIds[], status: 'auto'|'possible'|'confirmed'|'manual', reason }` |
| `kv.decisions` | `{ [entryId]: { category, subcategory, treatment } }`: tus correcciones |
| `kv.rejected` | `{ 'toshlId|bankId': true }`: pares rechazados (no se vuelven a proponer) |
| `kv.rules` | `[{ id, pattern, category, subcategory, treatment, manual, learned }]` |
| `kv.categories` | `{ [nombre]: { icon, type: 'fixed'|'variable'|'income', dueDay, savings, estimate } }` |
| `kv.budgets` | `{ [periodId 'AAAA-MM']: { cats: { [cat]: { cents, subs: { [etiqueta]: cents } } } } }` |
| `kv.settings` | `{ startDay, skipWeekends, skipHolidays, holidays[], overrides{}, lastBackupAt, dataChangedAt, balance: { cents, date, source } | null }` |
| `kv.partner` | `{ name, periods: { [periodId]: { income, items: [{ name, category, cents }] } } }`: visión compartida (opcional) |

Entrada del libro (derivada): `{ id, date, cents, sign, treatment: 'expense'|'income'|'refund'|'excluded', category, subcategory, description, bankDescription, status: 'matched'|'possible'|'bank_only'|'toshl_only', resolved }`.

No se guarda número de cuenta ni titular: las filas anteriores a la cabecera del banco se descartan al leer.

## 4. Reglas clave

- **Periodo:** empieza el día 25 (configurable); si es sábado, domingo o festivo, el siguiente día hábil. Termina el día anterior al siguiente inicio. Se detecta por la mayoría de fechas importadas y se puede cambiar o ajustar a mano.
- **Emparejamiento** (cada movimiento se usa una vez):
  1. Importe exacto y ±3 días → ✅ conciliado.
  2. Importe exacto y mismo comercio (±10 días) → ✅ conciliado.
  3. Importe parecido (±0,10 € o ±2 %) y ±3 días → ⚠️ posible.
  4. 1 ↔ 2–3 movimientos que suman exacto → ⚠️ posible.
- **Si un "posible" no es correcto:** *Cambiar…* para elegir otro (uno o varios, con indicador de si la suma cuadra), o *Rechazar*. También se puede deshacer cualquier conciliado.
- **Por pagar:** categorías fijas cuyo presupuesto aún no se ha cobrado. El día de pago se deduce del último cargo (por categoría y por subcategoría) o se configura a mano. Un recibo variable ya cobrado cuenta como pagado.

## 5. Novedades v1.2

- **Saldo del banco (opcional):** se lee solo de la columna SALDO al importar, o se escribe a mano. Inicio muestra con cuánto acabarás el periodo si cumples el presupuesto y al ritmo actual.
- **Histórico:** *Presupuesto → Histórico*. Medias, gráfico de ingresos y gastos por periodo, lista de periodos (toca uno para abrirlo) y evolución por categoría.
- **Visión compartida:** *Inicio → Hogar*. Sueldo y gastos de tu pareja escritos a mano, sumados con tus gastos previstos del periodo. La vista "Yo" no cambia.

**v1.3 · Cerrar lo que no se pagará:** en *Por pagar* (Inicio y Presupuesto) cada pago tiene "No se pagará este periodo", y cada categoría variable tiene "Cerrar este periodo". Lo que faltaba deja de contar: el presupuesto efectivo pasa a ser lo gastado. Se guarda en `budgets[periodo].closed`, solo afecta a ese periodo y se puede reabrir.

## 6. Riesgos y cómo están resueltos

| Riesgo | Solución |
|---|---|
| Perder datos | Copia JSON en 1 toque (en iPhone abre "Guardar en Archivos"); aviso en Inicio si no hay copia o tiene más de 7 días con cambios; `navigator.storage.persist()`; consejo de instalar en pantalla de inicio. |
| Emparejamiento erróneo | Solo se concilia automáticamente con importe exacto. Lo dudoso va a "Posibles". Hay *Deshacer* tras cada acción, y los pares rechazados no vuelven. |
| Configurar "por pagar" | Fijo/variable se importa de la v2 y el día de pago se deduce del historial. Solo confirmas. |
| Recibos variables | Marcados como "estimado" (~). Cuentan como pagados cuando llega el cargo. |
| Cifras provisionales | Aviso en Inicio y número en la pestaña Conciliar mientras haya pendientes. |
| Formato CSV de Toshl | Mismo encabezado e importes `1.234,56`. Probado leyendo de nuevo el CSV exportado. **Falta probar a importarlo en Toshl.** |
| Muchos movimientos | Filtros, buscador y listas paginadas (150 en Movimientos, 80 en Conciliar). |

## 7. Supuestos tomados

- La primera hoja del `.xls` contiene los movimientos; la cabecera se busca en las primeras 25 filas (no se fija en la fila 4).
- En el libro, un conciliado usa **la fecha de Toshl** (la real de la compra) y **el importe del banco** (lo cobrado de verdad).
- Las entradas sin revisar **cuentan** en los totales con la categoría sugerida (por eso el aviso de cifras provisionales). Un reembolso sin categoría no cuenta hasta que eliges de qué restarlo.
- "Gastos" excluye las categorías marcadas como ahorro/inversión; el saldo = ingresos − gastos − ahorro.
- "Te quedan" = presupuesto variable − gastado variable. "Ahorro previsto" = ingresos − gastado − por pagar − disponible.
- El CSV para Toshl exporta reembolsos como ingreso en su categoría, y "En la divisa principal" en negativo para gastos.
- Sin presupuesto en un periodo, se usa el último anterior como provisional (1 toque para guardarlo en el periodo).
- Festivos precargados: 25 y 26/12/2026 y 25/12/2027. Se pueden editar.
- No se incluyen los perfiles ni las comparativas de escenarios de la v2. Se puede importar su presupuesto (JSON de "Export All").
- SheetJS 0.18.5 es la última versión publicada en npm. Tiene avisos de seguridad (CVE-2023-30533, CVE-2024-22363) que solo afectan a archivos manipulados. Aquí solo se leen tus propios exports del banco. Si quieres, sustitúyelo por 0.20.3 desde cdn.sheetjs.com (mismo nombre de archivo).

## 8. Posibles mejoras

- Varios presupuestos/escenarios (perfiles de la v2).
- Cifrado de la copia de seguridad con contraseña.
- Importar varios archivos a la vez y detectar el banco por formato.
- Reglas con importe o con día del mes (ej. "SANITAS el día 20 → Health Insurance").
- Recordatorio de cobro de fijos (necesitaría notificaciones push y, por tanto, un servidor).
- En la vista Hogar, tus gastos son el **previsto** del periodo (fijos pagados o presupuestados + variables al ritmo actual), para poder sumarlos con los importes mensuales de tu pareja.
- La proyección con saldo resta del saldo lo que queda por pagar y el resto del presupuesto variable (o lo que falta al ritmo actual).
