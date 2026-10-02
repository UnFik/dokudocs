import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // Run by hand (see the comment in the file), never imported.
  entry: ['scripts/generate-suggestions-fixture.ts'],
  ignore: [
    'src/components/ui/**',
    'src/components/layout/app-title.tsx',
    'src/tanstack-table.d.ts',
  ],
}

export default config