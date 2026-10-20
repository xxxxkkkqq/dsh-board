/**
 * Runs every test file in this directory against a scratch React install.
 *
 * The client tests render the real bundle through `react-test-renderer`, which
 * the Harness itself does not depend on, so they need a directory that has
 * `react`, `react-dom` and `react-test-renderer`. `test/run.sh` prepares one and
 * then calls this file.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here).filter((name) => name.endsWith('.test.mjs')).sort()
let failed = 0

for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' })
  if (result.status !== 0) {
    failed += 1
    console.error(`\n${file} FAILED\n`)
  }
}

if (failed > 0) {
  console.error(`${failed} of ${files.length} test files failed`)
  process.exit(1)
}
console.log(`\nall ${files.length} test files passed`)
