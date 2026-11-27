import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const dir = await mkdtemp('.reader-test-')
try {
  for (const entry of ['test/host-harness.mjs','test/harness.jsx','test/harness-pdf.jsx']) {
    const outfile = join(dir,'check.mjs')
    await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',packages:'external'})
    const child = spawnSync(process.execPath,[outfile],{stdio:'inherit'})
    if (child.status !== 0) {process.exitCode=1;break}
  }
} finally {await rm(dir,{recursive:true,force:true})}
