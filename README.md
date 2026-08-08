# Jornal

Control de jornadas laboradas, apartado automático de un porcentaje y gastos.
Web app (PWA) pensada para instalarse en el iPhone. **Los datos no salen del teléfono**:
todo vive en `localStorage` del navegador. No hay servidor, no hay cuentas, no hay red.

## Archivos

```
index.html            la app completa (HTML + CSS + JS, sin dependencias)
manifest.webmanifest  metadatos para instalarla como app
sw.js                 service worker: hace que abra sin internet
icon-192.png icon-512.png icon-maskable.png apple-touch-icon.png
```

## Cómo la subes (elige una)

**Netlify Drop — lo más rápido, sin cuenta obligatoria**
1. Entra a `app.netlify.com/drop` desde el PC.
2. Arrastra la carpeta completa.
3. Te da una URL `https://algo.netlify.app`. Esa es tu app.

**GitHub Pages — si la quieres versionada**
1. Crea un repo (por ejemplo `jornal`) y sube estos archivos a la raíz.
2. Settings → Pages → Source: `main` / carpeta `/root`.
3. Queda en `https://tuusuario.github.io/jornal/`.

Necesita HTTPS para que el service worker y la instalación funcionen; por eso no basta
con abrir el archivo directamente desde Archivos del iPhone.

## Cómo la instalas en el iPhone

1. Abre la URL **en Safari** (no Chrome: en iOS solo Safari instala PWAs).
2. Botón compartir → **Añadir a pantalla de inicio**.
3. Ábrela desde el ícono. Aparece a pantalla completa, sin barra de navegador.

## Primer uso

Ve a **Ajustes** y define tres cosas: el porcentaje que apartas de cada jornada,
el valor de la cuota y el día del mes en que pagas. Después solo registras jornadas y gastos.

## Cómo funciona el apartado

Al guardar una jornada, la app crea el movimiento y **parte el monto en dos**:
el porcentaje configurado se va al acumulado de la cuota y el resto entra a *Disponible*.
Los gastos salen únicamente de *Disponible*. Así el número grande de la pantalla de inicio
ya está limpio: es plata que puedes gastar sin tocar la cuota.

El porcentaje se puede cambiar en una jornada puntual (si un día ganaste más y quieres
apartar más) sin modificar la regla general.

Cuando pagas, usas **Registrar pago de la cuota**: ese monto sale del acumulado y el
contador arranca de nuevo para el siguiente ciclo.

## Corregir algo que registraste mal

En **Movimientos**, toca la fila. Se abre con los datos que tiene y los puedes cambiar.
Si corriges el monto de una jornada, lo apartado se vuelve a calcular con el porcentaje
que le pusiste a esa jornada. La **×** de la derecha sigue siendo para eliminar.

## Respaldo (importante)

Como no hay nube, si borras los datos de Safari o cambias de teléfono, se pierde todo.
En Ajustes → **Descargar copia de seguridad** obtienes un `.json` que puedes guardar
en iCloud Drive o Google Drive y restaurar después con **Restaurar desde una copia**.

## Si más adelante quieres sincronizar

La estructura de datos es un arreglo plano de movimientos
(`{id, tipo, fecha, monto, aparta, cat, nota}`). Migrar a Supabase después es
crear una tabla con esas columnas y reemplazar `load()` / `save()`; el resto de la app
no se entera.
