import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

// Get spark build timestamp from file modification time
function getSparkBuildTime() {
  try {
    const sparkPath = path.resolve(__dirname, './lib/spark.module.js');
    if (fs.existsSync(sparkPath)) {
      const stats = fs.statSync(sparkPath);
      return new Date(stats.mtime).toISOString();
    }
  } catch (e) {
    // Ignore errors
  }
  return 'unknown';
}

export default defineConfig(({ command }) => ({
  resolve: {
    alias: {
      // Use local spark build from lib directory (included in deployment)
      '@sparkjsdev/spark': path.resolve(__dirname, './lib/spark.module.js'),
    },
  },
  server: {
    port: 3000,
    open: true
  },
  // In dev mode: serve from public/ directory for local testing
  // In build mode: don't copy public/ to dist/ (assets are on CDN)
  publicDir: command === 'serve' ? 'public' : false,
  build: {
    // Target ES2022 to support top-level await
    target: 'es2022',
  },
  define: {
    // Inject build timestamps
    __PROTOVERSE_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __SPARK_BUILD_TIME__: JSON.stringify(getSparkBuildTime()),
  },
}));

