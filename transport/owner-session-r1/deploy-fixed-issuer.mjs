import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const [home,fixedSource,fixedBinary] = process.argv.slice(2);
if (!home?.startsWith('/') || !fixedSource?.startsWith('/') || !fixedBinary?.startsWith('/')) throw new Error('ARGS_INVALID');

const runtime = path.join(home,'JEV-Workspace/G6-TaskOps/runtime');
const prodSource = path.join(runtime,'TaskOwnerSessionIssuer.swift');
const prodBinary = path.join(runtime,'TaskOwnerSessionIssuer');
const expectedOldBinary = '3c7bbc59ac399b809fd46d2a29aad34ab57bfb1105a850effd6e2fc3d8c927a8';
const expectedNewSource = '96ec5558ea47f14f2e638b67ba13ae41655f922778efda35fcb4d7c132982907';
const expectedNewBinary = '5fd8a579aa8292076e50d651d9bc540cb2feebabf63c9e3900b3ca5e822997de';
const sha = (p)=>createHash('sha256').update(readFileSync(p)).digest('hex');

if (!existsSync(prodSource) || !existsSync(prodBinary) || !existsSync(fixedSource) || !existsSync(fixedBinary)) throw new Error('FILE_MISSING');
if (sha(prodBinary) !== expectedOldBinary) throw new Error('OLD_BINARY_PIN_MISMATCH');
if (sha(fixedSource) !== expectedNewSource) throw new Error('FIXED_SOURCE_PIN_MISMATCH');
if (sha(fixedBinary) !== expectedNewBinary) throw new Error('FIXED_BINARY_PIN_MISMATCH');

const oldText = readFileSync(prodSource,'utf8');
if (!oldText.includes('JSONSerialization.data(withJSONObject: values, options: [])')) throw new Error('OLD_SOURCE_PATCH_SITE_MISSING');
if (oldText.includes('JSONSerialization.data(withJSONObject: values, options: [.withoutEscapingSlashes])')) throw new Error('SOURCE_ALREADY_PATCHED');

const stamp = new Date().toISOString().replace(/[:.]/g,'');
const backupDir = path.join(runtime,'backups','issuerfix-'+stamp);
mkdirSync(backupDir,{recursive:true,mode:0o700});
copyFileSync(prodSource,path.join(backupDir,'TaskOwnerSessionIssuer.swift'));
copyFileSync(prodBinary,path.join(backupDir,'TaskOwnerSessionIssuer'));
chmodSync(path.join(backupDir,'TaskOwnerSessionIssuer.swift'),0o600);
chmodSync(path.join(backupDir,'TaskOwnerSessionIssuer'),0o700);

const tempSource = prodSource+'.tmp.'+process.pid;
const tempBinary = prodBinary+'.tmp.'+process.pid;
writeFileSync(tempSource,readFileSync(fixedSource),{mode:0o600});
writeFileSync(tempBinary,readFileSync(fixedBinary),{mode:0o700});
if (sha(tempSource) !== expectedNewSource || sha(tempBinary) !== expectedNewBinary) throw new Error('TEMP_VERIFY_FAILED');
renameSync(tempSource,prodSource);
renameSync(tempBinary,prodBinary);
chmodSync(prodSource,0o600);
chmodSync(prodBinary,0o700);

if (sha(prodSource) !== expectedNewSource || sha(prodBinary) !== expectedNewBinary) throw new Error('POST_INSTALL_VERIFY_FAILED');

console.log('TASKOPS_ISSUER_DEPLOY=PASS');
console.log('BACKUP_DIR='+backupDir);
console.log('SOURCE_SHA256='+expectedNewSource);
console.log('BINARY_SHA256='+expectedNewBinary);
console.log('FROZEN_G6_CORE_TOUCHED=NO');
