# Control comercial de BAP Gastos

Estado al 07/10/2026: catálogo de planes y registro de cuentas verificadas al entrar incorporados. La instalación inicial conserva modo piloto; `commercial-enforce.sql` activa el control por petición del titular sin aprobar cuentas ni registrar pagos. El control obligatorio fue activado en este proyecto el 07/10/2026 por petición del titular: sin aprobación vigente solo se conserva consulta y exportación. La autorización administrativa reservada necesita inicio de sesión verificado y segundo factor. Google espera configuración del titular; ver [GOOGLE.md](GOOGLE.md). No hay cobros automáticos ni correos comerciales automáticos.

## Flujo de cliente

1. Entra en la URL de Cloudflare e inicia sesión. Google estará disponible después de configurar el proveedor; el acceso alternativo por correo requiere SMTP. La identidad verificada no acredita un pago ni activa un plan. La cuenta aparece en Administración aunque aún no solicite plan.
2. En **Mi acceso**, selecciona un plan y pulsa **Enviar solicitud de plan**. La solicitud queda pendiente en el servidor. No envía un correo al administrador: aparece en su panel.
3. BAP acuerda precio y condiciones y comprueba el pago recibido por fuera de la aplicación, si corresponde.
4. El administrador aprueba o renueva la vigencia. El cliente actualiza **Mi acceso** y ve su estado. Cuando el control está activo, solo un acceso vigente permite crear, editar, restaurar y sincronizar cambios.
5. Una cuenta vencida o suspendida puede leer y exportar sus propios registros, eliminar su propia cuenta y contactar al soporte. No se borran datos por falta de pago.

Los planes iniciales tienen precios vacíos: **mensual de 30 días**, **semestral de 180 días** y **anual de 365 días**. El titular fija precios y puede modificar días desde el panel. Estos periodos son días exactos, no meses del calendario. Editar un precio no cambia los pagos históricos ni las vigencias existentes.

## Activar al titular

1. Obtener su autorización explícita para el rol administrativo. La identidad debe corresponder a una cuenta de BAP con correo verificado; no basta iniciar sesión en el Dashboard de Supabase.
2. Ejecutar `admin-authorizations.sql` y luego `commercial-bootstrap.sql`, sustituyendo su marcador por el correo autorizado. Si la cuenta ya está verificada, asigna el rol. Si aún no existe, reserva una autorización de un solo uso por 30 días, que se reclama al verificar el correo e iniciar sesión. No crea usuarios ni confirma correos. Borrar/recrear la cuenta no permite reclamar una autorización ya consumida. No publicar la variante privada ni credenciales. Ver SMTP.md.
3. El titular inicia sesión en BAP. En **Administración**, pulsa **Configurar / verificar segundo factor**, guarda el factor en su aplicación autenticadora y verifica el código. Nunca compartirlo con el soporte ni en el chat.
4. **Cargar clientes**, aprobar las cuentas que deben conservar acceso y configurar precios. El panel muestra cuentas registradas, estados, pagos registrados y última entrada aproximada a BAP; no proporciona saldos personales ni un historial completo de sesiones.
5. Activar **Control obligatorio** solo después de revisar las cuentas actuales y probar el flujo con dos cuentas descartables. El servidor comprueba el plan; ocultar un botón no es la protección.

Las funciones administrativas exigen rol almacenado en la base y JWT con `aal2`. El usuario no puede darse un rol mediante `user_metadata`, alterar las tablas de planes ni confirmar su propio pago. El administrador comercial tampoco recibe acceso a los gastos personales de los clientes. Recuperar un segundo factor perdido requiere verificar identidad en un procedimiento de soporte; no existe un bypass público.

## Pago manual y correo

**Gestionar acceso** permite aprobar/renovar, suspender o no aprobar. Los días se agregan al vencimiento actual cuando el acceso sigue activo. Si ya venció, comienzan en la fecha del servidor. Se puede conceder acceso gratuito con importe cero.

Un importe mayor que cero exige medio y referencia única. La referencia impide registrar la misma operación dos veces en ese medio. El formulario usa una clave de operación para que reintentar después de un fallo de red no duplique el pago ni la renovación. Esto es un registro de un pago ya comprobado; no valida una captura, no consulta Yape/Plin/bancos, no transfiere dinero y no emite un comprobante tributario.

**Preparar correo** abre la aplicación de correo del administrador con un borrador de estado y enlace a BAP. El administrador revisa y envía el mensaje; BAP no lo envía automáticamente. Los enlaces de autenticación son enviados por Supabase Auth y necesitan SMTP de producción para clientes externos. No compartir claves SMTP ni colocarlas en el repositorio.

Antes de cobrar: completar SMTP y probar entrega a correos externos, publicar identidad del responsable y condiciones comerciales revisadas, definir soporte/cancelación/retención y comprobar acceso, expiración, respaldo y eliminación con cuentas de prueba. La pasarela y suscripciones con cobro recurrente requieren una integración posterior con validación de webhooks en servidor; un botón del navegador nunca debe certificar un pago.

## Copias y límites

Cada plan tiene un límite inicial de 5,000 registros de gastos y 5,000 financieros por cuenta, incluidos los registros de borrado que preservan sincronización. La foto comprimida no puede superar 1 MiB. Estos límites por usuario no garantizan que el plan gratuito alcance para todos los clientes: se debe medir el consumo agregado de la base, fotografías y transferencia.

Los gastos/fotos y finanzas tienen respaldos separados. Para restaurar compras a crédito en otra base, restaurar **primero finanzas**, esperar su sincronización y luego gastos; el servidor valida la tarjeta vinculada. Con control comercial activo, se requiere verificar la autorización en línea al abrir la app; sin esa consulta se conserva lectura local y exportación, pero se bloquean nuevas modificaciones. Los cambios pendientes solo se suben cuando hay autorización.

## Sincronización incremental

`incremental-sync.sql` agrega versiones del servidor, índices por usuario y un RPC que entrega solo filas posteriores al cursor del dispositivo. Los datos existentes conservan versión cero; la primera consulta los descarga por páginas. Se incluyen borrados y se conservan los permisos de lectura propia al vencer. Los cursores y datos de cada página se confirman juntos en IndexedDB; un fallo permite reintentar sin saltarse registros. Los datos del cursor no aparecen en reportes ni respaldos.

El RPC y las escrituras autenticadas usan un bloqueo por usuario para no avanzar sobre cambios sin confirmar. Las páginas de gastos tienen hasta 5 filas por las fotografías; las financieras, hasta 100. Las fotos permanecen en la base y requieren una migración posterior a almacenamiento privado antes de ampliar volumen. No se ha medido concurrencia ni sustituido las pruebas de carga.

## Pruebas y alcance

Ejecutar `npm ci` y `npm test`. La prueba comercial levanta PostgreSQL aislado mediante PGlite y usa correos `.invalid`; no toca datos de producción. Cubre permisos anónimos, autoactivación, MFA administrativo, aislamiento, expiración, suspensión, duplicación de operaciones y pagos, límites y validación de datos. No simula carga de cientos de clientes ni comprueba la entrega de SMTP.

La suite incluye comprobaciones del cliente con DOM sintético y API simulada para acceso activo, pendiente/vencido, exportación conservada y demo aislada. La comprobación completa de correo, MFA y dos dispositivos se realiza después con cuentas de prueba.

Referencias: [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
