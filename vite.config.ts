import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/entrasp/app/',
  build: {
    outDir: '../entrasp/WebContent/app',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          antd: ['antd', '@ant-design/icons'],
          aggrid: ['ag-grid-community', 'ag-grid-react'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/entrasp/controller2': {
        target: 'http://localhost:9080',
        changeOrigin: true,
      },
      '/entrasp/controller': {
        target: 'http://localhost:9080',
        changeOrigin: true,
      },
      '/entrasp/images': {
        target: 'http://localhost:9080',
        changeOrigin: true,
      },
      // Guide e specifiche dei link PopupUrl/Url (content="doc/x.pdf", SXADV-5741.4).
      '/entrasp/doc': {
        target: 'http://localhost:9080',
        changeOrigin: true,
      },
      '/entrasp/app-plugins': {
        target: 'http://localhost:9080',
        changeOrigin: true,
      },
    },
  },
})
