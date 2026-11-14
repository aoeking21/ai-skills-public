import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const fakeIssuerPath = path.join(here, 'fake-issuer.mjs');
const clientModule = await import(path.join(root, 'owner-session-client.mjs'));
const stateModule = await import(path.join(root, 'owner-session-state.mjs'));

const {
  OwnerSessionClient,
  validateIssuerPin,
  validateCapabilityManifestPin,
} = clientModule;
const {OwnerSessionState} = stateModule;

const H32_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const H32_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const H64_B = 'b'.repeat(64);

const exactTools = [
  'desktop_status', 'desktop_snapshot', 'desktop_click', 'desktop_type',
  'desktop_launch', 'file_read', 'file_backup', 'oauth_status',
];
const exactPaths = [
  '/fixture/enconvo-data',
  '/fixture/enconvo-config',
  '/fixture/taskops',
];
const exactOperations = [
  'status', 'routine.detect', 'routine.create', 'routine.update',
  'config.backup', 'oauth.status', 'recover.safe',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function permit({now = Date.now(), maxOperations = 4, allowedApps = ['EnConvo']} = {}) {
  return {
    schema: 'TASK_PERMIT_V1',
    permit_id: H32_A,
    task_id: H32_B,
    capability_id: 'CAP_ENCONVO_GROK_R1',
    risk_level: 'L3_GUI_WRITE',
    issued_at: new Date(now - 1_000).toISOString(),
    expires_at: new Date(now + 300_000).toISOString(),
    max_operations: maxOperations,
    allowed_tools: exactTools,
    allowed_apps: allowedApps,
    allowed_paths: exactPaths,
    allowed_operations: exactOperations,
    evidence_required: true,
    rollback_required: true,
    replay_protection: {mode: 'ONE_SHOT_OPERATION_ID', deny_duplicates: true},
    task_owner_auth: {required: true, provider: 'JEV_G6_OWNER_AUTH', once_per_task: true},
  };
}

function action(index = 0) {
  const hex = index.toString(16).padStart(64, '0');
  return {
    toolName: index % 2 === 0 ? 'desktop_click' : 'desktop_type',
    target: `/gui/EnConvo/routine/Grok-Bot/control-${index}`,
    actionDigest: hex,
  };
}

function grant(index = 0, now = Date.now()) {
  return {
    version: 1,
    grantId: (index + 1).toString(16).padStart(32, '0'),
    nonce: (index + 101).toString(16).padStart(32, '0'),
    ...action(index),
    issuedMs: now,
    expiresMs: now + 60_000,
  };
}

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'owner-session-r1-'));
  const capabilityPath = path.join(directory, 'capability.json');
  const capabilityBytes = Buffer.from('{"id":"CAP_ENCONVO_GROK_R1"}\n');
  await writeFile(capabilityPath, capabilityBytes, {mode: 0o600});
  const fakeBytes = await readFile(fakeIssuerPath);
  const logPath = path.join(directory, 'fake.log');
  const client = new OwnerSessionClient({
    issuerPath: fakeIssuerPath,
    capabilityManifestPath: capabilityPath,
    issuerSha256: sha256(fakeBytes),
    capabilityManifestSha256: sha256(capabilityBytes),
    command: process.execPath,
    args: [fakeIssuerPath],
    env: {...process.env, FAKE_ISSUER_LOG: logPath, ...options.env},
    requestTimeoutMs: 1_000,
    maxOutputBytes: 16_384,
  });
  return {client, logPath};
}

async function logEntries(logPath) {
  const text = await readFile(logPath, 'utf8');
  return text.trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('A: one open and two signs use the same child process', async () => {
  const {client, logPath} = await fixture();
  const opened = await client.openSession(permit());
  await client.signGrant(opened.session_id, grant(1));
  await client.signGrant(opened.session_id, grant(2));
  await client.close();
  const entries = await logEntries(logPath);
  assert.deepEqual(entries.map(({command}) => command), ['open_session', 'sign_grant', 'sign_grant']);
  assert.equal(new Set(entries.map(({pid}) => pid)).size, 1);
});

test('B: state enforces at most four mutation grants', async () => {
  const {client} = await fixture();
  const state = new OwnerSessionState({client});
  await state.open(permit());
  for (let index = 0; index < 4; index += 1) {
    await state.authorize(action(index), 'challenge');
    await state.authorize(action(index), 'execution');
  }
  await assert.rejects(state.authorize(action(4), 'challenge'), /MAX_OPERATIONS_EXCEEDED/);
  await state.close();
});

test('C: permit and mutation target are restricted to EnConvo', async () => {
  const first = await fixture();
  const wrongPermitState = new OwnerSessionState({client: first.client});
  await assert.rejects(wrongPermitState.open(permit({allowedApps: ['OtherApp']})), /ENCONVO_SCOPE_REQUIRED/);
  await wrongPermitState.close();

  const second = await fixture();
  const state = new OwnerSessionState({client: second.client});
  await state.open(permit());
  await assert.rejects(
    state.authorize({...action(0), target: '/gui/OtherApp/control'}, 'challenge'),
    /ENCONVO_SCOPE_REQUIRED/,
  );
  await state.close();
});

test('D: execution is bound to exact toolName, target, and actionDigest', async () => {
  const {client} = await fixture();
  const state = new OwnerSessionState({client});
  const original = action(0);
  await state.open(permit());
  await state.authorize(original, 'challenge');
  await assert.rejects(
    state.authorize({...original, actionDigest: H64_B}, 'execution'),
    /ACTION_BINDING_MISMATCH/,
  );
  await assert.rejects(state.authorize(original, 'execution'), /SESSION_REVOKED/);
});

test('E: challenge and execution of the same exact action reuse one signed grant', async () => {
  const {client, logPath} = await fixture();
  const state = new OwnerSessionState({client});
  await state.open(permit());
  const challenged = await state.authorize(action(0), 'challenge');
  const executed = await state.authorize(action(0), 'execution');
  assert.equal(executed.grant.claim.grantId, challenged.grant.claim.grantId);
  assert.equal((await logEntries(logPath)).filter(({command}) => command === 'sign_grant').length, 1);
  await state.close();
});

test('F: a different action receives a different one-shot grant', async () => {
  const {client} = await fixture();
  const state = new OwnerSessionState({client});
  await state.open(permit());
  const first = await state.authorize(action(0), 'challenge');
  await state.authorize(action(0), 'execution');
  const second = await state.authorize(action(1), 'challenge');
  assert.notEqual(first.grant.claim.grantId, second.grant.claim.grantId);
  await state.close();
});

test('G: a spent exact action cannot be replayed', async () => {
  const {client} = await fixture();
  const state = new OwnerSessionState({client});
  await state.open(permit());
  await state.authorize(action(0), 'challenge');
  await state.authorize(action(0), 'execution');
  await assert.rejects(state.authorize(action(0), 'challenge'), /ACTION_ALREADY_SPENT/);
  await state.close();
});

test('H: session expiry revokes the helper session', async () => {
  let now = Date.now();
  const {client} = await fixture();
  const state = new OwnerSessionState({client, now: () => now});
  const opened = await state.open(permit({now}));
  now = opened.expires_ms;
  await assert.rejects(state.authorize(action(0), 'challenge'), /SESSION_EXPIRED/);
  await assert.rejects(state.authorize(action(0), 'challenge'), /SESSION_REVOKED/);
});

test('I: uncertain delivery revokes the session and prevents retry', async () => {
  const {client} = await fixture();
  const state = new OwnerSessionState({client});
  await state.open(permit());
  await state.authorize(action(0), 'challenge');
  await state.markUncertainDelivery(action(0));
  await assert.rejects(state.authorize(action(0), 'execution'), /SESSION_REVOKED/);
});

test('J: successful helper output contains no private key material', async () => {
  const {client} = await fixture({env: {FAKE_PRIVATE_KEY: 'must-never-appear'}});
  const state = new OwnerSessionState({client});
  const opened = await state.open(permit());
  const signed = await state.authorize(action(0), 'challenge');
  const output = JSON.stringify({opened, signed});
  assert.equal(output.includes('must-never-appear'), false);
  assert.equal(/private[_-]?key|seblob|credential/i.test(output), false);
  await state.close();
});

test('K: malformed and extra-field JSONL responses fail closed', async (t) => {
  for (const mode of ['malformed', 'extra_field']) {
    await t.test(mode, async () => {
      const {client} = await fixture({env: {FAKE_ISSUER_MODE: mode}});
      await assert.rejects(client.openSession(permit()), /ISSUER_PROTOCOL_INVALID/);
      await assert.rejects(client.openSession(permit()), /CLIENT_CLOSED/);
    });
  }
});

test('L: issuer and capability pins reject drift on isolated fixtures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'owner-session-pins-'));
  const issuer = path.join(directory, 'issuer.bin');
  const manifest = path.join(directory, 'capability.json');
  await writeFile(issuer, 'fixture issuer', {mode: 0o600});
  await writeFile(manifest, '{"fixture":true}\n', {mode: 0o600});
  await assert.rejects(validateIssuerPin(issuer), /ISSUER_SHA256_MISMATCH/);
  await assert.rejects(validateCapabilityManifestPin(manifest), /CAPABILITY_SHA256_MISMATCH/);
});

test('M: non-mutation GUI tools are rejected by the state layer', async () => {
  const {client} = await fixture();
  const state = new OwnerSessionState({client});
  await state.open(permit());
  await assert.rejects(
    state.authorize({...action(0), toolName: 'desktop_snapshot'}, 'challenge'),
    /ACTION_SCHEMA_INVALID/,
  );
  await state.close();
});


test('N: bounded helper permits six exact mutations and rejects the seventh', async () => {
  const {client} = await fixture();
  const state = new OwnerSessionState({client});
  await state.open(permit({maxOperations: 6}));
  for (let index = 0; index < 6; index += 1) {
    await state.authorize(action(index), 'challenge');
    await state.authorize(action(index), 'execution');
  }
  await assert.rejects(state.authorize(action(6), 'challenge'), /MAX_OPERATIONS_EXCEEDED/);
  await state.close();
});
