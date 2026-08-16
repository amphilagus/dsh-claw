import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'home/index': 'src/home/index.ts',
    'home/invariant': 'src/home/invariant.ts',
    'sandbox/index': 'src/sandbox/index.ts',
    'memory/index': 'src/memory/index.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
})
