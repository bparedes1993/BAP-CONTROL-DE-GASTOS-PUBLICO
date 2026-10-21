# Recuperación y verificación operativa

## Estado verificable

- Descargas de gastos y finanzas: cifradas con contraseña; JSON antiguo importable.
- Ensayo automatizado aislado: `npm test`. Usa datos sintéticos y bases temporales. Comprueba descifrado, rechazo de contraseña/archivo incorrectos, transacciones abortadas, separación de propietarios y restauración desde la interfaz.
- Copia interna: una versión anterior por cuenta y almacén; permanece en el mismo navegador y puede perderse con él.
- Respaldo completo del servidor y restauración del servicio: **pendientes**, sin acceso confirmado al proveedor. No se ha creado ni restaurado una copia de producción.
- Prueba con dos cuentas y dos dispositivos reales: **pendiente**. Los mocks no sustituyen esta prueba.

## Ensayo de un cliente, con datos sintéticos

1. Abrir `?demo=1#reportes` en un perfil de navegador separado. Confirmar el indicador de demostración.
2. Crear una tarjeta PEN y otra USD, compras antes/después del corte, una compra en cuotas, ingreso y pago parcial. Anotar IDs, cantidades, deuda y disponible por moneda.
3. Descargar ambas copias con una contraseña exclusiva guardada en un gestor. Conservar otra copia cifrada fuera del dispositivo.
4. En otro perfil de demostración restaurar primero finanzas y después gastos, revisando las confirmaciones. Comparar cantidades, vínculos, cronogramas y saldos; comprobar que las compras no duplican deuda.
5. Probar contraseña incorrecta y archivo alterado. Deben rechazarse sin cambios. Cancelar un diálogo y comprobar que no descarga ni importa nada.
6. Restaurar una copia válida sobre datos existentes y descargar la copia previa. Verificar que pertenece únicamente al propietario actual.

## Respaldo completo del servicio: operación del titular

Antes de cualquier ensayo, identificar el proyecto correcto de Supabase, responsable, plan, retención disponible, última copia exitosa y cobertura de base, Auth, archivos y configuración. Registrar fechas y evidencia sin contraseñas, tokens ni datos personales. No pegar credenciales en el chat ni subir volcados al repositorio público.

Preparar un entorno de recuperación privado y separado, sin tráfico real ni envío de correos/pagos. Obtener una copia por el mecanismo admitido por el proveedor y almacenarla cifrada fuera del proyecto original. Registrar hash, fecha, versión y custodia de la clave. Documentar por separado recursos que el respaldo no incluya.

Restaurar exclusivamente en el entorno aislado. Verificar recuentos por tabla, relaciones, RLS, funciones, índices, acceso del propietario, bloqueo entre cuentas, administrador con MFA, compras/cuotas, saldos PEN/USD y recursos externos. Medir antigüedad de la copia y duración de recuperación. No cambiar DNS ni sustituir producción durante este ensayo.

Aceptar el respaldo solo después de recuperar y comprobar datos. Definir con el titular la pérdida máxima de datos y tiempo máximo de recuperación tolerables; ajustar frecuencia y retención a esos objetivos. Repetir tras cambios de esquema y registrar incidencias. Eliminar el entorno de ensayo según la política acordada.

## Dos cuentas y dos dispositivos

Usar dos cuentas descartables autorizadas, con información inventada. Comprobar aislamiento al iniciar/cerrar sesión; segundo dispositivo recibe creación, edición y eliminación; una edición durante sincronización permanece pendiente hasta confirmarse; reconexión no duplica compras/pagos; cuota pagada actualiza advertencias; cronograma eliminado no reaparece; copia/restauración nunca cambia de propietario. Registrar resultados, dispositivo, versión y fecha, sin tokens. No marcar esta lista como ejecutada por pasar las pruebas locales.
