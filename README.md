# Jornal

Control de deudas que se pagan por abonos, más los ingresos y gastos del día a día.
Web app (PWA) pensada para instalarse en el iPhone. **Los datos no salen del teléfono**:
todo vive en `localStorage` del navegador. No hay servidor, no hay cuentas, no hay red.

## Archivos

```
index.html            la app completa (HTML + CSS + JS, sin dependencias)
manifest.webmanifest  metadatos para instalarla como app
sw.js                 service worker: hace que abra sin internet
vercel.json           evita que el CDN sirva una versión vieja
icon-192.png icon-512.png icon-maskable.png apple-touch-icon.png
```

## Cómo la subes (elige una)

**Vercel — se actualiza sola con cada cambio**
1. Entra a `vercel.com/new` y conéctate con GitHub.
2. Importa este repositorio.
3. Framework Preset: **Other**. Build Command y Output Directory: **déjalos vacíos**.
4. Deploy. Te queda una URL `https://algo.vercel.app`.

**GitHub Pages — sin cuenta nueva**
1. Settings → Pages → Source: `main` / carpeta `/root`.
2. Queda en `https://tuusuario.github.io/Jornal/`.

Necesita HTTPS para que el service worker y la instalación funcionen; por eso no basta
con abrir el archivo directamente desde Archivos del iPhone.

## Cómo la instalas en el iPhone

1. Abre la URL **en Safari** (no Chrome: en iOS solo Safari instala PWAs).
2. Botón compartir → **Añadir a pantalla de inicio**.
3. Ábrela desde el ícono. Aparece a pantalla completa, sin barra de navegador.

No existe un `.apk` para iPhone: eso es de Android. Instalada así se ve y se usa igual
que una app descargada de la App Store.

## Primer uso

Ve a **Ajustes → Deudas** y agrega cada obligación con su nombre, su total a pagar y el día
del mes en que la pagas. Por ejemplo: Universidad, $815.000, día 5.

## Cómo funciona

**Cada deuda es independiente.** Tiene su total, su día de pago y su propio historial de
abonos. Cada abono baja el saldo. Cuando llega a cero, la tarjeta se pone verde y queda
marcada como pagada.

**Los ingresos se reparten en pesos.** Cuando recibes plata, registras cuánto fue y escribes
cuánto le abonas a cada deuda: "recibí $200.000, $40.000 a la universidad, $25.000 al
celular". La app te muestra en vivo cuánto te queda libre. Ese resto es lo que puedes gastar
sin tocar lo de las deudas.

**Los gastos salen de lo libre.** El número grande de la pantalla de inicio ya tiene
descontado todo lo que abonaste.

También puedes abonar suelto desde la tarjeta de la deuda, sin registrar un ingreso.

## Avisos

- **Vencimiento cerca**: cinco días antes de la fecha de una deuda sin pagar, aparece en
  Inicio con el botón para abonar de una.
- **Respaldo**: si pasan 15 días sin descargar una copia, te lo recuerda. Puedes posponerlo
  con "Ahora no" y vuelve en una semana.

Los avisos solo aparecen **con la app abierta**. Notificaciones con la app cerrada no son
posibles sin un servidor, y esta app no tiene ninguno a propósito.

## Cuando publicas una versión nueva

La app se actualiza sola: al abrirla con internet detecta la versión nueva y se recarga.
No hay que borrar cachés ni reinstalar el ícono.

## Corregir algo que registraste mal

En **Movimientos**, toca la fila. Se abre con los datos que tiene y los puedes cambiar.
Si corriges un ingreso, sus abonos se rehacen con lo que dejes en el reparto. La **×** de
la derecha elimina; si borras un ingreso, se deshacen también sus abonos.

## Respaldo (importante)

Como no hay nube, si borras los datos de Safari o cambias de teléfono, se pierde todo.
En Ajustes → **Descargar copia de seguridad** obtienes un `.json` que puedes guardar
en iCloud Drive o Google Drive y restaurar después con **Restaurar desde una copia**.
En Ajustes siempre ves de cuándo es tu última copia.

## Si más adelante quieres sincronizar

La estructura de datos es un arreglo plano de movimientos
(`{id, tipo, fecha, monto, cat, deudaId, nota}`) más una lista de deudas. Migrar a Supabase
después es crear dos tablas con esas columnas y reemplazar `load()` / `save()`; el resto de
la app no se entera.
