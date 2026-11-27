// Compile the pure editor tests with the project's existing TypeScript dependency.
import ts from 'typescript'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(join(tmpdir(), 'cutroom-tests-'))
try {
  for (const name of [
    'src/shared/effects',
    'src/shared/timeline',
    'src/shared/timeline-ops',
    'src/shared/style-presets',
    'tests/editor.test'
  ]) {
    const source = await readFile(`${name}.ts`, 'utf8')
    const out = join(dir, `${name}.js`)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(
      out,
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }).outputText
    )
  }
  const result = spawnSync(process.execPath, ['--test', join(dir, 'tests/editor.test.js')], {
    stdio: 'inherit'
  })
  process.exitCode = result.status ?? 1
} finally {
  await rm(dir, { recursive: true, force: true })
}
