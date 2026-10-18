# Contexto para IA

## Producto y estado de la revisión

EuroControl gestiona aportaciones, sorteos, premios y caja de Euromillones, con saldo actual y previsto. Conserva los datos del Excel original y añade comprobación verificable, copias y conexión compartida opcional.

La revisión actual está autorizada para implementación y **preview**. Publicar o promover a producción requiere aprobación posterior. No interpretar estas notas como confirmación de un despliegue. No modificar datos reales para pruebas; usar cuentas y estados de QA identificables en la base de desarrollo/preview.

## Datos iniciales históricos

- Periodo: `2026-01-27` a `2027-01-26`.
- Participantes: Jose, David C, David T; aportación anual de 120 EUR por persona.
- Coste: 2,50 EUR por sorteo; jugada `7,14,17,25,33` y estrellas `4,7`.
- Premio importado: 3,94 EUR el `2026-03-17`.

Estos valores son la semilla original, no la copia actual del usuario. Las modificaciones de producción residen en su navegador hasta que exporte e importe explícitamente sus datos.

## Arquitectura

- SPA React/Vite/TypeScript. Navegación: Resumen, Sorteos, Caja, Ajustes y Logs; detalle individual de sorteos y favicon propio.
- `src/lib/storage.ts`: persistencia local v2, migración v1, validación, exportación y recuperación. No sobrescribir copias inválidas ni eliminar el original al migrar.
- `src/lib/validation.ts`, `domain.ts`, `reconciliation.ts`: validación, cálculos en céntimos y conciliación compartida por interfaz y servidor.
- `src/server/checkEuromillones.ts`: único comprobador por fecha. Lo usa `/api/check-euromillones` en Vercel y Vite; no depende de datos privados de los usuarios.
- `src/server/checkBatch.ts`: conciliación por lotes que continúa después de fallos individuales.
- Better Auth y PostgreSQL/Neon opcionales: `/api/auth/*`, `/api/cloud`, tablas `ec_workspaces`, `ec_members`, `ec_snapshots`, `ec_invites` y tablas de autenticación. La autorización se comprueba por pertenencia; una sesión no da acceso a otras copias compartidas.
- `src/server/workspaces.ts`: guardados con revisión esperada y transacción. Ante conflicto se conserva la copia local y la compartida para revisión, sin sobrescritura silenciosa. Se mantiene la migración original y las últimas 30 copias previas a cambios.
- `/api/cron`: secreto exclusivo, reserva temporal por copia compartida y guardado condicionado por revisión, token vigente y automatización activada. Presupuesto 45 segundos, lotes de 12; véase [CRON](CRON.md).

## Migración y entornos

Mantener separadas las bases de desarrollo/preview y producción. El acceso compartido se activa después de revisar y confirmar la copia local; iniciar sesión por sí solo no debe subirla ni sustituirla.

Para probar datos reales en una preview, el usuario exporta JSON desde producción e importa explícitamente en la preview. Los orígenes web no comparten `localStorage`. Las cuentas y datos de preview tampoco se promueven automáticamente a producción. La migración SQL (`npm run db:migrate`) prepara el esquema del entorno seleccionado y no importa datos de los usuarios.

Las copias JSON v1 y v2 se aceptan tras validación. La conversión conserva importes, notas, gastos, registros y el original. Como v1 no guardaba una jugada por sorteo, se conserva la configuración disponible como referencia de ese histórico; no se puede reconstruir una combinación antigua desconocida. Ver [DATA_MODEL](DATA_MODEL.md).

## Reglas que no se deben romper

- La apuesta se considera automática: no pedir marcar manualmente cada sorteo como jugado.
- Contar solo los importes registrados. Una combinación publicada no implica que su cuota esté disponible.
- Exigir fecha exacta, números y estrellas válidos y únicos, categoría coherente y cuota fiable antes de abonar un premio automático. No inferir una cuota de un bote ni del importe de otro sorteo.
- SELAE es la fuente preferente de cuotas. Si falla, Lotería Angelita y ComprobarEuromillones deben coincidir en fecha, combinación y tabla completa de 13 categorías, con todos los céntimos. Una sola publicación nunca autoriza un abono. Ambas URLs se conservan y se presentan como contraste de dos publicaciones, sin llamarlo consulta oficial ni asumir independencia empresarial no acreditada.
- RTVE solo confirma combinaciones válidas: su widget ha mostrado importes sin céntimos y se detectó una noticia con combinación de seis números y cuotas de otra fecha. No usar sus importes para contabilizar dinero.
- Una sola publicación de ComprobarEuromillones o RTVE puede confirmar la combinación si identifica la fecha exacta y contiene cinco números y dos estrellas válidos y únicos. Esa combinación permite cerrar la comprobación sin premio cuando no hay aciertos premiados. Nunca autoriza un abono nuevo ni retirar un premio ya registrado; los aciertos premiados sin cuota contrastada y las discrepancias con importes previos permanecen en `awaiting-prize`.
- `providerThrottle.ts` serializa consultas por origen y separa las de cada publicación de contraste al menos un segundo. Respetar `Retry-After` de un 429, con pausa predeterminada de 60 segundos si falta o no es válido; nunca reintentar de inmediato. Las esperas se cancelan con la señal del cron. La limitación es por instancia y no coordina réplicas de Vercel; no sustituye los límites impuestos por el proveedor.
- Conservar premios manuales/importados, movimientos de caja, gastos y notas. Registrar discrepancias para revisión. No multiplicar una cuota por varias apuestas sin conocer sus combinaciones.
- Mantener los premios sin cuota como `awaiting-prize`, disponibles para reintento. Fallos en Logs y en el detalle del sorteo; nunca detener toda una cola por una fecha fallida.
- Conciliación idempotente: actualizar el sorteo existente; reconsultar no añade otro ingreso. Cambiar configuración no reescribe apuestas históricas.
- Sincronizar requiere revisión y autorización explícitas. Los conflictos conservan versiones, nunca se resuelven por una sobrescritura automática.

## Automatización y limitaciones

La comprobación al abrir incluye pendientes históricos y se reevalúa cada 15 minutos con la app visible, al volver a estar en línea o recuperar visibilidad. El cron diario a las 04:00 UTC solo se programa en producción, para copias compartidas con esa opción activada. Una preview no tiene cron programado. Sin conexión compartida, cerrar la aplicación detiene sus comprobaciones.

No se ha implementado restablecimiento de contraseña por correo. Las fuentes de resultados pueden fallar o cambiar su respuesta: mantener límites de tiempo, validación y estados pendientes. Nunca enviar secretos al cliente ni prefijarlos con `VITE_`.

## Verificación

`npm run check` ejecuta tipos, pruebas y build. Las pruebas de resultados usan fixtures oficiales reales y casos alterados; las de cron usan almacenamiento simulado. Las pruebas HTTP de integración deben utilizar datos QA aislados y limpiar únicamente esos datos. Vite y Vercel deben ejecutar las mismas rutas y reglas, sin mantener dos parsers divergentes.
