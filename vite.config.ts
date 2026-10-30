import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA：第一次載入後可離線開啟（見 spec 8.3）
    // registerType: 'prompt'：有新版本時由使用者按下更新，避免收銀中自動重新整理弄丟購物車
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Till 市集收銀',
        short_name: 'Till',
        description: '用 Google 試算表當後台的市集收銀 App，離線也能結帳',
        lang: 'zh-Hant',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#fafaf9',
        theme_color: '#fafaf9',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // 連同延遲載入的模組（相機掃碼 wasm、標籤 PDF）一起預先快取，離線也能用
        globPatterns: ['**/*.{js,css,html,png,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024
      }
    })
  ],
  base: './'
})
