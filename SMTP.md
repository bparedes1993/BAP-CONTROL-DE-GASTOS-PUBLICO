# Correo de acceso y administración

Actualización: 07/10/2026. El correo solicitado para administración es `contacto.bapsoluciones@gmail.com`. La autorización administrativa se reserva en el servidor y solo se reclama mediante una cuenta de BAP con ese correo **verificado**. Es de un solo uso, vence en 30 días si no se reclama y no vuelve a habilitarse tras eliminar/recrear la cuenta. Las decisiones comerciales continúan exigiendo MFA. No crea usuarios ni marca correos como confirmados.

## SMTP para el piloto sin comprar dominio

Los datos de conexión preparados son:

| Campo                        | Valor                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| Remitente y usuario SMTP     | contacto.bapsoluciones@gmail.com                                       |
| Nombre                       | BAP Soluciones                                                         |
| Host                         | smtp.gmail.com                                                         |
| Puerto                       | 465 (SSL/TLS)                                                          |
| Intervalo mínimo por usuario | 60 segundos                                                            |
| Contraseña                   | Contraseña de aplicación de Google, introducida únicamente en Supabase |

El titular debe activar la verificación en dos pasos de Google y crear la contraseña de aplicación. No se usa ni publica la contraseña habitual de Gmail. Introducir la credencial directamente en Authentication → Emails → SMTP Settings y guardar. Nunca enviarla en el chat, `config.js`, GitHub, respaldos JSON ni logs.

**Estado de implementación:** SMTP requiere completar el campo secreto y guardar para quedar activo. Campos rellenados o una solicitud aceptada no prueban envío. La entrega no está validada hasta recibir un acceso real y verificarlo en BAP.

Gmail es una opción transitoria para un piloto pequeño, con restricciones de volumen y entregabilidad. No se garantiza capacidad de servicio comercial con Gmail. Para crecer, contratar/seleccionar un proveedor transaccional y verificar un dominio con SPF, DKIM y DMARC. Cambiar el proveedor no requiere exponer credenciales al navegador ni migrar los datos financieros. No se ha contratado ningún servicio de pago.

## Plantillas y código de acceso

Después de activar SMTP, aplicar `auth-email-template.html` en las plantillas **Confirm sign up** y **Magic link or OTP**, con asuntos «BAP · Verifica tu correo» y «BAP · Tu código de acceso». Mantener `{{ .Token }}` y `{{ .SiteURL }}`. Supabase las sustituye; no colocar claves o saldos. Evitar seguimiento de aperturas/enlaces y recursos externos en los mensajes.

La web acepta código por correo mediante `verifyOtp` y sigue admitiendo el enlace actual mientras se configura la plantilla. El código no se guarda en IndexedDB/localStorage ni se imprime en logs. El segundo factor del administrador es distinto del código recibido por correo. No compartir ninguno con soporte. Revisar la expiración de OTP y los límites de verificación en Supabase antes de abrir el piloto.

## Validación de salida

1. En BAP, solicitar acceso para el correo administrador y recibir el código/enlace en su bandeja real.
2. Verificarlo, reclamar la autorización reservada y configurar/verificar MFA en Administración.
3. Probar un correo externo descartable, autorización del plan y aislamiento de datos con dos cuentas/dispositivos.
4. Confirmar registros en Auth y entrega del proveedor; revisar spam, errores y límites. Una respuesta SMTP aceptada no certifica llegada a bandeja.
5. Revisar usuarios existentes antes de activar el control obligatorio. No habilitar cobros automáticos desde el navegador.

El SMTP transmite mensajes de autenticación al proveedor; no almacena ni cifra los registros de gastos. Los permisos RLS, funciones protegidas, validación en servidor y MFA resguardan el acceso a los datos. Cifrado de copias locales, almacenamiento privado de fotos, respaldos completos, pruebas de carga y evaluación externa siguen requiriendo trabajo adicional.

Referencias: [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [plantillas](https://supabase.com/docs/guides/auth/auth-email-templates), [contraseñas de aplicación de Google](https://support.google.com/accounts/answer/185833), [límites de Gmail](https://support.google.com/mail/answer/22839).
