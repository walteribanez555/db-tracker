// Empaqueta los procesos Node (Electron main/preload, servidor web y puente MCP stdio) con esbuild.
// Uso: node scripts/build-node.mjs [all|electron|server|mcp]
import { build } from 'esbuild'

const target = process.argv[2] ?? 'all'

const esmBanner = {
  js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  // pg-native es opcional en `pg`; cpu-features y similares no se usan.
  external: ['electron', 'pg-native'],
}

const jobs = []

if (target === 'all' || target === 'electron') {
  jobs.push(
    build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.mjs', format: 'esm', banner: esmBanner }),
    // El preload con sandbox debe ser CommonJS.
    build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', format: 'cjs' }),
  )
}

if (target === 'all' || target === 'server') {
  jobs.push(build({ ...common, entryPoints: ['server/index.ts'], outfile: 'dist-server/index.mjs', format: 'esm', banner: esmBanner }))
}

if (target === 'all' || target === 'mcp') {
  // Puente stdio → HTTP para clientes MCP sin HTTP (Claude Desktop): node dist-mcp/stdio.mjs
  jobs.push(
    build({
      ...common,
      entryPoints: ['server/mcp/stdio.ts'],
      outfile: 'dist-mcp/stdio.mjs',
      format: 'esm',
      banner: { js: `#!/usr/bin/env node\n${esmBanner.js}` },
    }),
  )
}

await Promise.all(jobs)
