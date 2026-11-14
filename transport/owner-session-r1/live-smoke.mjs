import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  OwnerSessionClient,
  validateIssuerPin,
  validateCapabilityManifestPin,
} from './owner-session-client.mjs';

const [issuerPath, capabilityManifestPath, issuerDirectory] = process.argv.slice(2);
if (!issuerPath || !capabilityManifestPath || !issuerDirectory) {
  console.error('USAGE: node live-smoke.mjs <issuerPath> <capabilityManifestPath> <issuerDirectory>');
  process.exit(2);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hex32 = () => randomBytes(16).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await validateIssuerPin(issuerPath);
await validateCapabilityManifestPin(capabilityManifestPath);

const capability = JSON.parse(await readFile(capabilityManifestPath, 'utf8'));
if (capability?.id !== 'CAP_ENCONVO_GROK_R1'
  || capability?.target?.app !== 'EnConvo'
  || capability?.owner_auth?.required !== true
  || capability?.owner_auth?.provider !== 'JEV_G6_OWNER_AUTH'
  || capability?.owner_auth?.once_per_task !== true
  || capability?.owner_auth?.max_gui_owner_session_seconds !== 300
  || capability?.permanent_authorization !== false) {
  throw new Error('CAPABILITY_SCOPE_INVALID');
}

const now = Date.now();
const permit = {
  schema: 'TASK_PERMIT_V1',
  permit_id: hex32(),
  task_id: hex32(),
  capability_id: capability.id,
  risk_level: capability.risk_level,
  issued_at: new Date(now - 1000).toISOString(),
  expires_at: new Date(now + 30_000).toISOString(),
  max_operations: 2,
  allowed_tools: [...capability.allowed_tools],
  allowed_apps: [...capability.allowed_apps],
  allowed_paths: [...capability.allowed_paths],
  allowed_operations: [...capability.allowed_operations],
  evidence_required: capability.evidence_required === true,
  rollback_required: capability.rollback_required === true,
  replay_protection: {...capability.replay_protection},
  task_owner_auth: {
    required: capability.owner_auth.required === true,
    provider: capability.owner_auth.provider,
    once_per_task: capability.owner_auth.once_per_task === true,
  },
};

const client = new OwnerSessionClient({
  issuerPath,
  capabilityManifestPath,
  command: issuerPath,
  args: ['--issuer-dir', issuerDirectory],
  requestTimeoutMs: 120_000,
  maxOutputBytes: 65_536,
});

let opened;
let first;
let second;
try {
  opened = await client.openSession(permit);

  const issued1 = Date.now();
  first = await client.signGrant(opened.session_id, {
    version: 1,
    grantId: hex32(),
    nonce: hex32(),
    toolName: 'desktop_click',
    target: '/gui/EnConvo/__owner_session_smoke__/one',
    actionDigest: sha256('JEV_OWNER_SESSION_SMOKE_ONE'),
    issuedMs: issued1,
    expiresMs: issued1 + 1_000,
  });

  const issued2 = Date.now();
  second = await client.signGrant(opened.session_id, {
    version: 1,
    grantId: hex32(),
    nonce: hex32(),
    toolName: 'desktop_type',
    target: '/gui/EnConvo/__owner_session_smoke__/two',
    actionDigest: sha256('JEV_OWNER_SESSION_SMOKE_TWO'),
    issuedMs: issued2,
    expiresMs: issued2 + 1_000,
  });

  if (first.session_id !== opened.session_id
    || second.session_id !== opened.session_id
    || first.task_id !== permit.task_id
    || second.task_id !== permit.task_id
    || first.permit_id !== permit.permit_id
    || second.permit_id !== permit.permit_id
    || first.grant.claim.grantId === second.grant.claim.grantId) {
    throw new Error('LIVE_SMOKE_BINDING_INVALID');
  }

  await sleep(1_250);

  console.log('LIVE_SMOKE=PASS');
  console.log('OPEN_SESSION=PASS');
  console.log('SIGN_GRANT_1=PASS');
  console.log('SIGN_GRANT_2=PASS');
  console.log('SAME_SESSION_PROCESS=PASS');
  console.log('SESSION_ID_SHA256=' + sha256(opened.session_id));
  console.log('GRANT_1_EXPIRED=YES');
  console.log('GRANT_2_EXPIRED=YES');
  console.log('GUI_ACTION_EXECUTED=NO');
  console.log('PRODUCTION_CHANGE=NO');
} finally {
  await client.close();
}
