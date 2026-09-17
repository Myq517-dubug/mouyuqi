/**
 * Vitest 配置：jsdom 环境 + 全局 API + jest-dom setup + v8 覆盖率。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/providers/**'],
      reporter: ['text', 'html']
    }
  }
})
