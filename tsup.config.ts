import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node22',
  platform: 'node',
  dts: {
    // tsup's dts build sets `baseUrl`, which TypeScript 6 deprecates.
    compilerOptions: { ignoreDeprecations: '6.0' }
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true
})
