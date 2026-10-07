# Revisión técnica de seguridad y capacidad

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

La suite completa del 07/10/2026 pasó 109 comprobaciones de acceso comercial, autorización administrativa, sincronización y cliente, además de los escenarios de cálculo financiero. Las pruebas incluyen autorizaciones vencidas/revocadas, consumo de un solo uso, aislamiento entre cuentas, reintentos y guardado atómico de cursores. Se ejecutaron con PostgreSQL/PGlite, DOM y Auth simulados; no constituyen pruebas de carga ni un pentest.

La migración comercial pasó pruebas repetibles en PostgreSQL/PGlite: intento anónimo, rol falso en metadatos, escritura directa a tablas comerciales, aprobación sin MFA, vigencia pendiente/vencida/suspendida, lectura entre usuarios, enlaces financieros cruzados, campos inválidos, cupos y reintentos. La suite financiera sigue pasando. La verificación estructural de Supabase confirmó RLS comercial, ausencia de escritura directa de rol/plan, prohibición de RPC administrativo anónimo y cuatro políticas restrictivas de planes.

La instalación preserva modo piloto (`enforcement=false`) hasta que el titular autorice su rol y active el control. La existencia de reglas no significa que el control obligatorio ya esté activo. La suite aislada sustituye el proveedor Auth por claims de prueba: valida las reglas SQL, pero no el envío del correo ni el proceso real de MFA.

La integración del cliente incluye comprobaciones en un DOM sintético: acceso pendiente y vencido bloquean registros, acceso activo permite gastos/ingresos, se conservan exportaciones y la demostración no transmite decisiones administrativas. Estas pruebas usan Auth/API simulados, no dos cuentas reales en producción.

## Pendientes antes de aceptar clientes de pago

| Prioridad | Trabajo pendiente                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Alta      | Verificar la cuenta autorizada del titular, configurar/verificar MFA y activar el control tras revisar usuarios actuales.           |
| Alta      | SMTP de producción, entrega a correos externos, protección contra abuso de altas y revisión de límites de Auth.                     |
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
