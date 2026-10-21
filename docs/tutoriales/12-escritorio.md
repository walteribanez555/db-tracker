# 12. Aplicación de escritorio (en pausa)

[← Volver al README](../../README.md)

> Por ahora el objetivo es la versión web. El código de escritorio está en el repositorio, pero no se mantiene activamente.

La app de escritorio usa Electron y reutiliza la misma API (`server/app.ts`): el proceso principal la levanta en `127.0.0.1` con un puerto libre y la ventana carga el frontend desde ahí. Así, la conexión a bases remotas y a GitHub funciona sin un servidor aparte.

```bash
npm run dev:desktop     # Vite + Electron en desarrollo
npm run start:desktop   # compila y abre la app
npm run dist:desktop    # genera instaladores (dmg/zip, nsis, AppImage/deb) en release/
```

Archivos:

- `electron/main.ts`: ventana, API embebida y apertura de enlaces externos en el navegador.
- `electron/preload.ts`: expone `window.dbTracker` (runtime y plataforma).
- `scripts/build-node.mjs`: empaqueta el proceso principal y el servidor con esbuild.
- `electron-builder.yml`: configuración de los instaladores.

[← Volver al README](../../README.md)
