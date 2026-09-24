# BAP Gastos

Aplicación web adaptable e instalable para registrar gastos desde celular y computadora.

## Funciones

- Fotografía de comprobantes desde la cámara del móvil o archivo del equipo.
- Lectura OCR opcional de comercio, fecha y total con Tesseract.js (requiere internet; confirma los datos antes de guardar).
- Registro de categoría, método de pago, notas y foto; resumen mensual y distribución por categoría.
- Exportación del mes a PDF mediante la opción **Guardar como PDF** del navegador y archivo Excel XML `.xls` compatible con Excel.
- Respaldo y restauración JSON de todos los gastos y fotos.
- Datos en IndexedDB del navegador y recursos de la app almacenados para uso sin conexión después de la primera visita. OCR requiere conexión.

## Ejecutar localmente

En la carpeta del proyecto, ejecutar `python -m http.server 8000` y abrir `http://localhost:8000`. En móvil, publicar en HTTPS (por ejemplo, GitHub Pages) para permitir instalación PWA y cámara. Abrir `index.html` directamente puede limitar el almacenamiento o la instalación.

## Privacidad y límites

No hay servidor ni cuenta de usuario. Cada navegador o dispositivo mantiene sus propios gastos; los datos **no se sincronizan** automáticamente. Haz respaldo JSON regularmente y restáuralo en otro dispositivo cuando lo necesites. Borrar los datos del navegador elimina los registros locales. La lectura OCR descarga Tesseract.js y sus modelos desde servicios externos y procesa la imagen en el navegador; no se envía a un backend de BAP. La precisión varía con la fotografía. El PDF se produce mediante impresión del navegador. Esta versión no importa movimientos bancarios, no emite comprobantes ni se conecta a SUNAT.

## Sincronización automática (opcional)

La aplicación incluye inicio de sesión por enlace al correo y sincronización en ambos sentidos. Para activarla:

1. Crea un proyecto en Supabase. En **SQL Editor**, ejecuta el archivo `supabase.sql` una sola vez.
2. Abre `config.js` y coloca **Project URL** y la **publishable key** pública (o la `anon` legada). **Nunca coloques una `service_role` o `secret key` en el navegador ni en GitHub.**
3. Publica el sitio en una dirección HTTPS estable. En **Authentication > URL Configuration** del proyecto, configura esa dirección como Site URL y añade la misma ruta a Redirect URLs para los enlaces de acceso por correo. El inicio de sesión mediante enlace debe estar habilitado.
4. Abre la aplicación en cada dispositivo, pulsa **Sincronización**, introduce el mismo correo y abre el enlace recibido. El primer dispositivo asociará sus registros locales a la cuenta y los subirá. El segundo descargará esos registros. Comprueba que aparecen en ambos antes de borrar datos locales.

Los cambios pendientes se guardan localmente y se reintentan al volver internet, al volver a abrir la pestaña y cada 30 segundos mientras la app está abierta. Las eliminaciones se sincronizan mediante registros de borrado. Si dos dispositivos modifican el mismo registro a la vez, prevalece el cambio con la fecha de modificación más reciente. El inicio de sesión y la primera descarga requieren conexión. No uses perfiles compartidos entre distintas cuentas; conserva un respaldo antes de cambiar de cuenta. Las fotografías comprimidas se almacenan con el gasto en la base en línea; vigila el espacio del proyecto. En esta versión no se editan gastos existentes.

Si `config.js` queda vacío, la aplicación continúa en modo local. El repositorio es privado y **subir el código no publica automáticamente el sitio**. Para usarlo en dos dispositivos falta habilitar un hosting HTTPS y completar la configuración anterior. El modo en línea no se puede probar con credenciales de producción hasta disponer de un proyecto Supabase.
