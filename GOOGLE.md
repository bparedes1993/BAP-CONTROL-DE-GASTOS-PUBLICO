# Acceso con Google y planes

07/10/2026: el código de Google está incorporado y probado con API simulada. El proveedor de Supabase aún requiere un cliente OAuth creado por el titular. El botón permanece deshabilitado con un aviso hasta completar esa configuración; no se anuncia un inicio de sesión real como validado.

## Configuración del titular

En [Google Cloud](https://console.cloud.google.com/), seleccionar o crear un proyecto y abrir **Google Auth Platform**. No hace falta contratar servidores para este flujo. Revisar personalmente cualquier condición que Google solicite aceptar; no habilitar servicios de pago para configurar este acceso.

1. En **Branding**, usar nombre **BAP Gastos**, soporte y contacto `contacto.bapsoluciones@gmail.com`. En **Audience**, elegir **External** para clientes fuera de una organización. Para lanzar, revisar **In production** y las condiciones de Google. Solo pedir identidad básica: `openid`, `userinfo.email`, `userinfo.profile`; no permisos de Gmail, Drive, pagos ni bancos.
2. En **Clients → Create client**, seleccionar **Web application**, nombre **BAP Gastos web**. Copiar estos valores exactos:

| Campo de Google | Valor |
| --- | --- |
| Authorized JavaScript origins | `https://bap-control-de-gastos-publico.brparedes1993.workers.dev` |
| Authorized redirect URIs | `https://jytscsfyljyxvduymhpd.supabase.co/auth/v1/callback` |

3. El titular crea el cliente, guarda su **Client ID** y **Client Secret** y los introduce directamente en **Supabase → Authentication → Sign In / Providers → Google**. Activar el proveedor y guardar. Mantener **Skip nonce checks** y **Allow users without an email** desactivados. Nunca compartir secretos en chat, GitHub o `config.js`.
4. En **Supabase → Authentication → URL Configuration**, confirmar Site URL y Redirect URL exactas: `https://bap-control-de-gastos-publico.brparedes1993.workers.dev/`. No añadir comodines ni retornos a dominios de terceros.
5. Una vez guardado el proveedor, cambiar únicamente `googleLoginEnabled: true` en `config.js`, publicar y comprobar en la web el retorno a **Mi acceso**. La bandera controla el botón; no autoriza planes ni reemplaza los permisos de Supabase.

Los permisos básicos tienen una excepción a varias limitaciones del modo Testing: revisar la [documentación de audiencia](https://support.google.com/cloud/answer/15549945). La verificación de marca y logo es distinta del acceso básico. Sin dominio propio de Auth, Google puede mostrar `jytscsfyljyxvduymhpd.supabase.co` al usuario; un dominio propio es una mejora de confianza posterior. No se ha comprado ninguno.

## Puesta en marcha comercial

Instalación nueva: `supabase.sql`, `finance.sql`, `commercial.sql`, `admin-authorizations.sql`, `incremental-sync.sql` y **`commercial-onboarding.sql`**, en ese orden. Con autorización explícita del titular, reservar el administrador mediante la variante privada de `commercial-bootstrap.sql`. Tras revisar las cuentas, `commercial-enforce.sql` activa las reglas obligatorias sin conceder planes ni inventar pagos. Reaplicar `commercial.sql` requiere reaplicar después `commercial-onboarding.sql`, pues reemplaza funciones.

Cada cuenta verificada que abre BAP se registra en el panel, incluso sin elegir plan. Se conserva una última entrada aproximada por sesión de la web, con actualizaciones separadas por al menos quince minutos; no es un historial completo de autenticaciones. El registro no activa el plan, renueva vigencia ni altera pagos. Las cuentas existentes aparecerán al volver a entrar; no se han creado solicitudes en su nombre.

El titular entra con `contacto.bapsoluciones@gmail.com`, reclama la autorización reservada y configura/verifica MFA en **Administración**. Esa reserva no permite decisiones hasta completar el segundo factor. Desde allí puede cargar clientes, fijar precios y aprobar, renovar, suspender o rechazar acceso. El precio se deja **por acordar** hasta que el titular lo establezca: no se asignó un importe de venta sin su decisión.

El cliente elige un plan en **Mi acceso** y envía una solicitud. BAP comprueba el pago por fuera de la web y luego registra importe, medio, referencia y vigencia. No hay pasarela, cobro al iniciar sesión ni cargo recurrente automático. Leer/exportar datos propios se conserva al vencer; escribir/sincronizar cambios exige aprobación vigente. El administrador comercial no puede leer gastos o finanzas de clientes.

Google verifica la identidad sin depender del SMTP de BAP para ese inicio. El acceso alternativo por correo y los mensajes comerciales requieren su propia configuración de correo; no se ha validado su entrega. El flujo utiliza PKCE del SDK oficial. Los enlaces nuevos por correo deben abrirse en el navegador que los solicitó, o introducir el código recibido en esa sesión. Las sesiones persistidas siguen funcionando; enlaces antiguos con formato implícito deben solicitarse de nuevo.

## Comprobación antes de vender

Ejecutar `npm ci` y `npm test`. Las pruebas usan una base aislada, DOM y Auth/API simulados; no certifican Google real. Con cuentas descartables, comprobar retorno de Google en celular y computadora, registro sin plan, aprobación con MFA, expiración, aislamiento entre cuentas y exportación. Completar aviso legal, condiciones, soporte y respaldos antes de cobrar. Ver [SECURITY.md](SECURITY.md) y [COMERCIAL.md](COMERCIAL.md).

Referencias: [Google en Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google), [audiencia de Google](https://support.google.com/cloud/answer/15549945).
