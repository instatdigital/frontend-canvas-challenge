import { heyApiPlugin } from '@hey-api/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
  plugins: [
    react(),
    heyApiPlugin({
      config: {
        input: env.VITE_OPENAPI_SPEC_PATH,
        output: 'src/shared/api/client/',
        plugins: [
          {
            name: '@hey-api/client-ofetch',
            runtimeConfigPath: './src/shared/api/config.ts',
          },
        ],
      },
    }),
  ],
}
});
