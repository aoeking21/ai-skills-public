import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export const ISSUER_SHA256 = '3c7bbc59ac399b809fd46d2a29aad34ab57bfb1105a850effd6e2fc3d8c927a8';
export const CAPABILITY_SHA256 = '229e947495f44eb6652fce39dd14f074202f154bbe7d929b3c892ee6ec007122';
export const MAX_SESSION_MS = 300_000;
export const MAX_OPERATIONS = 6;

const H32 = /^[a-f0-9]{32}$/;
const H64 = /^[a-f0-9]{64}$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const OPEN_KEYS = ['ok','code','session_id','task_id','permit_id','expires_ms','max_operations','private_key_exportable'];
const SIGN_KEYS = ['ok','code','session_id','task_id','permit_id','remaining_operations','grant'];
const CLAIM_KEYS = ['version','grantId','nonce','toolName','target','actionDigest','issuedMs','expiresMs'];
const MUTATION_TOOLS = new Set(['desktop_click','desktop_type','desktop_launch']);

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function validateIssuerPin(file, expected = ISSUER_SHA256) {
  const actual = await sha256File(file);
  if (actual !== expected) fail('ISSUER_SHA256_MISMATCH');
  return {ok: true, sha256: actual};
}

export async function validateCapabilityManifestPin(file, expected = CAPABILITY_SHA256) {
  const actual = await sha256File(file);
  if (actual !== expected) fail('CAPABILITY_SHA256_MISMATCH');
  return {ok: true, sha256: actual};
}

function validOpenResponse(value) {
  return exactKeys(value, OPEN_KEYS)
    && value.ok === true
    && value.code === 'OWNER_SESSION_OPEN'
    && H32.test(value.session_id || '')
    && H32.test(value.task_id || '')
    && H32.test(value.permit_id || '')
    && Number.isSafeInteger(value.expires_ms)
    && Number.isSafeInteger(value.max_operations)
    && value.max_operations >= 1
    && value.max_operations <= MAX_OPERATIONS
    && value.private_key_exportable === false;
}

function validClaim(claim) {
  return exactKeys(claim, CLAIM_KEYS)
    && claim.version === 1
    && H32.test(claim.grantId || '')
    && H32.test(claim.nonce || '')
    && MUTATION_TOOLS.has(claim.toolName)
    && typeof claim.target === 'string'
    && /^\/gui\/EnConvo\/\S{1,1000}$/.test(claim.target)
    && H64.test(claim.actionDigest || '')
    && Number.isSafeInteger(claim.issuedMs)
    && Number.isSafeInteger(claim.expiresMs)
    && claim.expiresMs > claim.issuedMs;
}

function validSignResponse(value) {
  return exactKeys(value, SIGN_KEYS)
    && value.ok === true
    && value.code === 'GUI_OWNER_GRANT_SIGNED'
    && H32.test(value.session_id || '')
    && H32.test(value.task_id || '')
    && H32.test(value.permit_id || '')
    && Number.isSafeInteger(value.remaining_operations)
    && value.remaining_operations >= 0
    && value.remaining_operations <= MAX_OPERATIONS
    && value.grant
    && exactKeys(value.grant, ['claim','signatureDERBase64'])
    && validClaim(value.grant.claim)
    && typeof value.grant.signatureDERBase64 === 'string'
    && B64.test(value.grant.signatureDERBase64)
    && Buffer.from(value.grant.signatureDERBase64, 'base64').length > 0;
}

function isIssuerError(value) {
  return exactKeys(value, ['ok','code'])
    && value.ok === false
    && typeof value.code === 'string'
    && /^[A-Z0-9_]{3,128}$/.test(value.code);
}

export class OwnerSessionClient {
  #issuerPath;
  #capabilityManifestPath;
  #issuerSha256;
  #capabilityManifestSha256;
  #command;
  #args;
  #env;
  #requestTimeoutMs;
  #maxOutputBytes;
  #child = null;
  #pending = null;
  #stdoutBuffer = '';
  #closed = false;
  #starting = null;

  constructor({
    issuerPath,
    capabilityManifestPath,
    issuerSha256 = ISSUER_SHA256,
    capabilityManifestSha256 = CAPABILITY_SHA256,
    command = issuerPath,
    args = [],
    env = process.env,
    requestTimeoutMs = 5_000,
    maxOutputBytes = 65_536,
  }) {
    if (typeof issuerPath !== 'string' || typeof capabilityManifestPath !== 'string') fail('CLIENT_CONFIG_INVALID');
    if (typeof command !== 'string' || !Array.isArray(args)
        || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1
        || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 256) {
      fail('CLIENT_CONFIG_INVALID');
    }
    this.#issuerPath = issuerPath;
    this.#capabilityManifestPath = capabilityManifestPath;
    this.#issuerSha256 = issuerSha256;
    this.#capabilityManifestSha256 = capabilityManifestSha256;
    this.#command = command;
    this.#args = [...args];
    this.#env = {...env};
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#maxOutputBytes = maxOutputBytes;
  }

  async #ensureStarted() {
    if (this.#closed) fail('CLIENT_CLOSED');
    if (this.#child) return;
    if (this.#starting) return this.#starting;
    this.#starting = (async () => {
      await validateIssuerPin(this.#issuerPath, this.#issuerSha256);
      await validateCapabilityManifestPin(this.#capabilityManifestPath, this.#capabilityManifestSha256);
      if (this.#closed) fail('CLIENT_CLOSED');
      const child = spawn(this.#command, this.#args, {
        env: this.#env,
        stdio: ['pipe','pipe','pipe'],
      });
      this.#child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this.#onStdout(chunk));
      let stderrBytes = 0;
      child.stderr.on('data', (chunk) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > this.#maxOutputBytes) this.#protocolFailure('ISSUER_OUTPUT_LIMIT_EXCEEDED');
      });
      child.on('error', () => this.#protocolFailure('ISSUER_PROCESS_FAILED'));
      child.on('exit', () => {
        if (!this.#closed) this.#protocolFailure('ISSUER_PROCESS_EXITED');
      });
    })();
    try {
      await this.#starting;
    } finally {
      this.#starting = null;
    }
  }

  #onStdout(chunk) {
    if (this.#closed) return;
    this.#stdoutBuffer += chunk;
    if (Buffer.byteLength(this.#stdoutBuffer) > this.#maxOutputBytes) {
      this.#protocolFailure('ISSUER_OUTPUT_LIMIT_EXCEEDED');
      return;
    }
    for (;;) {
      const index = this.#stdoutBuffer.indexOf('\n');
      if (index < 0) break;
      const line = this.#stdoutBuffer.slice(0, index);
      this.#stdoutBuffer = this.#stdoutBuffer.slice(index + 1);
      if (!line || !this.#pending) {
        this.#protocolFailure('ISSUER_PROTOCOL_INVALID');
        return;
      }
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        this.#protocolFailure('ISSUER_PROTOCOL_INVALID');
        return;
      }
      const pending = this.#pending;
      this.#pending = null;
      clearTimeout(pending.timer);

      if (isIssuerError(value)) {
        pending.reject(new Error(value.code));
        continue;
      }
      const valid = pending.kind === 'open' ? validOpenResponse(value) : validSignResponse(value);
      if (!valid) {
        pending.reject(new Error('ISSUER_PROTOCOL_INVALID'));
        void this.#terminate();
        return;
      }
      if (pending.kind === 'open') {
        pending.resolve({
          ok: true,
          code: value.code,
          session_id: value.session_id,
          task_id: value.task_id,
          permit_id: value.permit_id,
          expires_ms: value.expires_ms,
          max_operations: value.max_operations,
        });
      } else {
        pending.resolve({
          ok: true,
          code: value.code,
          session_id: value.session_id,
          task_id: value.task_id,
          permit_id: value.permit_id,
          remaining_operations: value.remaining_operations,
          grant: {
            claim: {...value.grant.claim},
            signatureDERBase64: value.grant.signatureDERBase64,
          },
        });
      }
    }
  }

  #protocolFailure(code) {
    if (this.#closed) return;
    const pending = this.#pending;
    this.#pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(code));
    }
    void this.#terminate();
  }

  async #terminate() {
    if (this.#closed) return;
    this.#closed = true;
    const child = this.#child;
    this.#child = null;
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch {}
    }
  }

  async #request(kind, payload) {
    if (this.#closed) fail('CLIENT_CLOSED');
    await this.#ensureStarted();
    if (this.#closed || !this.#child) fail('CLIENT_CLOSED');
    if (this.#pending) {
      await this.#terminate();
      fail('REQUEST_ALREADY_PENDING');
    }
    const encoded = JSON.stringify(payload);
    if (Buffer.byteLength(encoded) > this.#maxOutputBytes) {
      await this.#terminate();
      fail('ISSUER_OUTPUT_LIMIT_EXCEEDED');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending) return;
        this.#pending = null;
        reject(new Error('ISSUER_TIMEOUT'));
        void this.#terminate();
      }, this.#requestTimeoutMs);
      this.#pending = {kind, resolve, reject, timer};
      this.#child.stdin.write(encoded + '\n', (error) => {
        if (!error || !this.#pending) return;
        const pending = this.#pending;
        this.#pending = null;
        clearTimeout(pending.timer);
        pending.reject(new Error('ISSUER_WRITE_FAILED'));
        void this.#terminate();
      });
    });
  }

  async openSession(permit) {
    return this.#request('open', {command: 'open_session', permit});
  }

  async signGrant(sessionId, grant) {
    return this.#request('sign', {command: 'sign_grant', session_id: sessionId, grant});
  }

  async close() {
    if (this.#closed) return;
    const pending = this.#pending;
    this.#pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CLIENT_CLOSED'));
    }
    await this.#terminate();
  }
}
