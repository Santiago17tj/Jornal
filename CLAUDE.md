# CLAUDE.md — Contexto del proyecto Jornal

Este archivo es el brief completo para continuar el desarrollo. Léelo antes de tocar código.

---

## 1. Qué es

**Jornal** es una web app personal (PWA) para una sola persona: una estudiante universitaria
en Colombia que **paga varias obligaciones por abonos** (universidad, celular, internet, una
moto, un préstamo) y que **labora algunos días**, sin salario fijo.

El problema real que resuelve no es "registrar gastos". Es que ella lleva estas cuentas en un
cuaderno: cada deuda tiene un total, va abonando de a poco y tiene que restar a mano para
saber cuánto le falta y si le alcanza. La app hace esa resta sola y conecta las dos mitades
que el cuaderno no conecta: **de dónde sale la plata** (los ingresos irregulares) y **a dónde
tiene que ir** (las deudas).

**Idioma de toda la interfaz: español (Colombia). Moneda: COP, sin decimales, formato `es-CO`.**

---

## 2. Restricciones duras — no las negocies

| Restricción | Motivo |
|---|---|
| Sin backend, sin cuentas, sin red | Decisión explícita: los datos viven solo en su teléfono |
| Sin dependencias ni build step | Debe funcionar abriendo `index.html`; no hay npm, ni bundler, ni CDN |
| Todo en un solo archivo (`index.html`) | Facilita el despliegue y la lectura completa del código |
| Debe funcionar offline | Service worker cachea todo; la app abre en modo avión |
| Target: **Safari en iOS**, instalada en pantalla de inicio | Es el dispositivo principal de uso |
| Fuentes del sistema, nunca webfonts | Sin internet no cargarían |

Si una funcionalidad nueva exige romper alguna de estas, **propónlo antes de implementarlo**,
explicando el costo. Ya pasó una vez: la clienta pidió respaldo en la nube y notificaciones
push, y se decidió mantener todo local (ver sección 9).

---

## 3. Estado actual — qué ya está construido y funcionando

```
index.html            app completa (HTML + CSS + JS vanilla)
manifest.webmanifest  metadatos PWA
sw.js                 service worker, estrategia network-first con fallback a caché
vercel.json           headers: no cachear sw.js ni index.html en el CDN
icon-192.png icon-512.png icon-maskable.png apple-touch-icon.png
README.md             instrucciones de despliegue e instalación
```

Funciona hoy:

- **Inicio**: disponible para gastar, barra partida con los dos bolsillos (para gastar /
  guardado), total de la deuda pendiente,
  una **tarjeta por deuda** (saldo, barra de progreso, % pagado, próximo vencimiento, botones
  de abonar y ver abonos), aviso de vencimiento cercano o de respaldo, resumen del mes y
  gastos por categoría.
- **Registrar ingreso**: monto recibido + **reparto en pesos** a cada deuda, con lo que queda
  libre calculado en vivo. Guardar crea el ingreso y una **reserva** por deuda: esa plata se
  aparta, no se paga todavía.
- **Registrar gasto**: monto + categoría (pills) + fecha + nota.
- **Registrar abono** a una deuda, con tope en el saldo. Sugiere lo apartado para ella y
  avisa antes de guardar si el monto excede lo guardado y va a tocar el disponible.
- **Movimientos**: navegación por mes, totales de entrada/salida, tocar una fila la abre para
  editarla (escribe sobre el mismo `id`), eliminar con confirmación.
- **Ajustes**: CRUD de deudas (nombre, ícono, total, día de pago), CRUD de categorías.
- **Respaldo**: exportar/importar JSON, estado de la última copia, recordatorio a los 15 días
  sin respaldar, borrar todo con doble confirmación.

---

## 4. Modelo de datos

Un único objeto en `localStorage` bajo la clave `jornal.v3`:

```js
{
  cats: ['Transporte', 'Comida', ...],
  deudas: [
    { id, nombre, icono, total: Number, diaPago: Number }   // diaPago se limita a 1..28
  ],
  movs: [
    {
      id: 'string único',
      tipo: 'jornada' | 'reserva' | 'gasto' | 'abono',
      fecha: 'YYYY-MM-DD',
      monto: Number,     // siempre positivo
      cat: 'string',     // solo en 'gasto'
      deudaId: 'string', // en 'abono' y en 'reserva'
      origen: 'string',  // solo en 'reserva': id del ingreso del que se apartó
      nota: 'string'     // opcional
    }
  ],
  ultimoRespaldo: null,  // 'YYYY-MM-DD' de la última copia descargada o restaurada
  avisoOculto: null      // 'YYYY-MM-DD' en que se descartó el recordatorio de respaldo
}
```

### Dos bolsillos separados

Ella separa la plata de las deudas de la plata de vivir. La app modela eso literalmente:

```
libre     — lo que puede gastar
guardado  — lo que ya apartó para las deudas y no debe gastarse
```

`totales()` los calcula recorriendo los movimientos **en orden cronológico**:

| tipo | efecto |
|---|---|
| `jornada` | `libre += monto` |
| `reserva` | `libre −= monto`, `guardado += monto` |
| `gasto` | `libre −= monto` |
| `abono` | sale de `guardado`; solo lo que ese bolsillo no cubra se carga a `libre` |

```
libre + guardado = Σ jornada − Σ gasto − Σ abono     (invariante, verificado en pruebas)
saldo(deuda)     = deuda.total − Σ abono de esa deuda
```

**Un abono no pone el disponible en negativo** mientras haya plata guardada. Esa era la queja
concreta de la clienta y es la razón de ser de este modelo: antes repartir y abonar eran el
mismo paso y todo abono salía del disponible.

Dentro de un mismo día el orden lo fija el **tipo** (`ORDEN_TIPO`), no el `id`: la plata entra,
se aparta y solo después se abona. Sin eso, un abono cuyo `id` sea anterior al de su reserva
encontraría el bolsillo vacío y se cobraría al disponible. Ya pasó al migrar de v2.

`guardado` es **un solo bolsillo** a efectos de cuentas. `guardadoDe(deudaId)` es la etiqueta
que ella le puso a la plata al repartir el ingreso (`Σ reserva[d] − Σ abono[d]`, con piso en
cero): sirve para sugerir cuánto abonar y para mostrarlo en la tarjeta, no para el cálculo.

Un ingreso repartido genera **reservas hijas** con `origen` apuntando a su `id`. Al editar el
ingreso las hijas se **borran y se rehacen** (más simple que reconciliarlas y no se puede
desincronizar). Al borrarlo, se van con él. Los abonos **no** son hijos de nadie: son un acto
aparte, del día que ella paga.

### Migraciones

`load()` encadena solo. Antes de tocar nada guarda una copia intacta del original en
`jornal.vN.backup`, que **nunca** se borra.

- **`migrarV1()`** — v1 tenía una sola cuota mensual y un porcentaje por jornada. La cuota se
  vuelve una deuda llamada "Crédito"; lo apartado de cada jornada emite su `reserva` y su
  `abono` el mismo día, así la deuda queda igual. Los movimientos `pago` de v1 se descartan:
  allí apartar y pagar eran dos pasos sobre la misma plata y contarlos sería duplicar.
  Devuelve ya la forma v3, **no** la encadenes con `migrarV2()` o duplicarás las reservas.
- **`migrarV2()`** — v2 no tenía reservas: repartir creaba el abono directamente. Se le añade
  una `reserva` gemela a cada abono que traiga `origen`. Los abonos sueltos no llevan gemela,
  porque en v2 salían del disponible y en v3 siguen saliendo de ahí con el bolsillo vacío.

**Las dos conservan `libre` exacto y no mueven ningún saldo.** Está verificado con datos
reales de cada versión; si tocas una migración, vuelve a comprobarlo.

Si cambias la forma de los datos, **incrementa la clave** y escribe la migración. Nunca dejes
que alguien con datos viejos abra la app y vea todo en cero. Agregar un campo *opcional* que
degrada bien no cuenta: `load()` hace `Object.assign({}, DEFAULTS, guardado)`.

`load()` y `save()` están envueltos en `try/catch` con fallback a una variable en memoria,
porque algunos entornos de previsualización bloquean `localStorage`. Mantén ese patrón.

---

## 5. Arquitectura del código

JS vanilla, sin framework. Patrón: estado global `S` + una función `render()` que redibuja
todo desde el estado y llama `save()` al final. Toda mutación termina llamando `render()`.

Funciones principales:

- `load()` / `save()` / `migrarV1()` / `migrarV2()` — persistencia y migraciones encadenadas
- `totales()` — `{recibido, reservado, abonado, gastado, libre, guardado}`, los dos bolsillos
- `deuda(id)` `abonadoDe(id)` `guardadoDe(id)` `estadoDeuda(d)` `totalDeudas()` — la deuda,
  lo apartado para ella y su progreso
- `proximoPago(diaPago)` — fecha y días hasta el próximo vencimiento
- `delMes(ym)` / `diasEntre(a,b)` — filtros y fechas
- `avisoVence()` / `avisoRespaldo()` / `ocultarAviso()` — los dos avisos de Inicio, por prioridad
- `render()` — pinta inicio y dispara `renderDeudas()`, `renderMovs()`, `renderDeudaEdit()`,
  `renderCats()`
- `openSheet(tipo, id?, deudaId?)` / `closeSheet()` / `foco(sel)` — hojas inferiores. Tipos:
  `jornada`, `gasto`, `abono`, `deuda`, `historial`. Con `id` la hoja edita en vez de crear
- `repartosDe(jornadaId)` — abonos hijos de un ingreso
- `guardarMov(datos)` — crea o sobrescribe según `editando`; devuelve `true` si es nuevo
- `addJornada()` `addGasto()` `addAbono()` `addDeuda()` `delMov()` `rmDeuda()` — mutaciones
- `exportData()` `importData()` `wipe()` — respaldo
- `go(vista)` — navegación entre las tres vistas
- `fmt()` `uid()` `hoy()` `fechaCorta()` `esc()` `toast()` — utilidades

Todo texto que venga del usuario pasa por `esc()` antes de entrar al DOM vía `innerHTML`.
Mantenlo: es la única defensa contra inyección en esta app.

`foco()` comprueba que el campo siga en el DOM antes de enfocarlo: si la hoja se cierra antes
de los 260 ms de la animación, el cuerpo ya fue reemplazado. No vuelvas al `setTimeout` pelado.

**Actualización automática.** Al final del script, el registro del service worker escucha
`updatefound` y recarga la página cuando el worker nuevo llega a `activated`. Sin esto, la app
instalada en el iPhone se queda mostrando la versión vieja hasta que alguien borre la caché a
mano. La comprobación de "¿es actualización o instalación inicial?" mira
`navigator.serviceWorker.controller` **dentro** de `updatefound`, no al cargar el script: leerlo
al arrancar da un valor congelado que bloquea las actualizaciones de esa misma sesión. Ya se
cometió ese error una vez.

**Sube `CACHE` en `sw.js` en cada publicación.** El `activate` borra las cachés que no
coincidan; si no lo subes, la caché vieja sobrevive.

---

## 6. Sistema de diseño — respétalo

**Paleta: la del boceto de la clienta.** Morado sobre blanco, texto azul muy oscuro. Se
cambió desde la paleta original de recibo (marfil y verde) a petición suya.

```css
--ink:#211C50      /* texto y botones primarios */
--paper:#F3F2FB    /* fondo de la app */
--card:#FFFFFF     /* tarjetas */
--accent:#6153CE   /* morado: progreso, abonos, ingresos */
--accent-soft:#ECEAFB
--paid:#12855C     /* verde: SOLO deuda liquidada */
--paid-soft:#DDF0E8
--spend:#C0395F    /* gastos */
--gold:#A9761D     /* vencimientos */
--muted:#6D6890    /* texto secundario */
--line:#E4E1F2     /* bordes y divisores */
--track:#E7E4F6    /* fondo de barras de progreso */
```

**El verde está reservado a una sola cosa: la deuda pagada.** Ella lo pidió explícito
("verde cuando una deuda esté completamente pagada"). Si lo usas para otra cosa, ese estado
deja de destacar. Todo lo demás que sea positivo va en morado.

Lo que **sí** se conservó de la dirección de recibo: la estructura. Cifras en monoespaciada
tabular, densidad de líneas, el **borde inferior dentado** de la tarjeta principal (dientes
con `linear-gradient` en `.receipt::after`) y las filas con divisores punteados. Sin
gradientes de color, sin sombras tintadas, sin bordes gruesos.

Tipografía: `Avenir Next` (nativa de iOS) para interfaz, `ui-monospace` con
`font-variant-numeric: tabular-nums` para toda cifra. Nunca uses la mono para prosa ni la
display para números en columnas.

**Una tarjeta por deuda**, no una tabla: cuatro columnas no caben en un celular. Cada tarjeta
lleva ícono, nombre, saldo, barra de progreso, porcentaje y próximo vencimiento. El ícono y el
nombre son un botón (`.deuda-edit`) que abre la edición; el subtítulo dice "· Editar" para que
se note. Una deuda liquidada se tiñe de verde y recibe un sello `PAGADA`.

Reglas de UI que ya están aplicadas y deben mantenerse:

- `env(safe-area-inset-*)` en el contenedor y en la barra inferior (notch y home indicator).
- `inputmode="decimal"` en todo campo de dinero — abre el teclado numérico en iPhone.
- `font-size: 16px` mínimo en inputs; con menos, Safari hace zoom automático al enfocar.
- `@media (prefers-reduced-motion: reduce)` desactiva animaciones.
- Foco de teclado visible (`outline` en `:focus`).

Copy: voz directa, en segunda persona, sentence case. Los botones dicen lo que hacen
("Guardar ingreso", no "Enviar"). Los estados vacíos invitan a actuar, no se disculpan.

---

## 7. Backlog priorizado

Trabaja en orden. Cada punto trae su criterio de aceptación.

### Hecho

1. ~~Editar un movimiento.~~ Tocar una fila abre la hoja precargada y guarda sobre el mismo `id`.
2. ~~Recordatorio de respaldo.~~ A los 15 días (`DIAS_RESPALDO`); "Ahora no" pospone 7
   (`DIAS_SNOOZE`), no apaga el aviso. Exportar o importar lo reinician.
3. ~~Historial de ciclos.~~ Reemplazado por el modelo de deudas: cada deuda tiene su propio
   historial de abonos en la hoja `historial`.
4. ~~Multi-deuda.~~ N obligaciones independientes con total, día de pago y abonos.
5. ~~Aviso de vencimiento.~~ A `DIAS_VENCE` días, con acción directa a abonar.

### Pendiente

6. **Calendario de vencimientos.** Vista de mes con los días marcados y qué vence en cada uno.
   *Listo cuando:* con tres deudas en días distintos, se ven los tres en el mes correcto.

7. **Gráfica de los últimos 6 meses** (recibido vs abonado vs gastado). SVG dibujado a mano,
   sin librería. Barras, no líneas: son pocos datos y discretos.

8. **Exportar a CSV** además del JSON, para abrirlo en Excel o Sheets.

9. **Gasto recurrente rápido.** Accesos de un toque a los tres gastos más frecuentes del mes.

10. **Alerta de ritmo.** Si faltan N días para un vencimiento y no hay con qué cubrirlo,
    decirlo concreto: cuánto tendría que entrar por ingreso restante. Sin alarmismo.

11. **Reordenar y archivar deudas.** Las pagadas se van al fondo o a un archivo, para que la
    pantalla de Inicio no crezca sin control.

12. Modo oscuro con `prefers-color-scheme`.

13. Bloqueo con código de 4 dígitos al abrir (no es seguridad real, es privacidad de pantalla).

14. Migración opcional a Supabase para sincronizar y habilitar notificaciones push reales.
    Solo hay que reescribir `load()` y `save()`; el resto de la app no se entera.
    **No lo hagas sin que lo pidan explícitamente** — ver sección 9.

---

## 8. Cómo probar

```bash
python -m http.server 8000    # el service worker no funciona con file://
```

Luego `http://localhost:8000`. Para probar en el iPhone real, despliega en Vercel o GitHub
Pages (necesita HTTPS) y abre **en Safari**; Chrome en iOS no instala PWAs.

Validaciones mínimas antes de dar algo por terminado:

- `node --check` sobre el JS extraído, y la consola del navegador **sin errores**.
- Los totales cuadran: `libre + guardado = Σ jornada − Σ gasto − Σ abono`, y `guardado` nunca
  queda negativo.
- **Abonar no baja el disponible** mientras haya plata guardada. Es la razón de ser del modelo.
- Las migraciones desde `jornal.v1` y `jornal.v2` conservan `libre` exacto, no mueven ningún
  saldo y dejan su `.backup`.
- Prueba en ancho de 375px (iPhone SE) y 430px (Pro Max), sin desborde horizontal.
- Prueba en modo avión que la app abre y guarda.
- Exporta, borra todo, importa: los datos deben volver idénticos.
- Abre y cierra hojas de inmediato: no debe reventar ningún foco diferido.
- Actualización automática: con la app abierta y el service worker ya instalado, sube `CACHE`
  en `sw.js` y llama `navigator.serviceWorker.getRegistration().then(r=>r.update())`. La página
  debe recargarse sola. En una instalación desde cero **no** debe recargarse (sería un bucle).

---

## 9. Qué NO hacer

- No agregues React, Tailwind, ni ninguna dependencia. Es intencional que no haya build.
- No metas analítica, telemetría ni llamadas de red de ningún tipo.
- No cambies la clave de `localStorage` sin migración, y nunca borres los `.backup`.
- **No vuelvas a juntar los dos bolsillos.** Que un abono salga del disponible y lo deje en
  negativo fue un rechazo explícito de la clienta: ella separa la plata de las deudas de la
  plata de vivir, y la app tiene que reflejarlo.
- No metas gradientes de color, sombras tintadas ni bordes gruesos. La paleta es la del
  boceto de ella, pero la densidad y el detalle tipográfico son de recibo, y eso se mantiene.
- No uses el verde (`--paid`) para nada que no sea una deuda liquidada.
- No sustituyas `confirm()` por diálogos propios solo por estética: `confirm()` es nativo,
  accesible y funciona offline. Cámbialo únicamente si el reemplazo es mejor de verdad.
- **No asumas ingresos fijos en ninguna proyección: el monto por ingreso varía.** Toda
  estimación debe usar promedios de los ingresos reales, nunca un valor supuesto.
- No vuelvas a meter porcentajes en el reparto. Ella reparte **montos en pesos**, no
  porcentajes: "hoy $40.000 a la universidad y me quedan $30.000". Se probó con porcentaje y
  se descartó a petición suya.
- No prometas notificaciones push. Una PWA en iOS solo las tiene desde 16.4 y **necesita un
  servidor de push**; sin backend lo máximo es avisar cuando ella abre la app.
