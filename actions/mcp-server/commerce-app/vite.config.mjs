import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// APP selects which commerce UI to build. Each app lives under src/<app-name>/.
const APP = process.env.APP || 'product-list'
const appRoot = path.join(__dirname, 'src', APP)

export default defineConfig({
  root: appRoot,
  plugins: [viteSingleFile()],
  build: {
    outDir: path.join(__dirname, '../static'),
    emptyOutDir: false,
    rollupOptions: {
      input: path.join(appRoot, `${APP}.html`)
    }
  }
})
