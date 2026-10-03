# BAP Finanzas: ingresos, deudas y distribución del dinero

Versión del 03/10/2026. El módulo se integra en BAP Gastos, usa el mismo inicio de sesión y conserva los gastos anteriores.

## Empezar en la web

1. Iniciar sesión y abrir **Mis finanzas**.
2. En **Ingresos**, registrar solo dinero ganado y efectivamente cobrado. Los préstamos recibidos no son ingresos ganados.
3. En **Tarjetas y deudas**, agregar cada obligación: alias, tipo, saldo base, fecha base, cuota o mínimo, próximo vencimiento, TEA y, para tarjetas, línea y día de corte. Las tasas y cuotas desconocidas deben quedar vacías, no en cero.
4. En **Por cobrar**, agregar préstamos otorgados. El saldo pendiente de cobro no es dinero disponible.
5. Registrar pagos/cobros con importe total y parte aplicada a capital. La diferencia es interés o cargos. Si se desconoce el capital, dejarlo vacío: el efectivo se registra, pero la deuda no se reduce todavía.
6. En cada gasto pagado con crédito, elegir la tarjeta en **Origen del pago**. El gasto aumenta esa deuda y no reduce efectivo hasta registrar su pago. Los gastos anteriores que dicen «Tarjeta» se siguen tratando como pagos de efectivo/débito hasta clasificarlos explícitamente.
7. En **Mi plan → Ajustar presupuesto**, indicar gastos por efectivo/débito, reserva mensual, fondo de emergencia actual, meta de meses y porcentaje de excedente para deuda. El ingreso mensual esperado es opcional: es un escenario, no dinero cobrado.

## Saldo base y conciliación

El saldo base representa lo pendiente **antes de los movimientos de la fecha base**. Se suman compras vinculadas, desembolsos y cargos desde esa fecha, inclusive, y se restan pagos de capital. La apertura de una deuda no crea un movimiento de efectivo. Para un préstamo nuevo, puede abrirse con saldo cero y después registrar su desembolso. Para una deuda existente, registrar su saldo inicial sin inventar una entrada de dinero.

No duplicar una compra en el saldo base y en los movimientos posteriores. Para conciliar con un estado de cuenta, elegir un saldo y una fecha consistentes con los movimientos que se conservan. El saldo se calcula a la fecha actual; cambiar el período filtra ingresos y movimientos del mes, no reconstruye un balance bancario histórico. Los registros futuros no se consideran efectivo realizado. El vencimiento y el mínimo deben actualizarse al recibir cada estado de cuenta; las fechas no se avanzan automáticamente.

## Reglas del plan

- Base: ingreso mensual esperado, si se ingresó, o ingresos cobrados del mes; incluye intereses cobrados con desglose. No se suman préstamos recibidos ni capital por cobrar para proponer ahorro.
- Gastos: el mayor entre efectivo/débito registrado y presupuesto de efectivo/débito del mes.
- Se descuentan pagos de deuda registrados, mínimos/cuotas aún pendientes y desembolsos de dinero prestado del mes.
- Si existe déficit, no se propone ahorro ni abono adicional. Se muestran acciones para revisar gastos y consultar condiciones con acreedores.
- Si falta presupuesto, cuota, mínimo o desglose de capital pendiente de una deuda activa, se bloquea la distribución adicional. Si falta TEA y se eligió avalancha, también se bloquean abonos adicionales; se pueden completar las tasas o elegir bola de nieve para ordenar por saldo. Si faltan vencimientos, se indica que no se pueden revisar todos los atrasos.
- La reserva mensual es la indicada por el usuario, limitada al excedente disponible. El remanente se divide según el porcentaje editable para abonos adicionales; los abonos no superan el saldo pendiente. El resto se muestra como ahorro/metas.
- Avalancha ordena por TEA conocida, considerando primero atrasos; bola de nieve ordena por saldo. Son criterios orientativos: no comparan comisiones, distintas tasas por consumo, penalidades ni condiciones especiales.
- La proyección de una deuda convierte la TEA a tasa efectiva mensual y supone cuota fija, abono extra fijo, sin compras nuevas ni comisiones. No usa TCEA como tasa de amortización. No es una fecha garantizada ni un cronograma del banco.
- La meta de reserva inicial de tres meses y el 80% de excedente destinado a deuda son valores editables de planificación, no reglas universales. El panel no selecciona inversiones, no ejecuta pagos ni promete rentabilidad.

## Sincronización y privacidad

`finance.sql` agrega `expenses.credit_id` y la tabla `finance_entries`. Cada fila se protege por `user_id` con RLS; `anon` no tiene acceso. El usuario autenticado solo lee y escribe sus filas. Se conservan registros de borrado para no recuperar información eliminada desde un equipo sin conexión. La sincronización reintenta cada 30 segundos, al recuperar conexión y al volver a la pestaña; eventos Realtime disparan nuevas consultas.

La eliminación de la cuenta en la nube borra los registros de ambas tablas por la FK `ON DELETE CASCADE`. La aplicación intenta limpiar ambas bases locales del dispositivo actual. Otros dispositivos y archivos descargados requieren limpieza propia. Usar un perfil de navegador separado por persona.

## Exportaciones

- **Plan PDF** abre el reporte imprimible con distribución, guía, supuestos y deudas; elegir Guardar como PDF.
- **Finanzas Excel** exporta ingresos y movimientos del período, junto con saldos base de las cuentas. No es un estado de cuenta bancario ni un cronograma.
- **Respaldo financiero** guarda toda la información financiera de la cuenta, incluyendo registros de borrado. Es independiente del respaldo de gastos/fotografías. Descargar ambos para un respaldo completo y restaurar ambos para recuperar vinculaciones de crédito.

## Demostración y pruebas

`?demo=1#finanzas` activa un espacio de ejemplo con datos ficticios en bases locales separadas. No inicia sesión ni envía datos a Supabase. Los ejemplos no se agregan a la cuenta real.

`node finance-model.test.js` verifica que no se dupliquen compras y pagos, que préstamos no inflen ingresos, que los cobros distingan capital/interés, que déficit/datos faltantes impidan asignaciones indebidas y que las proyecciones y validaciones respondan correctamente.

Referencias educativas: https://www.sbs.gob.pe/usuarios/aprende-con-la-sbs/aprende-sobre-creditos y https://www.sbs.gob.pe/usuarios/aprende-con-la-sbs/el-sobrendeudamiento.
