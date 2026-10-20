# Soles, dólares y cobros de planes

Actualización 20/10/2026. Los registros financieros y gastos admiten PEN y USD. El selector **Moneda** del encabezado cambia los resúmenes, presupuesto y PDF; los importes de ambas monedas nunca se suman ni se convierten automáticamente. Excel financiero incluye una columna Moneda para cada fila y cuota. Los respaldos JSON conservan ambas monedas.

## Registrar dólares

1. En Tarjetas y deudas o Por cobrar, agregar la cuenta y elegir **Dólares · USD** en Moneda del registro. Los registros antiguos sin moneda se interpretan como soles.
2. Registrar saldo, cuota, mínimo, presupuesto y cronograma en esa misma moneda. Para tarjetas con dos líneas monetarias, crear una cuenta PEN y otra USD, identificadas por alias, sin números completos de tarjeta ni CVV.
3. El formulario de pago, cobro o desembolso propone la moneda de su cuenta. Un importe en otra moneda se rechaza: ingresar el importe que el banco aplicó en la moneda de la deuda, después de verificar el comprobante. BAP no calcula un tipo de cambio ni realiza el pago.
4. Usar Moneda del encabezado para consultar cada presupuesto. Un ingreso USD no aumenta el excedente PEN. La moneda de un registro guardado se conserva para evitar reinterpretar saldos e históricos.
5. Al registrar un gasto con tarjeta, elegir primero la moneda del gasto: solo se ofrecen tarjetas compatibles. El OCR propone fecha, comercio y monto; confirmar manualmente la moneda.

## Configurar Yape, Plin o transferencia

Los medios comienzan **desactivados y sin números, cuentas ni QR**. La aplicación no copia el número de soporte a un medio de cobro.

1. El titular entra con su cuenta administrativa, verifica MFA y abre **Administración → Configurar medios de cobro**.
2. En Yape o Plin, completa el titular y el número de celular de nueve dígitos, o carga el QR; puedes completar ambos. En transferencia, indica banco y cuenta o CCI de 20 dígitos. Estos medios corresponden al precio del plan **en soles**.
3. El QR admite PNG/JPG/WebP de hasta 2 MB. BAP lo redimensiona en el navegador y lo guarda como PNG de tamaño limitado; se excluyen SVG, direcciones externas y contenido ejecutable. La imagen debe estar recortada y legible. Esta validación técnica no certifica el destinatario ni el monto codificado: compruébalos con la aplicación de pagos antes de ofrecerlo.
4. Marca Mostrar a clientes y pulsa Guardar en ese medio. No se activa un destino incompleto. Si otra sesión lo modificó, recarga la configuración para no sobrescribir su cambio.

Los clientes verificados ven solo los medios activados, el titular, número o cuenta y el QR cuando existe. Eligen un método al solicitar el plan y pueden indicar la referencia de una operación realizada. BAP guarda método, revisión de datos de cobro, referencia y precio del plan al solicitar; el estado permanece pendiente. Una referencia o un QR **no certifican la recepción**. El administrador comprueba el abono en su cuenta y registra la aprobación desde Gestionar acceso. La web no abre cuentas financieras, transfiere dinero, carga tarjetas ni crea suscripciones automáticas.

## Base de datos y validación

En una instalación existente, aplicar **`currencies-installments.sql` y después `payment-methods.sql`** al final de las migraciones actuales. Son idempotentes, conservan saldos, planes, vigencias y pagos y no asignan roles. Si se reaplican `commercial.sql` o `commercial-onboarding.sql`, reaplicar estas dos migraciones al final.

La primera añade moneda PEN predeterminada a gastos y valida las monedas y enlaces de los registros financieros y cronogramas. Admite un presupuesto por usuario/moneda. La segunda guarda destinos de cobro con RLS y sin acceso directo para anon/authenticated; las RPC exigen usuario verificado para consultar destinos activos, y rol administrativo con `aal2` para modificarlos. La solicitud no concede permisos de escritura ni puede registrar un pago confirmado. Las protecciones de propietario, cuotas de registros y planes vigentes siguen activas.

La sincronización de finanzas envía cuentas antes de cronogramas y pagos. Al restaurar un respaldo completo, restaurar finanzas para recuperar las cuentas y luego gastos: los cronogramas que dependen de compras se reintentan tras sincronizar esas compras. No borrar la copia local mientras haya cambios pendientes.

## Estado de publicación

El 20/10/2026 se aplicaron ambas migraciones en el proyecto de Gastos. La revisión estructural confirmó moneda en gastos, las cuatro políticas restrictivas de planes y control obligatorio activo. La tabla de cobros tiene RLS y no permite lectura/escritura directa de clientes; su consulta anónima está denegada. Los tres medios se inicializaron desactivados. No se registraron clientes, depósitos ni destinos de cobro de prueba en producción.

## Pruebas

`npm ci` y `npm test`: cálculo financiero, cuotas, monedas, permisos comerciales, registro, sincronización, checkout y formularios con Auth/API simulados. PostgreSQL aislado comprueba rechazo de monedas cruzadas, presupuestos duplicados, cronogramas duplicados o alterados con pagos, solicitudes inválidas, edición de medios sin MFA, revisiones antiguas y QR externos/SVG. No modifica clientes ni simula pagos en producción. La recepción real de Yape/Plin/transferencia y la lectura del QR deben comprobarse con los datos configurados por el titular.
