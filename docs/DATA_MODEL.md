# Modelo de datos

El contrato de datos vive en `src/types.ts`. La aplicación utiliza `AppState.version = 2`; `src/lib/validation.ts` valida las copias locales, las importaciones y los estados que recibe el servidor. Admite las versiones 1 y 2 y devuelve una copia normalizada de la versión 2, sin modificar el objeto recibido.

## Estado de la peña

`AppState` contiene:

- `config`: periodo, jugada fija, coste y líneas por defecto, y comprobación al abrir.
- `participants`: participantes y aportaciones ordinarias y extra.
- `draws`: sorteos previstos para martes y viernes, su apuesta, sus resultados y sus importes registrados.
- `movements`: ajustes manuales de caja con fecha, descripción, importe con signo y categoría.
- `logs`: comprobaciones, errores, avisos y cambios registrados. La migración no elimina los logs existentes.

Los identificadores de cada colección deben ser únicos. Solo puede existir un registro de sorteo por fecha. Las fechas son fechas reales con formato `AAAA-MM-DD`; las fechas de eventos son marcas de tiempo ISO. Las combinaciones requieren cinco números enteros diferentes entre 1 y 50 y dos estrellas enteras diferentes entre 1 y 12. Los importes deben ser finitos y tener como máximo dos decimales.

## Sorteos, apuestas y procedencia

Cada `DrawEntry` conserva los campos de la versión 1: fecha, apuesta automática (`played`), líneas, coste unitario, premio bruto, gastos y notas. Añade:

| Campo | Uso |
| --- | --- |
| `betNumbers`, `betStars` | Copia de la jugada correspondiente a ese sorteo. Un cambio de configuración no debe reescribir el histórico. |
| `winningNumbers`, `winningStars` | Combinación ganadora comprobada. |
| `prizeSource` | `manual`, `imported` o `automatic`: procedencia del importe registrado. |
| `resultSource` | URL de la fuente del resultado aceptado. |
| `resultSummary` | Categoría y aciertos calculados. Se mantiene separado de las notas del usuario. |
| `checkedAt` | Momento de la última comprobación válida de la combinación. |
| `lastAttemptAt` | Momento del último intento, aunque haya fallado. |
| `checkError` | Incidencia o discrepancia pendiente de revisión. |

Estados persistidos:

| Estado | Significado |
| --- | --- |
| `pending` | Sin comprobar. La interfaz distingue los sorteos futuros o pendientes de publicación. |
| `checked` | Resultado aplicado automáticamente, con importe confirmado o sin premio. |
| `manual` | Registro revisado o introducido manualmente; su importe está protegido. |
| `awaiting-prize` | Falta un importe fiable, existe una discrepancia con un importe protegido o hay varias líneas que necesitan revisión. |
| `error` | El último intento falló; puede reintentarse. Los datos e importes previos se conservan. |

La comprobación considera vencidos los sorteos anteriores a hoy y los del día actual a partir de las 22:00 en `Europe/Madrid`. Este umbral permite intentar una consulta: no garantiza que la fuente ya haya publicado el escrutinio. Las fechas de calendario se calculan en UTC para evitar desplazamientos según el dispositivo; el reloj de publicación utiliza Madrid, incluido el cambio de hora.

## Premios y conciliación

`src/lib/reconciliation.ts` contiene `applyCheckResult`, la misma transición de estado que utilizan la interfaz y las comprobaciones programadas:

1. Exige la fecha exacta del sorteo y valida la combinación ganadora y la apuesta guardada.
2. Calcula aciertos y categoría con `countMatches` y `categoryLabel`, en `src/lib/domain.ts`.
3. Solo aplica un premio nuevo si la API declara `prizesVerified: true` y la categoría tiene un importe positivo válido. Los importes directos deben identificar su categoría. Una combinación sin premio puede comprobarse sin tabla de importes.
4. La fuente prioritaria es el escrutinio exacto de SELAE. Si no está disponible, la API solo marca las cuotas como verificadas cuando Lotería Angelita y ComprobarEuromillones coinciden en la fecha, combinación y las 13 categorías de premios para España. La procedencia se muestra como dos publicaciones contrastadas, sin presentarlas como fuente oficial. Una discrepancia impide el abono automático. RTVE puede confirmar combinaciones, pero sus cuotas no se abonan: se han observado céntimos truncados en su widget.
5. Con `lines !== 1`, conserva el importe y requiere revisión: el modelo no representa varias combinaciones distintas ni permite deducir automáticamente cuánto corresponde.
6. Los importes manuales o importados no se sobrescriben ante una discrepancia. Se muestra el importe recibido y el ya registrado para que el usuario los revise.
7. Conserva las notas del usuario, registra la fuente y los fallos y mantiene un único importe por sorteo. Repetir una comprobación no crea un segundo ingreso.

`getPendingDraws` selecciona sorteos jugados, vencidos y en estado `pending`, `awaiting-prize` o `error`. Los registros manuales históricos se conservan; su revisión adicional debe solicitarse expresamente.

**Un sorteo pendiente de verificar puede mantener un premio ya registrado.** Ese importe continúa formando parte del saldo hasta que el usuario lo corrija. La aplicación no suma importes estimados nuevos ni retira silenciosamente una cantidad histórica por una consulta incompleta.

## Cálculos de caja

Los JSON siguen expresando los importes en euros por compatibilidad. `src/lib/domain.ts` convierte a céntimos enteros antes de calcular y vuelve a euros al devolver los totales:

- Gasto de sorteo: `played ? lines × costPerLine : 0`.
- Premio neto: `max(0, grossPrize − expenses)`.
- Total aportado: suma de las aportaciones ordinarias y extra de los participantes.
- Saldo actual: aportado + premios netos hasta hoy + ajustes hasta hoy − gasto de sorteos hasta hoy.
- Saldo previsto: aportado + todos los premios registrados + todos los ajustes − coste de todos los sorteos planificados.

Se mantiene la regla existente de gastos asociados al premio: no generan un premio neto negativo. Los gastos efectivos ajenos al premio deben registrarse como movimientos negativos de caja. Cambiar esta regla requiere una decisión explícita para evitar alterar saldos anteriores.

`renewPeriod(state, endDate)` amplía el calendario sin borrar ni modificar registros anteriores y sin sumar aportaciones nuevas. Añade los martes y viernes que faltan, con la configuración actual. La revisión de aportaciones para otro periodo es independiente.

## Persistencia local y migración v1 → v2

`src/lib/storage.ts` guarda la versión 2 en `euromillones-control:v2`. Nunca sobrescribe ni elimina la clave original `euromillones-control:v1`.

Antes de migrar o importar se conserva una copia local. La migración:

- Conserva importes, notas, movimientos, participantes y logs.
- No marca sorteos como revisados por un corte de fecha.
- Guarda la combinación disponible como referencia de los sorteos antiguos que no tenían apuesta propia; un cambio histórico de jugada que nunca se registró deberá revisarse manualmente.
- Convierte antiguos `checked` con «importe pendiente» en `awaiting-prize`.
- Conserva el dinero de premios antiguos `checked` sin procedencia fiable y los marca `awaiting-prize` con origen `imported`. Si el escrutinio exacto difiere, exige revisión y no cambia automáticamente el saldo.

Un JSON corrupto, esquema inválido o fallo al crear el backup bloquea el guardado para proteger el original. La pantalla de recuperación permite descargar ese contenido y revisar una copia válida antes de importarla. No se sustituye silenciosamente por datos iniciales.

`listLocalBackups`, `readLocalBackup` y `exportLocalBackup` permiten enumerar, previsualizar y descargar las copias previas y el original v1. Estas operaciones no restauran ni escriben datos. `importState` valida y conserva la copia anterior antes de aplicar la importación confirmada.

El almacenamiento local sigue siendo propio de cada navegador y origen. Antes de migrar a la copia compartida se debe elegir y revisar una copia canónica; un preview de Vercel no puede leer el almacenamiento del dominio de producción.

## Persistencia compartida

El modo compartido utiliza Postgres y Better Auth. Las tablas de negocio están definidas en `db/schema.sql`:

| Tabla | Responsabilidad |
| --- | --- |
| `ec_workspaces` | Estado JSON de la peña, propietario, revisión, configuración de comprobación programada y marcas de tiempo. |
| `ec_members` | Membresía: cada cuenta pertenece como máximo a una peña. |
| `ec_snapshots` | Copias anteriores, revisión, actor, motivo y fecha. La importación inicial se conserva y se retienen las 30 copias previas más recientes. |
| `ec_invites` | Hash de una invitación de un solo uso, con caducidad de siete días. |

Las tablas de cuentas, sesiones y límites de acceso las gestiona Better Auth mediante su migración. Las sesiones autentican al usuario y todas las lecturas, descargas y escrituras de la peña comprueban su membresía. Solo el propietario puede crear invitaciones y activar o desactivar la comprobación programada. Los miembros pueden trabajar sobre la misma copia de la peña.

La importación inicial requiere confirmación expresa y guarda el original validado, además del estado de trabajo normalizado. No puede crear una segunda peña para una cuenta que ya pertenece a una.

### Revisiones, copias y concurrencia

La revisión compartida se transmite fuera de `AppState`; no contamina el formato de exportación local. Cada escritura exige la revisión que el cliente leyó. Dentro de una transacción se bloquea la fila, se comprueba la membresía y la revisión, se guarda una copia previa y se incrementa la revisión. Si otro dispositivo o el cron ha cambiado el estado, la API responde `409` y no sobrescribe los datos. La interfaz conserva la copia local para revisar el conflicto.

El guardado, las invitaciones y los cambios de programación también envían `workspaceId`; crear o unirse a una peña envía `expectedUserId`. La API contrasta esos valores con la sesión autenticada. Así, un cambio de cuenta en otra pestaña no puede trasladar el estado de la peña anterior a la nueva, aunque ambas tengan la misma revisión. La actualización automática de la interfaz se detiene si cambia la identidad de la peña.

- `GET /api/cloud?action=backups`: lista metadatos de copias accesibles para la membresía autenticada.
- `GET /api/cloud?action=backup&id=…`: devuelve una copia validada de esa peña para descargarla o revisarla. No la restaura.

El cron utiliza una entrada separada, `saveWorkspaceFromCron`, y una concesión temporal (`lease_token`, `lease_until`). Antes de guardar comprueba, dentro del bloqueo, que la concesión sigue siendo válida, la automatización sigue activada y la revisión no ha cambiado. El estado y `last_checked_at` se guardan en la misma transacción. El plazo restante limita las consultas y el `COMMIT`; un intento caducado revierte la transacción. Un identificador de usuario llamado `cron` nunca concede permisos de programador.
