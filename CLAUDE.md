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

---

## 6. Sistema de diseño — respétalo

Dirección visual: **recibo de caja**. Papel marfil, tinta verde muy oscura, cifras en
monoespaciada tabular como impresión térmica. El elemento firma es la tarjeta principal con
**borde inferior dentado** (dientes hechos con `linear-gradient`, en `.receipt::after`).

```css
--ink:#12241C      /* texto y botones primarios */
--paper:#EDEBE1    /* fondo de la app */
--card:#FBFAF6     /* tarjetas */
--accent:#17694F   /* verde: abonado, ingresos, deuda pagada */
--spend:#9A2B2B    /* rojo: gastos */
--gold:#A9791F     /* ámbar: vencimientos, abonos */
--muted:#66746B    /* texto secundario */
--line:#DAD6C9     /* bordes y divisores */
```

Tipografía: `Avenir Next` (nativa de iOS) para interfaz, `ui-monospace` con
`font-variant-numeric: tabular-nums` para toda cifra. Nunca uses la mono para prosa ni la
display para números en columnas.

**Las tarjetas de deuda (`.deuda`) son una decisión negociada, no un descuido.** La clienta
pidió tarjetas tipo app bancaria; se hicieron tarjetas, porque una tabla de cuatro columnas no
cabe en un celular, pero **en el lenguaje del recibo**: papel marfil, borde de un píxel, cifras
monoespaciadas. Sin gradientes, sin sombras de colores, sin morados. Una deuda liquidada se
tiñe de verde y recibe un sello `PAGADA`.

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

---

## 9. Qué NO hacer

- No agregues React, Tailwind, ni ninguna dependencia. Es intencional que no haya build.
- No metas analítica, telemetría ni llamadas de red de ningún tipo.
- No cambies la clave de `localStorage` sin migración, y nunca borres `jornal.v1.backup`.
- No reemplaces el diseño por un dashboard genérico con tarjetas de gradiente. La identidad
  de recibo es deliberada y ya sobrevivió a una petición explícita en contra.
- No sustituyas `confirm()` por diálogos propios solo por estética: `confirm()` es nativo,
  accesible y funciona offline. Cámbialo únicamente si el reemplazo es mejor de verdad.
- **No asumas ingresos fijos en ninguna proyección: el monto por ingreso varía.** Toda
  estimación debe usar promedios de los ingresos reales, nunca un valor supuesto.
- No vuelvas a meter porcentajes en el reparto. Ella reparte **montos en pesos**, no
  porcentajes: "hoy $40.000 a la universidad y me quedan $30.000". Se probó con porcentaje y
  se descartó a petición suya.
- No prometas notificaciones push. Una PWA en iOS solo las tiene desde 16.4 y **necesita un
  servidor de push**; sin backend lo máximo es avisar cuando ella abre la app.
