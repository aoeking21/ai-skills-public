import {createHash, randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {OwnerSessionClient} from './owner-session-client.mjs';

const [home,fixedBinary,capabilityManifestPath,issuerDirectory] = process.argv.slice(2);
if (!home?.startsWith('/') || !fixedBinary?.startsWith('/') || !capabilityManifestPath?.startsWith('/') || !issuerDirectory?.startsWith('/')) {
  throw new Error('ARGS_INVALID');
}
const sha=(b)=>createHash('sha256').update(b).digest('hex');
const fixedSha=sha(readFileSync(fixedBinary));
const capability=JSON.parse(readFileSync(capabilityManifestPath,'utf8'));
const now=Date.now();
const taskId=randomBytes(16).toString('hex');
const permit={
  schema:'TASK_PERMIT_V1',
  permit_id:randomBytes(16).toString('hex'),
  task_id:taskId,
  capability_id:'CAP_ENCONVO_GROK_R1',
  risk_level:'L3_GUI_WRITE',
  issued_at:new Date(now-1000).toISOString(),
  expires_at:new Date(now+300000).toISOString(),
  max_operations:1,
  allowed_tools:[...capability.allowed_tools],
  allowed_apps:[...capability.allowed_apps],
  allowed_paths:[...capability.allowed_paths],
  allowed_operations:[...capability.allowed_operations],
  evidence_required:true,
  rollback_required:true,
  replay_protection:{...capability.replay_protection},
  task_owner_auth:{required:true,provider:'JEV_G6_OWNER_AUTH',once_per_task:true},
};

const client=new OwnerSessionClient({
  issuerPath:fixedBinary,
  issuerSha256:fixedSha,
  capabilityManifestPath,
  command:fixedBinary,
  args:['--issuer-dir',issuerDirectory],
  requestTimeoutMs:120000,
  maxOutputBytes:65536,
});
let ledger;
try {
  const session=await client.openSession(permit);
  const issuedMs=Date.now();
  const claim={
    version:1,
    grantId:randomBytes(16).toString('hex'),
    nonce:randomBytes(16).toString('hex'),
    toolName:'desktop_click',
    target:'/gui/EnConvo/__compat_smoke__/'+randomBytes(8).toString('hex'),
    actionDigest:randomBytes(32).toString('hex'),
    issuedMs,
    expiresMs:Math.min(issuedMs+5000,session.expires_ms),
  };
  const signed=await client.signGrant(session.session_id,claim);
  const checks=await import(path.join(home,'.local/share/jev-gui-permit-mcp/checks.mjs'));
  const verifier=await import(path.join(home,'.local/share/jev-gui-permit-mcp/gui-owner-grant.mjs'));
  const trustPin=checks.guiPin();
  const dbPath=path.join(path.dirname(fixedBinary),'compat-smoke-ledger.sqlite');
  const loaded=verifier.loadGuiOwnerVerifier({
    trustPath:checks.TRUST,
    pinnedSha256:trustPin,
    databasePath:dbPath,
  });
  ledger=loaded.ledger;
  const result=ledger.ready({
    grant:signed.grant,
    toolName:claim.toolName,
    target:claim.target,
    actionDigest:claim.actionDigest,
    now:Date.now(),
  });
  if (result?.ok !== true || result?.code !== 'GUI_OWNER_GRANT_READY') {
    throw new Error('PRODUCTION_VERIFIER_REJECTED_'+String(result?.code));
  }
  console.log('FIXED_ISSUER_COMPAT=PASS');
  console.log('PRODUCTION_VERIFIER=GUI_OWNER_GRANT_READY');
  console.log('GUI_ACTION_EXECUTED=NO');
  console.log('PRODUCTION_CHANGE=NO');
  console.log('FIXED_BINARY_SHA256='+fixedSha);
} finally {
  try { ledger?.close(); } catch {}
  try { await client.close(); } catch {}
}
