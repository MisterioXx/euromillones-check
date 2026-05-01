# AI Context

Este repo contiene una SPA Vite/React para una pena de Euromillones. Antes de cambiar codigo, lee:

- `docs/AI_CONTEXT.md`: resumen del producto y decisiones clave.
- `docs/DATA_MODEL.md`: entidades y reglas de calculo.
- `docs/VERCEL.md`: notas de despliegue y limitaciones.

Prioridades:

1. No introducir backend persistente sin explicitar migracion de datos.
2. Mantener la app usable en movil y escritorio.
3. Registrar fallos de comprobacion en la vista Logs.
4. Evitar automatismos que sumen premios si el importe no es fiable.
