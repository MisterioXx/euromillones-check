# Vercel: entornos, preview y publicación

Proyecto: `euromillones-check`. Dirección de la aplicación existente: [euromillones-check.vercel.app](https://euromillones-check.vercel.app/).

La revisión actual se prepara para **preview y revisión del usuario**. No publicar ni promover a producción sin su aprobación posterior. Una URL de preview debe verificarse tras el despliegue antes de presentarla como disponible.

## Build y funciones

```bash
npm run check
```

- Build: `npm run build`; salida: `dist`; Node.js 22 o versión compatible con `package.json`.
- `vercel.json` conserva `/api/*` y dirige el resto de rutas a `index.html`.
- Funciones TypeScript en Node, región `fra1`, `maxDuration: 60`.
- `/api/check-euromillones?date=AAAA-MM-DD` devuelve resultados públicos sin datos privados. Usa el mismo módulo que Vite y el cron.
- `/api/auth/*` gestiona cuentas y sesiones; `/api/cloud` valida pertenencia, importación explícita, revisiones e invitaciones; `/api/cron` exige su secreto exclusivo.

`npm run dev` monta las rutas API para desarrollo. `npm run preview` solo sirve el build estático y no es una prueba de las funciones.

## Variables y base de datos

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión PostgreSQL/Neon del entorno correspondiente. |
| `BETTER_AUTH_SECRET` | Secreto aleatorio de autenticación, distinto por entorno. |
| `CRON_SECRET` | Secreto aleatorio del cron; mínimo 16 caracteres, recomendado 32 bytes aleatorios. |
| `APP_ORIGIN` | Origen canónico permitido, sin ruta. En desarrollo: `http://localhost:5173`. |

En Vercel, si no se fija `APP_ORIGIN`, el servidor deriva el origen de `VERCEL_URL` y admite además el alias de rama indicado por `VERCEL_BRANCH_URL`. Producción admite el dominio actual de la aplicación. Si se añade un dominio nuevo, revisar orígenes de autenticación y protección de peticiones; no ampliar a un comodín.

No usar prefijos `VITE_` para secretos. `.env.local` está ignorado por Git. La base de **desarrollo/preview debe estar separada de producción**: no apuntar la preview a la base real ni reutilizar sus credenciales. Las cuentas creadas en preview pertenecen únicamente a ese entorno.

Para preparar el esquema, seleccionar la conexión de desarrollo/preview en `.env.local`, revisar el entorno y ejecutar:

```bash
npm run db:migrate
```

El script prepara las tablas de Better Auth y `db/schema.sql`. No importa datos de usuario y no forma parte del build. Una futura preparación de producción requiere configurar deliberadamente su propia conexión y ejecutar la migración en el alcance aprobado.

Sin `DATABASE_URL` y `BETTER_AUTH_SECRET`, la aplicación mantiene el modo local y la consulta pública de resultados. Para cron se requieren `DATABASE_URL` y `CRON_SECRET`, además de una copia compartida migrada con automatización activada.

## Migración explícita de datos

1. Exportar desde el navegador donde se usa producción. Su JSON contiene los cambios actuales; la semilla del repositorio puede estar desactualizada.
2. Importar y revisar esa copia en la preview: saldo, participantes, sorteos y movimientos. Se aceptan JSON v1/v2 con validación y conservación de una copia previa.
3. Crear una cuenta de preview. En Ajustes, revisar el resumen de la copia y confirmar «Crear copia compartida». Esto inicia la persistencia del estado en la base de preview.
4. Probar acceso desde otra cuenta invitada, exportación, copias y conflictos. Solo compartir códigos con usuarios autorizados para acceder a esos datos.

El navegador no comparte `localStorage` entre producción y preview. Ni iniciar sesión ni desplegar importa automáticamente los originales. La copia compartida guarda el original de la migración y las 30 versiones anteriores de cambios; el usuario mantiene también su JSON descargado.

## Resultados y programación

El comprobador busca resultados históricos por fecha en SELAE y valida combinación y cuotas. Durante la verificación de preview, SELAE respondió HTTP 403 desde Vercel aunque fuera accesible desde desarrollo; el diagnóstico distingue las fuentes y sus errores. No se usan proxies ni cambios de región para eludir ese bloqueo.

Como alternativa, se consultan Lotería Angelita y ComprobarEuromillones. Solo se verifican cuotas si ambas publicaciones coinciden en fecha, combinación y tabla completa de 13 categorías, con céntimos exactos. Se guardan las dos URLs y se identifica el contraste sin presentarlo como consulta directa a SELAE. Una fuente caída, incompleta o discrepante no autoriza el abono. Si solo se confirma una combinación premiada, conserva el estado de importe pendiente. RTVE es una alternativa de combinación, sin abono de sus cuotas. Los errores se muestran en Logs, las correcciones manuales se protegen y los premios se concilian sin duplicarlos.

Una sola publicación de Lotería Angelita, ComprobarEuromillones o RTVE puede confirmar la combinación si identifica la fecha exacta y contiene cinco números y dos estrellas válidos y únicos. Esa combinación permite cerrar la comprobación sin premio cuando no hay aciertos premiados. Nunca autoriza un abono nuevo ni retirar un premio ya registrado; los aciertos premiados sin cuota contrastada y las discrepancias con importes previos permanecen en `awaiting-prize`.

También se observó HTTP 429 al consultar varios sorteos seguidos. El comprobador serializa y espacia un segundo las consultas al mismo origen de contraste. Además, los lotes del navegador esperan dos segundos después de cada respuesta antes de solicitar el siguiente sorteo, incluso si Vercel reparte las llamadas entre distintas instancias. Al terminar esa espera se comprueba de nuevo si se ha detenido el lote o desmontado la aplicación. Ante 429 el servidor respeta `Retry-After` (segundos o fecha HTTP) o espera 60 segundos si no hay plazo válido, omitiendo nuevas consultas a ese origen durante la pausa. No bloquea otras fuentes ni la caché. La pausa del servidor opera por instancia y la del navegador por lote; no coordinan varios dispositivos o réplicas, por lo que algunos importes pueden necesitar reintento posterior. No reducir estas pausas para eludir límites del proveedor.

Al abrir la aplicación se recuperan los pendientes históricos si está activada la opción correspondiente. La comprobación diaria en segundo plano procesa lotes de 12 sorteos por copia compartida, con reserva temporal, revisión esperada y presupuesto de 45 segundos. No ejecuta SQL de migración.

`vercel.json` programa `GET /api/cron` a las **04:00 UTC** todos los días: 05:00 en invierno y 06:00 en verano en Madrid. Vercel solo programa cron en **producción**; la preview no lo ejecuta automáticamente. En Hobby puede ejecutarse dentro de la hora programada. La prueba manual autenticada de una preview debe limitarse a su base de pruebas. Véase [contrato, contadores y límites](CRON.md) y [documentación oficial](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Publicación posterior, tras aprobación

1. Obtener la aprobación del usuario sobre la preview y el alcance de la migración. Conservar una exportación reciente de los datos originales.
2. Preparar una base de producción separada, sus secretos y el origen canónico. Aplicar la migración SQL en ese entorno deliberadamente.
3. Ejecutar `npm run check`, desplegar la versión aprobada y verificar acceso, aislamiento entre espacios compartidos, rutas y resultados por fecha.
4. El usuario revisa su copia local de producción y confirma la migración compartida. Las cuentas y copias QA de preview no se trasladan.
5. Confirmar la automatización deseada y verificar una ejecución sobre la copia ya migrada: premio contabilizado una vez, Logs y `last_checked_at`. Mantener las copias previas para recuperación.

La publicación del código y la migración de datos son acciones distintas. Revertir código no restaura por sí solo la base. No borrar el almacenamiento original ni las copias durante esta transición.

## Limitaciones pendientes

No está implementado el restablecimiento de contraseña por correo. Las copias de aplicación no sustituyen respaldos externos de PostgreSQL. Una fuente de resultados indisponible deja el sorteo pendiente de reintento, sin alterar dinero confirmado. El modo local sigue dependiendo de que la aplicación esté abierta para comprobar resultados.
