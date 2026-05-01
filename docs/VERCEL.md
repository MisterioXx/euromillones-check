# Vercel

## Despliegue

Proyecto sugerido: `euromillones-control`.

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

## SPA Routing

`vercel.json` envia las rutas de la SPA a `index.html` y deja libres las rutas `/api/*`.

## Limitaciones Del MVP

- `localStorage` no sincroniza entre navegadores ni moviles.
- Los logs tambien son locales al navegador.
- La comprobacion intenta SELAE y cae a RTVE si SELAE bloquea. Ambas fuentes pueden cambiar HTML.

## Siguiente Paso Recomendado

Si la app se va a usar desde varios dispositivos:

1. Anadir login simple.
2. Mover `AppState` a una BD gratuita externa.
3. Crear endpoint de importacion desde el JSON exportado.
4. Programar cron de comprobacion y guardar resultados en BD.
