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

- **Inicio**: disponible para gastar, barra abonado/pendiente sobre el total de las deudas,
  una **tarjeta por deuda** (saldo, barra de progreso, % pagado, próximo vencimiento, botones
  de abonar y ver abonos), aviso de vencimiento cercano o de respaldo, resumen del mes y
  gastos por categoría.
- **Registrar ingreso**: monto recibido + **reparto en pesos** a cada deuda, con lo que queda
  libre calculado en vivo. Guardar crea el ingreso y un abono por cada deuda repartida.
- **Registrar gasto**: monto + categoría (pills) + fecha + nota.
- **Registrar abono** suelto a una deuda, con tope en el saldo.
- **Movimientos**: navegación por mes, totales de entrada/salida, tocar una fila la abre para
  editarla (escribe sobre el mismo `id`), eliminar con confirmación.
- **Ajustes**: CRUD de deudas (nombre, ícono, total, día de pago), CRUD de categorías.
- **Respaldo**: exportar/importar JSON, estado de la última copia, recordatorio a los 15 días
  sin respaldar, borrar todo con doble confirmación.

---

## 4. Modelo de datos

Un único objeto en `localStorage` bajo la clave `jornal.v2`:

```js
{
  cats: ['Transporte', 'Comida', ...],
  deudas: [
    { id, nombre, icono, total: Number, diaPago: Number }   // diaPago se limita a 1..28
  ],
  movs: [
    {
      id: 'string único',
      tipo: 'jornada' | 'gasto' | 'abono',
      fecha: 'YYYY-MM-DD',
      monto: Number,     // siempre positivo
      cat: 'string',     // solo en 'gasto'
      deudaId: 'string', // solo en 'abono'
      origen: 'string',  // solo en 'abono': id del ingreso del que salió, si nació de un reparto
      nota: 'string'     // opcional
    }
  ],
  ultimoRespaldo: null,  // 'YYYY-MM-DD' de la última copia descargada o restaurada
  avisoOculto: null      // 'YYYY-MM-DD' en que se descartó el recordatorio de respaldo
}
```

**Invariante central**:

```
libre        = Σ jornada.monto − Σ abono.monto − Σ gasto.monto     (totales())
saldo(deuda) = deuda.total − Σ abono de esa deuda                  (estadoDeuda())
```

**Repartir un ingreso a una deuda ES abonarle.** No hay estado intermedio de "apartado": el
saldo baja en el momento, igual que en el cuaderno de ella. Si alguna vez se quiere separar
"ya lo tengo guardado" de "ya lo pagué", eso es un tipo de movimiento nuevo, no un campo.

Un ingreso repartido genera **abonos hijos** con `origen` apuntando a su `id`. Al editar el
ingreso los hijos se **borran y se rehacen** (más simple que reconciliarlos y no se puede
desincronizar). Al borrarlo, se van con él.

### Migraciones

`jornal.v1` (una sola cuota mensual y un porcentaje por jornada) se migra sola en `load()`
con `migrarV1()`: la cuota se convierte en una deuda llamada "Crédito", lo que se apartaba de
cada jornada pasa a ser un abono a esa deuda, y los movimientos `pago` de v1 se descartan
porque allí apartar y pagar eran dos pasos y aquí es uno solo. **`libre` se conserva exacto.**
Antes de tocar nada se guarda una copia intacta en `jornal.v1.backup`.

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

- `load()` / `save()` / `migrarV1()` — persistencia y migración
- `totales()` — `{recibido, abonado, gastado, libre}`
- `deuda(id)` `abonadoDe(id)` `estadoDeuda(d)` `totalDeudas()` — la deuda y su progreso
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
- Los totales cuadran: el invariante de la sección 4, a mano.
- La migración desde `jornal.v1` conserva `libre` exacto y deja `jornal.v1.backup`.
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
- No cambies la clave de `localStorage` sin migración, y nunca borres `jornal.v1.backup`.
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
