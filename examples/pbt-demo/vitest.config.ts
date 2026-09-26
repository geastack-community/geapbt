import type { Plugin } from 'vite'
import { geaPlugin } from '@geajs/vite-plugin'
import { defineConfig } from 'vitest/config'

const disableGeaHmrInTests: Plugin = {
  name: 'disable-gea-hmr-in-tests',
  enforce: 'post',
  transform(code, id) {
    if (id !== '\0virtual:gea-hmr') return null
    // Vitest provides import.meta.hot without the data object Gea's HMR runtime expects.
    return code.replace('var hot = import.meta.hot;', 'var hot = undefined;')
  },
}

export default defineConfig({
  plugins: [geaPlugin(), disableGeaHmrInTests],
  test: {
    environment: 'jsdom',
    clearMocks: true,
  },
})
