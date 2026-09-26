# BAP Gastos

Aplicación web adaptable e instalable para registrar gastos desde celular y computadora.

## Funciones

- Fotografía de comprobantes desde la cámara del móvil o archivo del equipo.
- Lectura OCR opcional de comercio, fecha y total con Tesseract.js (requiere internet; confirma los datos antes de guardar).
- Registro y edición de categoría, método de pago, notas y foto; resumen mensual y distribución por categoría.
- Exportación del mes a PDF mediante la opción **Guardar como PDF** del navegador y archivo Excel real `.xlsx`.
- Respaldo y restauración JSON de todos los gastos y fotos.
- Datos en IndexedDB del navegador y recursos de la app almacenados para uso sin conexión después de la primera visita. OCR requiere conexión.

## Ejecutar localmente

En la carpeta del proyecto, ejecutar `python -m http.server 8000` y abrir `http://localhost:8000`. En móvil, publicar en HTTPS (por ejemplo, un alojamiento HTTPS) para permitir instalación PWA y cámara. Abrir `index.html` directamente puede limitar el almacenamiento o la instalación.

## Privacidad y límites

La aplicación usa una cuenta de correo para sincronizar gastos cuando Supabase está configurado. También conserva una copia local para trabajar sin conexión. Haz respaldo JSON regularmente. Borrar los datos del navegador elimina los registros locales. La lectura OCR descarga Tesseract.js y sus modelos desde servicios externos y procesa la imagen en el navegador; no se envía a un backend de BAP. La precisión varía con la fotografía. El PDF se produce mediante impresión del navegador. Esta versión no importa movimientos bancarios, no emite comprobantes ni se conecta a SUNAT.

## Sincronización automática (opcional)

La aplicación incluye inicio de sesión por enlace al correo y sincronización en ambos sentidos. Para activarla:

1. El proyecto Supabase ya está creado. La tabla `expenses` y sus políticas de acceso por usuario ya están configuradas; `supabase.sql` documenta el esquema.
2. `config.js` ya contiene la URL del proyecto y la clave publicable. **Nunca coloques una `service_role` o `secret key` en el navegador ni en GitHub.**
3. La aplicación está disponible en https://bap-control-de-gastos-publico.brparedes1993.workers.dev/; esta dirección figura como Site URL y Redirect URL en Supabase. La anterior de GitHub Pages permanece temporalmente en Redirect URLs. El proveedor Email está habilitado.
4. Abre la aplicación en cada dispositivo, pulsa **Sincronización**, introduce el mismo correo y abre el enlace recibido. El primer dispositivo asociará sus registros locales a la cuenta y los subirá. El segundo descargará esos registros. Comprueba que aparecen en ambos antes de borrar datos locales.

Los cambios pendientes se guardan localmente y se reintentan al volver internet, al volver a abrir la pestaña y cada 30 segundos mientras la app está abierta. Cuando la tabla está habilitada en Supabase Realtime, el otro dispositivo recibe una señal y consulta enseguida los cambios autorizados; el temporizador sigue como respaldo. Las eliminaciones se sincronizan mediante registros de borrado. Si dos dispositivos modifican el mismo registro a la vez, prevalece el cambio con la fecha de modificación más reciente. El inicio de sesión y la primera descarga requieren conexión. No uses perfiles compartidos entre distintas cuentas; conserva un respaldo antes de cambiar de cuenta. Las fotografías comprimidas se almacenan con el gasto en la base en línea; vigila el espacio del proyecto. Los gastos existentes pueden editarse desde el botón **Editar** de cada movimiento.

Si `config.js` queda vacío, la aplicación continúa en modo local. El repositorio de publicación es público y Cloudflare sirve la aplicación por HTTPS. La sincronización entre dos dispositivos debe comprobarse entrando con el mismo correo en ambos. Sin inicio de sesión, los datos en línea no se muestran. La clave publicable es visible por diseño; las reglas RLS protegen los datos de cada usuario.

## Preparación para comercializar

La publicación actual en GitHub Pages es para demostración y uso personal. Antes de ofrecer la aplicación como servicio comercial, migra el frontend a un alojamiento que admita ese uso, configura un SMTP propio para los enlaces de acceso y prueba el flujo de alta y sincronización con dos dispositivos reales. No hay cobros ni planes activos; los precios y límites requieren una implementación con validación en el servidor. Prepara aviso de privacidad, términos, contacto de soporte y un procedimiento para eliminar la cuenta y sus datos antes de invitar clientes.

## Estado de publicación y privacidad

`privacy.html` describe el tratamiento técnico de la versión piloto y enlaza el soporte. Falta identificar formalmente al responsable y revisar el aviso legal antes de aceptar clientes de pago. La función `account-deletion.sql` permite al usuario autenticado eliminar su propia cuenta; la FK borra sus gastos de la nube mediante `ON DELETE CASCADE`. La migración está aplicada y el botón está habilitado mediante `accountDeletion: true` en `config.js`. La comprobación de permisos confirmó que `authenticated` puede ejecutar la función y `anon` no. La eliminación efectiva debe verificarse con una cuenta de prueba descartable antes de invitar clientes. El soporte sigue disponible si falla el proceso. El usuario debe borrar por separado sus copias locales y respaldos descargados. Nunca incluir una clave administrativa en código público.

La caché PWA consulta la red cuando hay conexión y conserva la última versión disponible para uso sin conexión. Para probar una versión nueva, recarga la página conectada.

La URL `workers.dev` sirve para validar el piloto; Cloudflare recomienda usar un dominio propio para servicios comerciales importantes.

## Tiempo real

La app escucha únicamente cambios de `expenses` filtrados por el ID de la cuenta; la lectura real continúa protegida por RLS. Para habilitar eventos de la tabla, ejecutar una sola vez `realtime.sql` en SQL Editor. Si falla la conexión WebSocket, la sincronización periódica continúa. No confundir una notificación en tiempo real con confirmación de entrega de cada modificación: la fuente de verdad sigue siendo la tabla.

## Siguiente etapa comercial

Consulta [ARQUITECTURA_Y_VENTA.md](ARQUITECTURA_Y_VENTA.md) para la separación de Gastos, Legal y Contable, los requisitos previos a la venta y las pruebas de salida del piloto.
