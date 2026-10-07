# BAP Gastos y Finanzas

Aplicación web adaptable e instalable para registrar gastos desde celular y computadora.

## Control comercial (07/10/2026)

Incluye Mi acceso, catálogo de planes, registro de clientes al entrar, vigencias, pago manual registrado por el administrador y auditoría. Las decisiones administrativas exigen segundo factor; el backend valida el permiso para escribir. Consulta [COMERCIAL.md](COMERCIAL.md) y [SECURITY.md](SECURITY.md). La instalación base conserva modo piloto; en este proyecto el control obligatorio se activó en Supabase el 07/10/2026 por petición del titular mediante `commercial-enforce.sql`. Las cuentas sin plan aprobado conservan lectura/exportación y no pueden guardar cambios. La configuración de Google está preparada y el botón espera las credenciales OAuth en Supabase; ver [GOOGLE.md](GOOGLE.md). El acceso alternativo admite código o enlace por correo; SMTP sigue requiriendo credencial y prueba de entrega. Incluye autorización administrativa reservada y sincronización incremental. Ver [SMTP.md](SMTP.md). No hay cobros automáticos.

Pruebas: `npm ci` y `npm test`. El SQL está documentado en `commercial.sql` y el rol inicial en `commercial-bootstrap.sql`; no ejecutar la asignación sin autorización del titular.

## Finanzas personales

Ingresos cobrados, tarjetas, deudas, préstamos otorgados, pagos/cobros con desglose, flujo de efectivo y distribución mensual de dinero. Incluye orientación de reducción de deuda, reserva e instrumentos de simulación con supuestos explícitos. Consulta [FINANZAS.md](FINANZAS.md) para registrar correctamente saldos base y movimientos.

`finance.sql` documenta la migración de Supabase para los nuevos registros, sus políticas RLS y el enlace de compras a crédito.

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
4. Abre la aplicación en cada dispositivo, pulsa **Sincronización**, inicia sesión con la misma cuenta verificada en ambos equipos (Google tras configurarlo, o correo con SMTP). Con un plan vigente, el primer dispositivo asociará sus registros locales a la cuenta y los subirá. El segundo descargará esos registros. Comprueba que aparecen en ambos antes de borrar datos locales.

Los cambios pendientes se guardan localmente y se reintentan al volver internet, al volver a abrir la pestaña y cada 30 segundos mientras la app está abierta. Cuando la tabla está habilitada en Supabase Realtime, el otro dispositivo recibe una señal y consulta enseguida los cambios autorizados; el temporizador sigue como respaldo. Las eliminaciones se sincronizan mediante registros de borrado. Si dos dispositivos modifican el mismo registro a la vez, prevalece el cambio con la fecha de modificación más reciente. El inicio de sesión y la primera descarga requieren conexión. No uses perfiles compartidos entre distintas cuentas; conserva un respaldo antes de cambiar de cuenta. Las fotografías comprimidas se almacenan con el gasto en la base en línea; vigila el espacio del proyecto. Los gastos existentes pueden editarse desde el botón **Editar** de cada movimiento.

Si `config.js` queda vacío, la aplicación continúa en modo local. El repositorio de publicación es público y Cloudflare sirve la aplicación por HTTPS. La sincronización entre dos dispositivos debe comprobarse entrando con el mismo correo en ambos. Sin inicio de sesión, los datos en línea no se muestran. La clave publicable es visible por diseño; las reglas RLS protegen los datos de cada usuario.

## Preparación para comercializar

La publicación en GitHub Pages queda para demostración y uso personal; el servicio comercial utiliza la dirección de Cloudflare indicada arriba. Antes de ofrecerlo a clientes, completa Google según GOOGLE.md y prueba el flujo de alta y sincronización con dos dispositivos reales. Configura SMTP si ofrecerás acceso alternativo por correo. No hay cobros automáticos. El módulo comercial implementa planes y límites en el servidor; el control obligatorio está activo, pero faltan Google real, administrador con MFA y las pruebas de salida antes de vender. Prepara aviso de privacidad, términos y contacto de soporte y verifica el procedimiento de eliminación de cuenta antes de invitar clientes.

## Estado de publicación y privacidad

`privacy.html` describe el tratamiento técnico de la versión piloto y enlaza el soporte. Falta identificar formalmente al responsable y revisar el aviso legal antes de aceptar clientes de pago. La función `account-deletion.sql` permite al usuario autenticado eliminar su propia cuenta; la FK borra sus gastos de la nube mediante `ON DELETE CASCADE`. La migración está aplicada y el botón está habilitado mediante `accountDeletion: true` en `config.js`. La comprobación de permisos confirmó que `authenticated` puede ejecutar la función y `anon` no. La eliminación efectiva debe verificarse con una cuenta de prueba descartable antes de invitar clientes. El soporte sigue disponible si falla el proceso. El usuario debe borrar por separado sus copias locales y respaldos descargados. Nunca incluir una clave administrativa en código público.

La caché PWA consulta la red cuando hay conexión y conserva la última versión disponible para uso sin conexión. Para probar una versión nueva, recarga la página conectada.

La URL `workers.dev` sirve para validar el piloto; Cloudflare recomienda usar un dominio propio para servicios comerciales importantes.

## Tiempo real

La app escucha únicamente cambios de `expenses` filtrados por el ID de la cuenta; la lectura real continúa protegida por RLS. Para habilitar eventos de la tabla, ejecutar una sola vez `realtime.sql` en SQL Editor. Si falla la conexión WebSocket, la sincronización periódica continúa. No confundir una notificación en tiempo real con confirmación de entrega de cada modificación: la fuente de verdad sigue siendo la tabla.

## Siguiente etapa comercial

Consulta [ARQUITECTURA_Y_VENTA.md](ARQUITECTURA_Y_VENTA.md) para la separación de Gastos, Legal y Contable, los requisitos previos a la venta y las pruebas de salida del piloto.
