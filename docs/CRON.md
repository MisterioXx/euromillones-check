# Comprobación diaria compartida

`GET /api/cron` ejecuta comprobaciones de las copias compartidas que tienen activado `background_enabled` después de migrar sus datos. No lee el almacenamiento local del navegador ni crea copias compartidas automáticamente.

## Programación y acceso

`vercel.json` programa una ejecución diaria a las 04:00 UTC, con funciones en `fra1` y `maxDuration: 60`. En Madrid corresponde a las 05:00 en invierno y las 06:00 en verano. Vercel programa los cron en el despliegue de producción; una preview no activa esta programación. En Hobby la invocación puede producirse durante la hora programada, sin precisión de minuto. [Documentación de Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [límites de cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Requiere `DATABASE_URL` y `CRON_SECRET` en el entorno del despliegue. El secreto debe ser aleatorio y tener al menos 16 caracteres; se recomienda generar 32 bytes. Vercel envía `Authorization: Bearer <CRON_SECRET>`. La ruta verifica el valor con `timingSafeEqual` sobre hashes de tamaño fijo. No acepta cookies de usuario como sustituto del secreto.

Solo admite GET. Responde 405 a otros métodos, 401 a credenciales ausentes/incorrectas y 503 si no puede acceder al almacenamiento. Ninguna respuesta se almacena en caché. No devuelve estados, identidades, saldos, tokens ni datos de conexión.

## Concurrencia y persistencia

Cada ejecución dispone de un presupuesto de 45 segundos. Deja de consultar fuentes a los 30 segundos, limita el guardado al segundo 40 y reserva los últimos 5 segundos para liberar reservas. Las peticiones externas en curso se cancelan al acabar su presupuesto. El límite de plataforma de 60 segundos deja margen para la finalización del runtime.

Se seleccionan como máximo 50 copias compartidas, priorizando las menos recientemente comprobadas. Cada copia compartida obtiene una reserva atómica con un token aleatorio y caducidad de 120 segundos. Otra ejecución no puede adquirir una reserva vigente. La liberación exige el mismo token, por lo que una ejecución antigua no puede liberar la reserva de otra.

Cada lote procesa hasta 12 sorteos pendientes con `checkStateBatch`, compartiendo las reglas de conciliación de la interfaz. Un fallo de fuente se registra en Logs y no bloquea los otros sorteos. Los premios sin cuantía fiable siguen pendientes. Se acepta el escrutinio de SELAE o el contraste completo de Lotería Angelita y ComprobarEuromillones, con sus dos enlaces. Los importes confirmados actualizan el sorteo existente, sin crear ingresos duplicados.

Una sola publicación de ComprobarEuromillones o RTVE puede confirmar la combinación si identifica la fecha exacta y contiene cinco números y dos estrellas válidos y únicos. Esa combinación permite cerrar la comprobación sin premio cuando no hay aciertos premiados. Nunca autoriza un abono nuevo ni retirar un premio ya registrado; los aciertos premiados sin cuota contrastada y las discrepancias con importes previos permanecen en `awaiting-prize`.

Las peticiones a cada publicación de contraste se espacian un segundo y se serializan. Un 429 pone ese origen en pausa respetando `Retry-After`, o 60 segundos si no es válido, sin reintento inmediato. Las esperas respetan la cancelación al llegar al presupuesto de consulta. Otras fuentes y resultados en caché siguen disponibles; si no se completa la verificación, el sorteo queda pendiente. La pausa es local a la instancia y no coordina otras réplicas del servicio.

`saveWorkspaceFromCron(id, state, revision, { leaseToken, checkedAt, deadline })` guarda estado y `last_checked_at` en una transacción. Comprueba la revisión esperada, la reserva vigente y que la automatización continúe activada. Si una persona editó mientras se consultaban resultados, se rechaza el guardado por conflicto: se conservan sus cambios y los pendientes se podrán reintentar. Las consultas SQL quedan acotadas al plazo restante. Si no hay pendientes, solo cambia `last_checked_at`, sin crear una revisión innecesaria.

## Respuesta y seguimiento

Una ejecución completada devuelve exclusivamente contadores:

- `workspacesChecked`: copias compartidas cuya comprobación y metadatos se guardaron.
- `workspacesUpdated`: copias compartidas con un lote guardado en una nueva revisión.
- `workspacesSkipped`: copias compartidas cuya reserva no se obtuvo.
- `workspacesFailed`: copias compartidas con un fallo interno o de almacenamiento.
- `conflicts`: guardados rechazados por revisión o reserva concurrente.
- `drawsAttempted`, `drawsFailed`: consultas realizadas y fallidas, aunque un conflicto posterior impida guardarlas.
- `drawsRemaining`: pendientes de las copias compartidas procesadas; no es un recuento global de toda la base.
- `deadlineReached`: 1 si se agotó un presupuesto, 0 en caso contrario.

Los fallos de escritura no se pueden añadir a Logs cuando la base no está disponible; el runtime registra un aviso genérico sin información privada. Las reservas pendientes caducan por sí solas. No se ejecutan migraciones SQL ni se despliega producción desde esta ruta.

Las pruebas de `tests/cron.test.ts` usan almacenamiento simulado y fuentes simuladas. No ejecutan esta tarea contra datos reales.
