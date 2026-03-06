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
      '/entrasp/controller': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/entrasp/controller2': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/entrasp/images': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
