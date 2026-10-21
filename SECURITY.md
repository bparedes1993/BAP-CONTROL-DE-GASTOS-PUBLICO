# Revisión técnica de seguridad y capacidad

## Revisión de recuperación y uso diario · 21/10/2026

Alcance: revisión del código publicado y pruebas aisladas de PostgreSQL, DOM e IndexedDB. No se ejecutaron ataques ni restauraciones contra datos reales de clientes. Las pruebas de RLS, autorización comercial y administración con MFA vuelven a ejecutarse; no equivalen a una comprobación de toda la configuración actual del proveedor ni a una certificación.

### Hallazgos corregidos

- El guardado de gastos esperaba el éxito de una petición, no la confirmación de la transacción. Ahora espera la confirmación completa; una escritura abortada no se anuncia como guardada.
- La restauración de gastos escribía uno por uno. Gastos y finanzas usan ahora una transacción que conserva la copia previa de la cuenta y aplica la importación completa. Un fallo de escritura revierte la operación. Se rechazan IDs repetidos, fechas imposibles y colisiones con registros locales de otra cuenta; se revisan vínculos de tarjeta y cronogramas antes de importar gastos.
- La confirmación de un envío de gastos podía limpiar la marca pendiente de una edición posterior. Ahora compara la versión guardada dentro de una transacción. Las fechas de modificación son crecientes y los cambios que llegan durante una sincronización provocan otra pasada.
- El modo local eliminaba definitivamente los gastos. Ahora conserva una marca de eliminación y ofrece una papelera con los últimos 50 gastos de la cuenta. Recuperar valida la tarjeta, conserva el ID y vuelve a incluir el gasto en sus totales. Los cronogramas eliminados deliberadamente no se recrean; deben revisarse al recuperar una compra.
- El cierre de sesión avisa si quedan cambios por enviar. El panel muestra pendientes de gastos y finanzas y oculta registros y papelera sin sesión antes de iniciar lecturas asíncronas; también limpia los formularios del propietario anterior. La búsqueda filtra listas de gastos e ingresos por el período y moneda seleccionados, sin cambiar totales ni reportes.

### Alcance de las copias

Se conserva **una copia local previa a la última restauración por cuenta y por tipo de datos**. Puede descargarse en el formato JSON de gastos o finanzas para restaurarla mediante el flujo habitual, con confirmación. Las copias internas se excluyen de los registros sincronizados y los reportes, y se limpian junto con los datos locales al eliminar la cuenta. Solo se muestra/exporta la copia del propietario actual.

La copia previa y la papelera dependen del mismo almacenamiento del navegador: **no reemplazan un respaldo externo ni un respaldo de la base del servicio**. Un error de cuota cancela la importación y conserva los datos anteriores. Los JSON descargados y las copias locales no están cifrados con una clave exclusiva del usuario; deben conservarse en dispositivos propios y protegidos. El borrado del almacenamiento puede eliminar copias locales y cambios no enviados.

### Prioridades que requieren validación adicional

1. Verificar y ensayar la recuperación completa de la base del servicio en un entorno separado, con responsables, frecuencia, retención y tiempos de recuperación definidos.
2. Probar dos cuentas y dos dispositivos reales, desconexión, reconexión y pérdida de sesión; la suite utiliza API/Auth simulados para no tocar datos de clientes.
3. Revisar las cuentas administrativas, MFA, alertas del proveedor y exposición de credenciales mediante una evaluación operativa independiente. Los controles SQL actuales conservan propiedad por usuario y MFA administrativa.
4. Evaluar cifrado de copias externas, historial recuperable de registros financieros y traslado de fotos a almacenamiento privado según el volumen. Evitar promesas de invulnerabilidad, recuperación ilimitada o capacidad no medida.

La evidencia automatizada incluye abortar una importación después de iniciar escrituras, aislamiento de la copia previa, limpieza de esa copia, confirmación tardía de envíos, recuperación local, importación desde los formularios, ocultación al cerrar sesión y búsqueda sin alterar totales.


20/10/2026: se añaden validaciones de moneda y enlaces de cronogramas en servidor, presupuestos por usuario/moneda y destinos de cobro protegidos mediante RPC. Solo usuarios verificados consultan medios activos; modificarlos exige rol administrativo con MFA y revisión vigente. QR limitado a PNG procesado, sin SVG ni imágenes remotas. Las nuevas pruebas usan PostgreSQL aislado y DOM/Auth simulados; no se introducen cuentas, QR ni pagos de prueba en producción. La lectura del QR y el abono real requieren la comprobación del titular. Ver [MONEDAS_Y_COBROS.md](MONEDAS_Y_COBROS.md).

Fecha: 07/10/2026. Alcance: código propio de la web, migraciones PostgreSQL, validación y permisos comerciales. Es una revisión técnica con pruebas de regresión; **no es una certificación ni un pentest independiente**. No se garantiza invulnerabilidad o capacidad ilimitada.

## Estructura

La web conserva módulos separados de gastos (`app.js`), cálculo (`finance-model.js`), registros financieros (`finance.js`) y acceso comercial (`commercial.js`). La autoridad de acceso está en Supabase: RLS para propiedad de los datos, RPC para decisiones comerciales y triggers para validar registros/cuotas. Cloudflare sirve los recursos públicos; el repositorio y la clave publicable son públicos por diseño. Las claves administrativas, SMTP y de cobro nunca deben estar ahí.

## Controles incorporados

| Riesgo                                          | Control y alcance                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leer datos de otro cliente                      | Políticas por `auth.uid()` en gastos y finanzas. La administración no obtiene permisos para esos registros.                                                                                 |
| Autoactivarse un plan o un rol                  | Tablas comerciales sin escritura directa para `authenticated`; RPC verifican usuario y rol del servidor. No se confía en metadatos editables del usuario.                                   |
| Tomar decisiones con un solo factor             | Funciones administrativas exigen `aal2` en el JWT emitido por Supabase Auth, además del rol.                                                                                                |
| Seguir escribiendo después de vencer            | Políticas restrictivas agregadas a INSERT/UPDATE, vigencia comparada con hora del servidor y estado activo. Lectura/exportación propia se conservan.                                        |
| Duplicar un pago por reintento                  | Identificador de operación y referencia única por medio; decisión y registro del pago en una transacción.                                                                                   |
| Desbordar registros o enviar datos inválidos    | Validación de JSON, importes, fechas y propiedad de enlaces; cuota por usuario, bloqueo transaccional al contar registros y foto de máximo 1 MiB.                                           |
| Ejecutar HTML introducido por un usuario        | Escape de texto en vistas/reportes; fotos limitadas a formatos de imagen en data URL; CSP excluye scripts inline, objetos y marcos de terceros.                                             |
| Dependencia cambiante de autenticación          | Biblioteca oficial Supabase 2.117.2 servida localmente y licencia conservada. OCR sigue usando recursos externos fijados; necesita mantenimiento y pruebas propios.                         |
| Clickjacking / filtrar URL de acceso a terceros | `_headers` agrega DENY/frame-ancestors, no-referrer, nosniff, HSTS y política de permisos. Debe verificarse su aplicación efectiva en cada despliegue; GitHub Pages no aplica este archivo. |

Las funciones `security definer` fijan `search_path=''`, califican los esquemas y revocan ejecución implícita para PUBLIC/anon. El esquema auxiliar no se expone al cliente.

## Evidencia

La suite completa del 07/10/2026 pasó 164 comprobaciones de acceso comercial, autorización administrativa, sincronización, registro de clientes, OAuth con API simulada y cliente, además de los escenarios de cálculo financiero. Las pruebas incluyen autorizaciones vencidas/revocadas, consumo de un solo uso, aislamiento entre cuentas, reintentos y guardado atómico de cursores. Se ejecutaron con PostgreSQL/PGlite, DOM y Auth simulados; no constituyen pruebas de carga ni un pentest.

La migración comercial pasó pruebas repetibles en PostgreSQL/PGlite: intento anónimo, rol falso en metadatos, escritura directa a tablas comerciales, aprobación sin MFA, vigencia pendiente/vencida/suspendida, lectura entre usuarios, enlaces financieros cruzados, campos inválidos, cupos y reintentos. La suite financiera sigue pasando. La verificación estructural de Supabase confirmó RLS comercial, ausencia de escritura directa de rol/plan, prohibición de RPC administrativo anónimo y cuatro políticas restrictivas de planes.

La instalación base conserva modo piloto; `commercial-enforce.sql` activa el control por decisión del titular. En este proyecto se aplicó y verificó `enforcement=true` el 07/10/2026 por petición del titular. El registro de una cuenta verificada nunca concede un plan. El proveedor Google y los retornos se verificaron en Supabase el 09/10/2026; esta versión habilita el botón. Falta comprobar el ingreso completo y el retorno con una cuenta real. La suite aislada sustituye el proveedor Auth por claims de prueba: valida las reglas SQL, pero no el envío del correo ni el proceso real de MFA.

La integración del cliente incluye comprobaciones en un DOM sintético: acceso pendiente y vencido bloquean registros, acceso activo permite gastos/ingresos, se conservan exportaciones y la demostración no transmite decisiones administrativas. Estas pruebas usan Auth/API simulados, no dos cuentas reales en producción.

## Pendientes antes de aceptar clientes de pago

| Prioridad | Trabajo pendiente                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Alta      | Verificar la cuenta autorizada del titular, configurar/verificar MFA y revisar usuarios actuales.           |
| Alta      | Prueba completa de Google real; SMTP para correo alternativo, protección contra abuso y revisión de límites de Auth.                     |
| Alta      | Aviso de privacidad y condiciones con responsable identificado, soporte, cancelación y retención.                                   |
| Alta      | Prueba real de dos cuentas, dos dispositivos, pérdida de conexión y eliminación de cuenta descartable.                              |
| Alta      | Respaldo de la base y restauración ensayada fuera de producción; el JSON individual no reemplaza un respaldo del servicio completo. |
| Media     | Evaluación independiente, pruebas de carga representativas y alertas de incidentes/consumo.                                         |
| Media     | Migrar fotos a almacenamiento privado antes de aumentar el volumen; la sincronización incremental está implementada.                                    |

## Escalabilidad y límites honestos

PostgreSQL, índices por usuario y servicios administrados permiten crecer por etapas, pero **no se ha medido una cifra de clientes concurrentes**. La sincronización incremental usa versiones del servidor y cursores por cuenta/dispositivo; descarga el historial inicialmente y después solo filas cambiadas, incluidas fotos si cambió el gasto. El servidor filtra por usuario y limita cada página. Los cursores y registros se guardan en una transacción local. Las fotos continúan dentro de la tabla y deben migrarse a almacenamiento privado para crecer. Esta implementación reduce transferencia, pero todavía puede encarecerse con volumen. Los precios no deben prometer uso ilimitado. Los 5,000 registros son un límite funcional, no una garantía de capacidad de la infraestructura gratuita.

Una revisión de acceso a la aplicación no cubre vulnerabilidades del proveedor, DoS sobre APIs directas, robo de un dispositivo o cuenta de correo, ni cambios futuros en dependencias. Las copias locales en IndexedDB permanecen en el perfil del navegador y no están cifradas con una clave exclusiva del usuario; conviene usar perfiles propios y bloquear el dispositivo. La suspensión en la nube no puede revocar copias que el cliente ya descargó ni impedir que copie código público para usarlo localmente. El producto comercial vende acceso al servicio, sincronización y soporte, no secreto del frontend.

Referencias primarias: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [funciones seguras](https://supabase.com/docs/guides/database/functions), [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [producción](https://supabase.com/docs/guides/deployment/going-into-prod), [headers de Cloudflare](https://developers.cloudflare.com/workers/static-assets/headers/).

La autorización de administrador puede reservarse para un correo inexistente: el servidor exige verificar ese correo, consume la autorización una sola vez y mantiene MFA obligatorio para gestionar clientes. No acepta un email/rol enviado por el navegador como prueba de identidad. El acceso por código es opcional hasta configurar las plantillas SMTP; los códigos no se persisten ni se registran. Ver SMTP.md.

OAuth usa PKCE en el SDK oficial con retorno al mismo origen y permisos básicos de identidad. Se eliminan códigos/errores del URL después de inicializar Auth y el service worker no almacena respuestas de callback. Client Secret se introduce exclusivamente en Supabase; Google no concede permisos administrativos ni confirma pagos.


