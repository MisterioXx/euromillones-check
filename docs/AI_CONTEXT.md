# Contexto Para IA

## Producto

App privada para gestionar una peña de Euromillones de tres personas. Sustituye un Excel manual y facilita:

- Total aportado, gastado y saldo actual.
- Sorteos martes y viernes.
- Premios y gastos asociados.
- Ajustes manuales, por ejemplo compra de boletos externos.
- Logs visibles cuando falla la comprobacion automatica.
- La apuesta se considera automatica: no pedir al usuario marcar sorteos como jugados.

## Datos de partida

- Inicio operativo: `2026-01-27`, aunque el usuario menciono `2026-01-26`; el Excel empieza el primer sorteo el martes 27.
- Fin: `2027-01-26`.
- Participantes: Jose, David C, David T.
- Aportacion: 120 EUR por persona.
- Coste: 2,50 EUR por sorteo.
- Jugada: numeros `7,14,17,25,33`; estrellas `4,7`.
- Premio importado: 3,94 EUR el `2026-03-17`.

## Decisiones

- Vercel gratis no ofrece filesystem persistente para SQLite en funciones serverless.
- Por eso el MVP persiste en `localStorage` y puede desplegar como SPA.
- La API `/api/check-euromillones` intenta leer SELAE, pero puede fallar por geobloqueo o cambios de HTML.
- Si SELAE falla, `src/server/checkEuromillones.ts` usa RTVE como fallback para combinacion y tabla de premios.
- Si la API no puede extraer un importe de premio, no debe inventarlo. El usuario puede registrarlo manualmente.
- El auto-check actual ocurre al abrir la app. Para automatizacion real 24/7 hace falta BD y cron.

## UX

Diseño de dashboard operativo: saldo, combinacion, KPIs, ultimo sorteo, tabla editable, caja, configuracion y logs.
