import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [home] = process.argv.slice(2);
if (!home?.startsWith('/')) throw new Error('HOME_REQUIRED');

const source = path.join(home,'JEV-Workspace/G6-TaskOps/runtime/TaskOwnerSessionIssuer.swift');
const deployed = path.join(home,'JEV-Workspace/G6-TaskOps/runtime/TaskOwnerSessionIssuer');
const expectedDeployedSha = '3c7bbc59ac399b809fd46d2a29aad34ab57bfb1105a850effd6e2fc3d8c927a8';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here,'generated');
const outSource = path.join(outDir,'TaskOwnerSessionIssuer.fixed.swift');
const outBinary = path.join(outDir,'TaskOwnerSessionIssuer.fixed');
const sha = (b)=>createHash('sha256').update(b).digest('hex');

if (sha(readFileSync(deployed)) !== expectedDeployedSha) throw new Error('DEPLOYED_ISSUER_PIN_MISMATCH');
const raw = readFileSync(source,'utf8');
const needle = 'JSONSerialization.data(withJSONObject: values, options: [])';
const replacement = 'JSONSerialization.data(withJSONObject: values, options: [.withoutEscapingSlashes])';
const count = raw.split(needle).length - 1;
if (count !== 1) throw new Error('PATCH_SITE_MISMATCH');
const fixed = raw.replace(needle,replacement);
mkdirSync(outDir,{recursive:true,mode:0o700});
writeFileSync(outSource,fixed,{mode:0o600});

const r = spawnSync('/usr/bin/xcrun',['--sdk','macosx','swiftc',outSource,'-o',outBinary],{
  encoding:'utf8',
  timeout:120000,
  maxBuffer:1024*1024,
});
if (r.status !== 0) {
  process.stderr.write((r.stderr || r.stdout || '').slice(0,4000));
  throw new Error('SWIFTC_FAILED');
}
chmodSync(outBinary,0o700);
console.log('BUILD_FIXED_ISSUER=PASS');
console.log('SOURCE_SHA256='+sha(Buffer.from(fixed,'utf8')));
console.log('BINARY_SHA256='+sha(readFileSync(outBinary)));
console.log('OUTPUT='+outBinary);
console.log('DEPLOYED_CHANGE=NO');
