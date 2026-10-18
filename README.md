# EuroControl · Euromillones

Aplicación para gestionar una peña: aportaciones, gasto por sorteo, premios, ajustes de caja y comprobaciones. Interfaz adaptable a móvil y escritorio, con Resumen, Sorteos, Caja, Ajustes y Logs.

Esta revisión se prepara para revisión en **preview**. Publicarla en producción requiere aprobación posterior. La aplicación existente es [euromillones-check.vercel.app](https://euromillones-check.vercel.app/); esa dirección no confirma que incluya los cambios de esta rama.

## Arquitectura

- React, Vite y TypeScript, servidos como SPA en Vercel.
- Modo local en `localStorage`, con exportación JSON y recuperación de copias.
- Copia compartida opcional en PostgreSQL/Neon, acceso mediante Better Auth y pertenencia privada a una peña. Se activa mediante una migración explícita de la copia revisada por el usuario.
- Funciones de Vercel para resultados públicos, acceso, sincronización y comprobación diaria. El comprobador y las reglas de conciliación son los mismos en desarrollo, navegador y cron.
- Guardados compartidos con revisión, rechazo de conflictos y copias anteriores: original de migración y 30 versiones anteriores de cambios.

## Desarrollo y comprobaciones

Requiere Node.js 22 a 26.

```bash
npm install
npm run dev
npm run check
npm run build
npm run preview
```

`check` ejecuta TypeScript, pruebas y build. `dev` sirve también las rutas API. `preview` solo permite revisar el build estático; para comprobar acceso, base de datos y funciones usa `dev` o una preview de Vercel.

El modo local funciona sin base de datos. Para probar la conexión compartida, configura en `.env.local` una base **de desarrollo/preview separada de producción**, `BETTER_AUTH_SECRET`, `CRON_SECRET` y `APP_ORIGIN=http://localhost:5173`. Los secretos nunca llevan prefijo `VITE_` ni se suben a Git. Prepara el esquema deliberadamente:

```bash
npm run db:migrate
```

Este comando lee `.env.local`, crea/actualiza tablas de acceso y peñas y **no importa datos de usuarios**. No se ejecuta durante el build. Véase [configuración y publicación](docs/VERCEL.md).

## Probar tus datos sin sustituir los originales

1. Exporta el JSON actualizado desde el navegador donde usas la aplicación de producción.
2. Abre la preview e importa ese JSON en Ajustes. Revisa saldo, participantes y sorteos antes de confirmar.
3. Si quieres probar sincronización, crea una cuenta en la preview y activa la copia compartida después de revisar el resumen de la migración. Puedes invitar a otra cuenta mediante un código de un solo uso.
4. Conserva la exportación original. Las cuentas y datos de preview no se trasladan automáticamente a producción.

Cada origen web tiene su propio almacenamiento local: abrir una preview no permite leer el `localStorage` de producción. Los datos iniciales incluidos en el código proceden del Excel original; no sustituyen una exportación reciente del navegador del usuario.

Se admiten copias JSON de las versiones 1 y 2. La versión 1 se valida y migra a la 2 conservando la copia previa, importes, gastos, notas y registros. Las fechas usan `AAAA-MM-DD`; los importes JSON son números en euros con hasta dos decimales. Los cálculos monetarios se realizan en céntimos. Una copia corrupta bloquea el guardado hasta recuperar o importar una válida.

## Resultados y saldo

La API busca cada fecha en el servicio estructurado de SELAE, con páginas históricas oficiales como alternativa. Si SELAE falla, contrasta Lotería Angelita y ComprobarEuromillones: solo acepta cuotas cuando ambas publicaciones coinciden en fecha, combinación y tabla completa de 13 categorías. Las dos fuentes quedan identificadas; este contraste no se presenta como una consulta directa a SELAE. RTVE puede aportar la combinación, pero **sus importes no se abonan automáticamente**: se han observado cuotas sin céntimos en el widget y errores en noticias.

Se valida la fecha exacta, cinco números únicos entre 1 y 50, dos estrellas únicas entre 1 y 12 y la cuota de la categoría correspondiente. Si falta una cuota fiable contrastada, el sorteo permanece «Importe pendiente». Una diferencia de un céntimo entre las publicaciones bloquea el abono. Un fallo queda en Logs y permite continuar con los demás sorteos. Las consultas tienen tiempo límite y reintento acotado.

Las consultas a cada publicación de contraste se espacian al menos un segundo dentro de la instancia del comprobador. Un HTTP 429 activa una pausa conforme a `Retry-After`, o de 60 segundos si no indica un plazo válido; no se reintenta inmediatamente esa fuente. Mientras tanto pueden usarse resultados ya verificados en caché y otras fuentes. Si no se completa el contraste, el importe sigue pendiente para una consulta posterior.

Los premios se actualizan sobre el sorteo existente, sin ingresos duplicados. Los importes manuales/importados, gastos, notas y movimientos de caja se conservan; una discrepancia requiere revisión. Los sorteos con varias apuestas requieren revisión de su importe, porque no se conoce cada combinación. Cambiar la jugada de configuración no reescribe las apuestas históricas.

Al abrir la aplicación se comprueban los pendientes, incluido el histórico, si la opción está activada. También hay actualización manual, consulta individual y progreso. Con la app abierta se reevalúa la comprobación cada 15 minutos y al recuperar conexión/visibilidad.

La comprobación con la app cerrada exige copia compartida y activación del propietario. El cron está configurado diariamente a las **04:00 UTC**, procesa hasta 12 sorteos por peña y continúa en ejecuciones siguientes. Vercel solo lo programa en producción; la preview permite probarlo de forma autenticada, pero no recibe ejecuciones programadas. Véase [contrato del cron](docs/CRON.md).

## Limitaciones conocidas

- El modo local solo guarda en ese navegador; no comprueba resultados mientras la app está cerrada.
- No está implementado el restablecimiento de contraseña por correo. Conviene guardar la contraseña y mantener una exportación recuperable.
- Las fuentes externas pueden estar indisponibles o cambiar de formato. En ese caso se conserva el saldo y se informa del fallo.
- Las copias de aplicación no sustituyen una política de respaldo independiente de la base de datos.

Contexto técnico y reglas de negocio: [AI_CONTEXT](docs/AI_CONTEXT.md), [DATA_MODEL](docs/DATA_MODEL.md).
