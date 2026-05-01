# Euromillones Control

Aplicacion web privada para gestionar una peña de Euromillones: aportaciones, gasto por sorteo, premios, ajustes manuales y logs de comprobacion.

## Stack

- React + Vite + TypeScript
- Persistencia local con `localStorage`
- API serverless opcional en `api/check-euromillones.ts`
- Proveedor de resultados: SELAE primero; RTVE como fallback cuando SELAE bloquea con 403
- Sorteos marcados como apuesta automatica; la app comprueba pendientes al abrir sin pedir confirmacion
- Preparada para Vercel como SPA

## Comandos

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Datos iniciales

Importados desde `Control_Euromillones_2026-2027.xlsm`:

- Participantes: Jose, David C, David T
- Aportacion anual: 120 EUR cada uno
- Total aportado: 360 EUR
- Periodo operativo: 27/01/2026 a 26/01/2027
- Coste: 2,50 EUR por sorteo
- Jugada fija: 07 14 17 25 33 + estrellas 4 y 7
- Premio registrado: 3,94 EUR el 17/03/2026

## Persistencia

La version actual guarda los datos en el navegador. Esto permite desplegar gratis en Vercel sin base de datos, pero los datos no se sincronizan automaticamente entre dispositivos ni se actualizan en segundo plano si nadie abre la app. Usa `Exportar` para guardar una copia JSON.

Para sincronizacion real, sustituir `src/lib/storage.ts` por un adaptador de base de datos y mantener el modelo de `src/types.ts`.

## Proyecto Vercel

Nombre sugerido del proyecto: `euromillones-control`.

La SPA usa `vercel.json` para redirigir rutas al `index.html` y mantener la API bajo `/api/*`.

## Fuentes De Resultados

La app intenta primero SELAE. Si SELAE responde con geobloqueo o `403`, usa RTVE como fallback publico para combinacion y escrutinio. La fuente usada queda en la respuesta de la API y en los logs de la app.
