# CLAUDE.md — Contexto del proyecto Jornal

Este archivo es el brief completo para continuar el desarrollo. Léelo antes de tocar código.

---

## 1. Qué es

**Jornal** es una web app personal (PWA) para llevar contabilidad de una sola persona: un
estudiante universitario en Colombia que labora **algunos días** (no tiene salario fijo) y de
cada jornada aparta un porcentaje para una cuota fija que paga mensualmente. El resto es lo
que puede gastar.

El problema real que resuelve no es "registrar gastos". Es que **la plata que entra ya viene
comprometida en parte**, y sin una herramienta que la separe en el momento de recibirla, se
gasta. Por eso el apartado no es un cálculo de reporte: es un movimiento contable que ocurre
al registrar la jornada.

**Idioma de toda la interfaz: español (Colombia). Moneda: COP, sin decimales, formato `es-CO`.**

---

## 2. Restricciones duras — no las negocies

| Restricción | Motivo |
|---|---|
| Sin backend, sin cuentas, sin red | Decisión explícita del usuario: los datos viven solo en su teléfono |
| Sin dependencias ni build step | Debe funcionar abriendo `index.html`; no hay npm, ni bundler, ni CDN |
| Todo en un solo archivo (`index.html`) | Facilita el despliegue y la lectura completa del código |
| Debe funcionar offline | Service worker cachea todo; la app abre en modo avión |
| Target: **Safari en iOS**, instalada en pantalla de inicio | Es el dispositivo principal de uso |
| Fuentes del sistema, nunca webfonts | Sin internet no cargarían |

Si una funcionalidad nueva exige romper alguna de estas, **propónlo antes de implementarlo**,
explicando el costo.

---

## 3. Estado actual — qué ya está construido y funcionando

```
index.html            app completa (HTML + CSS + JS vanilla, ~330 líneas de JS)
manifest.webmanifest  metadatos PWA
sw.js                 service worker, estrategia network-first con fallback a caché
icon-192.png icon-512.png icon-maskable.png apple-touch-icon.png
README.md             instrucciones de despliegue e instalación
```

Funciona hoy:

- **Inicio**: saldo disponible, barra partida apartado/libre, progreso hacia la cuota
  del crédito,
  días para el pago, estimación de jornadas faltantes, resumen del mes, gastos por categoría.
- **Registrar jornada**: monto variable + porcentaje (precargado del ajuste, editable por
  jornada) + fecha + nota. Muestra en vivo cuánto se aparta y cuánto queda.
- **Registrar gasto**: monto + categoría (pills) + fecha + nota.
- **Registrar pago de la cuota**: descuenta del acumulado y reinicia el ciclo.
- **Movimientos**: navegación por mes, totales de entrada/salida, tocar una fila la abre
  para editarla (escribe sobre el mismo `id`), eliminar con confirmación, e historial de
  cuotas pagadas con lo apartado y las jornadas de cada ciclo.
- **Ajustes**: porcentaje, valor de la cuota, día de pago, CRUD de categorías.
- **Respaldo**: exportar/importar JSON, estado de la última copia, recordatorio en Inicio
  a los 15 días sin respaldar, borrar todo con doble confirmación.

---

## 4. Modelo de datos

Un único objeto en `localStorage` bajo la clave `jornal.v1`:

```js
{
  pct: 30,          // porcentaje por defecto a apartar de cada jornada
  cuota: 0,         // valor de la cuota del ciclo
  diaPago: 5,       // día del mes en que paga (se limita a 1..28)
  cats: ['Transporte', 'Comida', ...],
  ultimoRespaldo: null,  // 'YYYY-MM-DD' de la última copia descargada o restaurada
  avisoOculto: null,     // 'YYYY-MM-DD' en que se descartó el recordatorio de respaldo
  movs: [
    {
      id: 'string único',
      tipo: 'jornada' | 'gasto' | 'pago',
      fecha: 'YYYY-MM-DD',
      monto: Number,   // siempre positivo
      aparta: Number,  // solo en 'jornada'; 0 en el resto
      cat: 'string',   // solo en 'gasto'
      cuotaObjetivo: Number, // solo en 'pago', opcional: cuánto era la cuota ese día
      nota: 'string'   // opcional
    }
  ]
}
```

**Invariante central** (función `totales()`):

```
libre    = Σ(jornada.monto − jornada.aparta) − Σ(gasto.monto)
apartado = Σ(jornada.aparta) − Σ(pago.monto)
```

El porcentaje de una jornada **no se guarda**: se deduce con `pctDe()` como
`aparta / monto`. Por eso editar una jornada conserva el porcentaje que tenía esa jornada y
no el de Ajustes. No agregues un campo `pct` al movimiento: obligaría a migrar la clave para
guardar información que ya está en los datos.

Si cambias la forma de los datos, **incrementa la clave** (`jornal.v2`) y escribe una
migración que lea `jornal.v1` y lo convierta. Nunca dejes que un usuario con datos viejos
abra la app y vea todo en cero. Agregar un campo *opcional* en la raíz (como
`ultimoRespaldo`) no cuenta: `load()` hace `Object.assign({}, DEFAULTS, guardado)`, así que
un archivo viejo lo recibe con su valor por defecto. Cambiar la forma de `movs` sí cuenta.

`load()` y `save()` están envueltos en `try/catch` con fallback a una variable en memoria,
porque algunos entornos de previsualización bloquean `localStorage`. Mantén ese patrón.

---

## 5. Arquitectura del código

JS vanilla, sin framework. Patrón: estado global `S` + una función `render()` que redibuja
todo desde el estado y llama `save()` al final. Toda mutación termina llamando `render()`.

Funciones principales:

- `load()` / `save()` — persistencia tolerante a fallos
- `totales()` — el invariante de arriba
- `proximoPago()` — fecha y días restantes hasta el día de pago
- `delMes(ym)` — filtra movimientos por `YYYY-MM`
- `diasEntre(isoA, isoB)` — días entre dos fechas `YYYY-MM-DD`
- `avisoRespaldo()` / `ocultarAviso()` — recordatorio de copia de seguridad
- `ciclos()` — deriva los ciclos cerrados (uno por pago) desde `movs`
- `render()` — pinta inicio y dispara `renderMovs()`, `renderCiclos()` y `renderCats()`
- `openSheet(tipo, id?)` / `closeSheet()` — hojas inferiores (jornada / gasto / pago). Con
  `id` la hoja entra en modo edición: precarga los datos y guarda sobre ese `id`
- `editMov(id)` — abre la hoja de edición desde una fila de Movimientos
- `pctDe(mov)` — deduce el porcentaje de una jornada a partir de `aparta/monto`
- `guardarMov(datos)` — crea o sobrescribe según `editando`; devuelve `true` si es nuevo
- `addJornada()` `addGasto()` `addPago()` `delMov()` — mutaciones
- `saveSettings()` `addCat()` `rmCat()` — ajustes
- `exportData()` `importData()` `wipe()` — respaldo
- `go(vista)` — navegación entre las tres vistas
- `fmt()` `uid()` `hoy()` `fechaCorta()` `esc()` `toast()` — utilidades

Todo texto que venga del usuario pasa por `esc()` antes de entrar al DOM vía `innerHTML`.
Mantenlo: es la única defensa contra inyección en esta app.

---

## 6. Sistema de diseño — respétalo

Dirección visual: **recibo de caja**. Papel marfil, tinta verde muy oscura, cifras en
monoespaciada tabular como impresión térmica. El elemento firma es la tarjeta principal con
**borde inferior dentado** (dientes hechos con `linear-gradient`, en `.receipt::after`) y la
**barra partida** que muestra visualmente cómo cada ingreso se rompe en dos.

```css
--ink:#12241C      /* texto y botones primarios */
--paper:#EDEBE1    /* fondo de la app */
--card:#FBFAF6     /* tarjetas */
--accent:#17694F   /* verde: lo apartado, ingresos */
--spend:#9A2B2B    /* rojo: gastos */
--gold:#A9791F     /* ámbar: metas, pagos */
--muted:#66746B    /* texto secundario */
--line:#DAD6C9     /* bordes y divisores */
```

Tipografía: `Avenir Next` (nativa de iOS) para interfaz, `ui-monospace` con
`font-variant-numeric: tabular-nums` para toda cifra. Nunca uses la mono para prosa ni la
display para números en columnas.

Reglas de UI que ya están aplicadas y deben mantenerse:

- `env(safe-area-inset-*)` en el contenedor y en la barra inferior (notch y home indicator).
- `inputmode="decimal"` en todo campo de dinero — abre el teclado numérico en iPhone.
- `font-size: 16px` mínimo en inputs; con menos, Safari hace zoom automático al enfocar.
- `@media (prefers-reduced-motion: reduce)` desactiva animaciones.
- Foco de teclado visible (`outline` en `:focus`).

Copy: voz directa, en segunda persona, sentence case. Los botones dicen lo que hacen
("Guardar jornada", no "Enviar"). Los estados vacíos invitan a actuar, no se disculpan.

---

## 7. Backlog priorizado

Trabaja en orden. Cada punto trae su criterio de aceptación.

### P1 — Lo que le falta para ser confiable

1. ~~**Editar un movimiento.**~~ **Hecho.** Tocar una fila abre la hoja con los datos
   precargados y guarda sobre el mismo `id`. El porcentaje de la jornada se deduce con
   `pctDe()`, así que cambiar el monto recalcula `aparta` con el porcentaje que tenía esa
   jornada, no con el de Ajustes. Verificado: los totales cuadran y no se duplican
   movimientos.

2. ~~**Recordatorio de respaldo.**~~ **Hecho.** `avisoRespaldo()` muestra una nota discreta
   en Inicio pasados 15 días (`DIAS_RESPALDO`). Si nunca respaldó, cuenta desde el
   movimiento más viejo; con la app vacía no aparece. "Ahora no" lo pospone 7 días
   (`DIAS_SNOOZE`), no lo apaga para siempre: el riesgo no desaparece porque lo descarten.
   Exportar o importar ponen `ultimoRespaldo = hoy()` y limpian `avisoOculto`. Ajustes →
   Respaldo muestra cuándo fue la última copia.

3. ~~**Historial de ciclos.**~~ **Hecho, con una desviación deliberada del plan.** El brief
   pedía guardar un snapshot del ciclo al pagar; `ciclos()` lo **deriva** de los movimientos
   igual que `totales()`. Razón: como P1-1 permite editar y borrar movimientos, un snapshot
   guardado quedaría mintiendo apenas se corrija una jornada vieja. Derivado siempre cuadra.
   Lo único que sí se guarda es `cuotaObjetivo` en el movimiento de pago, porque el valor de
   la cuota en Ajustes puede cambiar y ese dato no se reconstruye. Es un campo opcional: los
   pagos viejos caen a `monto` y no hace falta migrar.
   Cada ciclo lleva `arrastre` (lo que sobró del anterior) para que la suma cuadre con
   `totales().apartado`.

### P2 — Lo que lo hace más útil

4. **Gasto recurrente rápido.** Los gastos se repiten (pasajes, almuerzo). Botón de
   "repetir último gasto de esta categoría" o accesos de un toque a los tres gastos más
   frecuentes del mes.

5. **Alerta de ritmo.** Si faltan N días para el pago y el acumulado va por debajo del
   ritmo necesario, muéstralo en Inicio con el mensaje concreto: cuánto tendría que apartar
   por jornada restante. Sin alarmismo, sin colores rojos parpadeantes.

6. **Exportar a CSV** además del JSON, para abrirlo en Excel o Sheets.

7. **Gráfica simple de los últimos 6 meses** (recibido vs gastado). SVG dibujado a mano,
   sin librería. Barras, no líneas: son pocos datos y discretos.

### P3 — Solo si lo pide

8. Modo oscuro con `prefers-color-scheme`.
9. Bloqueo con código de 4 dígitos al abrir (no es seguridad real, es privacidad de pantalla).
10. Migración opcional a Supabase para sincronizar iPhone + Android + PC. Solo hay que
    reescribir `load()` y `save()`; el resto de la app no se entera. **No lo hagas sin que
    el usuario lo pida explícitamente** — decidió local a propósito.

---

## 8. Cómo probar

```bash
python3 -m http.server 8000    # el service worker no funciona con file://
```

Luego `http://localhost:8000`. Para probar en el iPhone real, despliega en GitHub Pages
o Netlify Drop (necesita HTTPS) y abre **en Safari**; Chrome en iOS no instala PWAs.

Validaciones mínimas antes de dar algo por terminado:

- `node --check` sobre el JS extraído (o revísalo en consola del navegador sin errores).
- Los totales cuadran: registra 2 jornadas, 1 gasto y 1 pago, y verifica a mano el invariante
  de la sección 4.
- Prueba en ancho de 375px (iPhone SE) y 430px (Pro Max).
- Prueba en modo avión que la app abre y guarda.
- Exporta, borra todo, importa: los datos deben volver idénticos.

---

## 9. Qué NO hacer

- No agregues React, Tailwind, ni ninguna dependencia. Es intencional que no haya build.
- No metas analítica, telemetría ni llamadas de red de ningún tipo.
- No cambies la clave de `localStorage` sin migración.
- No reemplaces el diseño por un dashboard genérico con tarjetas de gradiente. La identidad
  de recibo es deliberada.
- No sustituyas `confirm()` por diálogos propios solo por estética: `confirm()` es nativo,
  accesible y funciona offline. Cámbialo únicamente si el reemplazo es mejor de verdad.
- No asumas ingresos fijos en ninguna proyección: **el monto por jornada varía**. Toda
  estimación debe usar promedios de las jornadas reales, nunca un valor supuesto.
