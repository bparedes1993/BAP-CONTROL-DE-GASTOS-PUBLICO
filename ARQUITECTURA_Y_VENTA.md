# Ruta de producto BAP: Gastos, Legal y Contable

Estado al 26/09/2026: BAP Gastos es un piloto público, con sincronización y exportaciones. No hay pagos activos ni planes de suscripción implementados. BAP Legal y BAP Contable se diseñan como productos separados; este documento no afirma que estén desplegados.

## Una identidad de marca, datos separados

| Producto | Forma inicial recomendada | Datos y aislamiento |
| --- | --- | --- |
| BAP Gastos | Web adaptable e instalable en celular y computadora | Proyecto actual de Supabase, gastos aislados por `user_id` y políticas RLS. |
| BAP Legal | Web privada adaptable; escritorio instalable después si se justifica | Proyecto de Supabase independiente para expedientes y archivos, con permisos por estudio, cliente y expediente. No reutilizar el proyecto de Gastos. |
| BAP Contable | Web privada adaptable; escritorio instalable después si se justifica | Proyecto propio cuando exista capacidad; separar empresas, periodos, asientos y documentos mediante organización y RLS. No subir documentos contables al proyecto de Gastos o Legal. |

Una aplicación de escritorio con sincronización sigue necesitando un servicio en línea para compartir cambios. Puede empaquetarse la web como PWA o instalador cuando los flujos estén probados; conviene validar primero trabajo simultáneo, respaldo y permisos en navegador. El uso sin conexión exige resolución de conflictos y reglas para documentos que se modifican a la vez.

El plan gratuito de Supabase limita el número de proyectos activos en la organización actual. Gastos y Legal ya ocupan los disponibles. Para Contable, no mezclar bases para sortear ese límite: posponer su nube, contratar capacidad cuando haya ingresos o usar una infraestructura separada con una revisión operativa de seguridad y respaldos.

## Venta de Gastos: fases que no generan cobro por adelantado

1. **Piloto cerrado:** usar la dirección `workers.dev`, usuarios de prueba autorizados en Supabase Auth, respaldo JSON, PDF/Excel y pruebas reales en dos dispositivos. Medir entregabilidad de enlaces, tamaño de imágenes y cuotas. No anunciar sincronización instantánea garantizada; existe reintento cada 30 segundos.
2. **Preventa:** definir responsable del tratamiento de datos, aviso de privacidad, términos, soporte y política de retención; habilitar correo de acceso con SMTP de producción y un remitente verificable. Valorar un dominio propio cuando haya clientes. No prometer precio fijo de infraestructura sin revisar cuotas y consumo.
3. **Suscripciones:** elegir precios, periodo, comprobantes e impuestos aplicables con asesoría contable. Crear una tabla de suscripciones solo después de definir reglas. Validar cuotas y permisos mediante funciones o políticas en el servidor. La interfaz pública no puede ser la única autoridad para desbloquear un plan. Integrar un proveedor de cobro cuando exista demanda comprobada.
4. **Escala:** probar restauración de respaldos, monitorear fallos de acceso y sincronización, revisar políticas RLS y límites de almacenamiento. Separar entornos de prueba y producción antes de incorporar clientes de Legal o Contable.

## Criterios de salida del piloto

- Alta y acceso por enlace entregados a direcciones externas con SMTP propio.
- Cambio, edición y borrado de un gasto comprobados en dos dispositivos y tras perder conexión.
- Eliminación de **cuenta descartable de prueba** comprobada de extremo a extremo: usuario ya no entra, gastos propios borrados, otros usuarios intactos. Nunca usar la cuenta personal real para esta prueba.
- Aviso legal y contacto del responsable completos antes de cobrar.
- Condiciones y límites del plan reflejados en backend y en la oferta comercial.

No almacenar claves administrativas, `service_role`, secretos de cobro ni credenciales SMTP en `config.js`, GitHub o el navegador.
