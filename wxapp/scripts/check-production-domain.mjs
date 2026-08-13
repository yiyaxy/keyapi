import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDir = fileURLToPath(new URL('../dist/build/mp-weixin/', import.meta.url))
const textExtensions = new Set(['.js', '.json', '.wxml', '.wxss', '.html'])
const oldHost = 'token.cymoon.cn'
const newHost = 'token.mooschh.com'

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(path))
    } else if (textExtensions.has(extname(entry.name))) {
      files.push(path)
    }
  }

  return files
}

const files = await collectTextFiles(outputDir)
const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))

if (contents.some((content) => content.includes(oldHost))) {
  throw new Error(`生产构建仍包含旧域名：${oldHost}`)
}

if (!contents.some((content) => content.includes(newHost))) {
  throw new Error(`生产构建缺少新域名：${newHost}`)
}

console.log(`生产构建域名检查通过：${newHost}`)
