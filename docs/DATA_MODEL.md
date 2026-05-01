# Modelo De Datos

Los tipos principales viven en `src/types.ts`.

## `AppState`

Contiene:

- `config`: fechas, jugada, coste por defecto y auto-comprobacion.
- `participants`: participantes y aportaciones.
- `draws`: sorteos generados para martes y viernes.
- `movements`: ajustes manuales de caja.
- `logs`: eventos visibles en la app.

## Calculos

La logica esta en `src/lib/domain.ts`.

- Gasto de sorteo: `played ? lines * costPerLine : 0`. En la UX actual `played` es automatico y no se muestra como tarea manual.
- Premio neto: `grossPrize - expenses`, con minimo 0.
- Total aportado: suma de aportacion anual + extra de participantes.
- Saldo actual: aportado + premios netos hasta hoy + ajustes hasta hoy - gasto hasta hoy.
- Saldo proyectado: aportado + todos los premios + todos los ajustes - todos los sorteos planificados.

## Categorias

`categoryLabel()` calcula la categoria por aciertos de numeros y estrellas. No calcula importes porque dependen del sorteo.

## Migracion Futura A BD

Mantener `src/types.ts` como contrato. Sustituir `src/lib/storage.ts` por:

- API REST serverless.
- Vercel Postgres, Neon, Supabase o KV.
- Import/export JSON para migrar datos locales.
