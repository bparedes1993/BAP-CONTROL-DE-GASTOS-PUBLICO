# Preparación del despliegue de BAP Gastos

Estado: piloto publicado en Cloudflare Workers en `https://bap-control-de-gastos-publico.brparedes1993.workers.dev/`. GitHub Pages sigue disponible como despliegue anterior. No habilitar cobros en GitHub Pages. La aplicación está en el repositorio público `bparedes1993/BAP-CONTROL-DE-GASTOS-PUBLICO`.

## 1. Alojamiento gratuito sin dominio comprado

Ya existe una cuenta de Cloudflare y una dirección funcional `workers.dev`. Si se quiere migrar específicamente a Cloudflare Pages, usar **Workers & Pages → Create → Pages → Connect to Git**. Conectar únicamente el repositorio público indicado. Configurar la rama `main`, **Framework preset: None**, **Build command: `exit 0`**, **Build output directory: `.`** (la raíz del repositorio). Confirmar el despliegue y copiar la URL real `https://<nombre>.pages.dev/`. La dirección `pages.dev` no requiere dominio propio. Antes de conceder acceso a GitHub, revisar el alcance de permisos de la instalación Cloudflare; seleccionar solamente este repositorio si la interfaz permite esa opción.

No asumir un nombre `.pages.dev` antes de crearlo. El despliegue `workers.dev` existente no se convierte automáticamente en Pages. Cuando funcione la nueva dirección, retirar el uso comercial del despliegue GitHub Pages y conservarlo solo para demostración si corresponde.

## 2. Enlace de inicio de sesión

En Supabase → proyecto BAP Gastos → Authentication → URL Configuration, `https://bap-control-de-gastos-publico.brparedes1993.workers.dev/` ya figura como **Site URL** y **Redirect URL**. Se conserva temporalmente la URL anterior de GitHub Pages durante la transición. La ruta termina en `/`. Los enlaces de acceso se generan con la URL de la página donde el usuario pulsa el botón, por lo que la nueva dirección debe estar admitida antes de enviar pruebas.

Supabase Auth sin SMTP propio permite entregar correos solo a direcciones preautorizadas del equipo del proyecto y tiene límites de prueba. Para invitar clientes hace falta un SMTP de producción. Los proveedores de envío suelen requerir verificar un dominio de remitente. No compartir la contraseña de Google ni claves SMTP en el chat, el repositorio o `config.js`.

## 3. Prueba de sincronización con dos dispositivos

1. En el ordenador, abrir la nueva dirección HTTPS. Entrar con el correo elegido y abrir el enlace de acceso recibido.
2. Registrar un gasto de prueba sin fotografía. Esperar hasta que la app muestre **Sincronizado**.
3. En el celular, abrir la misma URL HTTPS e iniciar sesión con el **mismo correo**. Comprobar que aparece el gasto.
4. Editar el monto desde el celular. Volver al ordenador, dejar la pestaña visible y esperar hasta 30 segundos o recargar. Comprobar el nuevo monto.
5. Descargar un respaldo JSON antes de probar eliminaciones. Eliminar el gasto de prueba en un equipo y verificar que desaparezca en el otro.

Si no llega el enlace, revisar spam y los logs de Authentication en Supabase. Un mensaje de solicitud aceptada en la web no demuestra la entrega final. La prueba no debe darse por aprobada hasta observar los cambios en ambos equipos.

## 4. Antes de vender

- Identificar al responsable de datos y formalizar aviso de privacidad, términos y procedimiento verificable de eliminación de cuenta.
- Elegir una dirección de remitente y configurar SMTP con credenciales almacenadas únicamente en Supabase.
- Definir precio, límites y facturación. Implementar límites **en el servidor** (por ejemplo, políticas/RPC), no únicamente en JavaScript público. No hay pasarela de pago ni suscripción activa actualmente.
- Revisar cuotas del plan gratuito de Supabase, especialmente el tamaño de fotografías en la tabla `expenses`.

## Referencias oficiales

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Cloudflare Pages/Git: https://developers.cloudflare.com/pages/get-started/git-integration/
- Supabase SMTP: https://supabase.com/docs/guides/auth/auth-smtp

Cloudflare describe `workers.dev` como una dirección para empezar y recomienda dominio propio para aplicaciones comerciales importantes: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
