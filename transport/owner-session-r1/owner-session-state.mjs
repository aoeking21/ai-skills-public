import {randomBytes} from 'node:crypto';
import {MAX_OPERATIONS, MAX_SESSION_MS} from './owner-session-client.mjs';

const CAPABILITY_ID = 'CAP_ENCONVO_GROK_R1';
const MUTATION_TOOLS = new Set(['desktop_click','desktop_type','desktop_launch']);
const H64 = /^[a-f0-9]{64}$/;

function failure(code) {
  return new Error(code);
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function actionKey(action) {
  return JSON.stringify([action.toolName, action.target, action.actionDigest]);
}

function validateAction(action, permit) {
  if (!exactKeys(action, ['toolName', 'target', 'actionDigest'])
    || !MUTATION_TOOLS.has(action.toolName)
    || typeof action.target !== 'string'
    || !H64.test(action.actionDigest)) {
    throw failure('ACTION_SCHEMA_INVALID');
  }
  if (!permit.allowed_tools.includes(action.toolName)
    || !/^\/gui\/EnConvo\/\S{1,1000}$/.test(action.target)) {
    throw failure('ENCONVO_SCOPE_REQUIRED');
  }
}

function validatePermit(permit, now) {
  const issuedMs = Date.parse(permit?.issued_at);
  const permitExpiresMs = Date.parse(permit?.expires_at);
  if (permit?.schema !== 'TASK_PERMIT_V1'
    || permit.capability_id !== CAPABILITY_ID
    || !Array.isArray(permit.allowed_apps)
    || permit.allowed_apps.length !== 1
    || permit.allowed_apps[0] !== 'EnConvo'
    || !Array.isArray(permit.allowed_tools)
    || permit.evidence_required !== true
    || permit.rollback_required !== true
    || permit.replay_protection?.mode !== 'ONE_SHOT_OPERATION_ID'
    || permit.replay_protection?.deny_duplicates !== true
    || permit.task_owner_auth?.required !== true
    || permit.task_owner_auth?.provider !== 'JEV_G6_OWNER_AUTH'
    || permit.task_owner_auth?.once_per_task !== true) {
    throw failure('ENCONVO_SCOPE_REQUIRED');
  }
  if (!Number.isInteger(permit.max_operations)
    || permit.max_operations < 1
    || permit.max_operations > MAX_OPERATIONS) {
    throw failure('MAX_OPERATIONS_EXCEEDED');
  }
  if (!Number.isFinite(issuedMs)
    || !Number.isFinite(permitExpiresMs)
    || issuedMs > now
    || permitExpiresMs <= now) {
    throw failure('SESSION_EXPIRED');
  }
  return {permitExpiresMs};
}

export class OwnerSessionState {
  constructor({client, now = Date.now}) {
    this.client = client;
    this.now = now;
    this.revoked = false;
    this.opened = false;
    this.sessionId = null;
    this.expiresMs = 0;
    this.maxOperations = 0;
    this.grantCount = 0;
    this.permit = null;
    this.pending = new Map();
    this.spent = new Set();
  }

  async #revoke() {
    this.revoked = true;
    this.pending.clear();
    try {
      await this.client.close();
    } catch {}
  }

  #available() {
    if (this.revoked) throw failure('SESSION_REVOKED');
    if (!this.opened) throw failure('SESSION_NOT_OPEN');
  }

  async #checkExpiry() {
    this.#available();
    if (this.now() >= this.expiresMs) {
      await this.#revoke();
      throw failure('SESSION_EXPIRED');
    }
  }

  async open(permit) {
    if (this.revoked) throw failure('SESSION_REVOKED');
    if (this.opened) throw failure('SESSION_ALREADY_OPEN');
    const now = this.now();
    const {permitExpiresMs} = validatePermit(permit, now);
    try {
      const response = await this.client.openSession(permit);
      const expiresMs = Math.min(permitExpiresMs, response.expires_ms, now + MAX_SESSION_MS);
      if (response.task_id !== permit.task_id
        || response.permit_id !== permit.permit_id
        || response.max_operations > permit.max_operations
        || response.max_operations < 1
        || expiresMs <= now) {
        throw failure('ISSUER_PROTOCOL_INVALID');
      }
      this.permit = permit;
      this.sessionId = response.session_id;
      this.expiresMs = expiresMs;
      this.maxOperations = Math.min(permit.max_operations, response.max_operations, MAX_OPERATIONS);
      this.opened = true;
      return {...response, expires_ms: expiresMs, max_operations: this.maxOperations};
    } catch (error) {
      await this.#revoke();
      throw error;
    }
  }

  async authorize(action, phase) {
    await this.#checkExpiry();
    validateAction(action, this.permit);
    const key = actionKey(action);

    if (phase === 'challenge') {
      if (this.spent.has(key)) throw failure('ACTION_ALREADY_SPENT');
      if (this.pending.has(key)) return this.pending.get(key);
      if (this.grantCount >= this.maxOperations) throw failure('MAX_OPERATIONS_EXCEEDED');
      const issuedMs = this.now();
      const claim = {
        version: 1,
        grantId: randomBytes(16).toString('hex'),
        nonce: randomBytes(16).toString('hex'),
        toolName: action.toolName,
        target: action.target,
        actionDigest: action.actionDigest,
        issuedMs,
        expiresMs: Math.min(issuedMs + 60_000, this.expiresMs),
      };
      try {
        const signed = await this.client.signGrant(this.sessionId, claim);
        if (signed.session_id !== this.sessionId
          || signed.task_id !== this.permit.task_id
          || signed.permit_id !== this.permit.permit_id
          || actionKey(signed.grant.claim) !== key) {
          throw failure('ISSUER_PROTOCOL_INVALID');
        }
        this.grantCount += 1;
        this.pending.set(key, signed);
        return signed;
      } catch (error) {
        await this.#revoke();
        throw error;
      }
    }

    if (phase === 'execution') {
      const signed = this.pending.get(key);
      if (!signed) {
        await this.#revoke();
        throw failure('ACTION_BINDING_MISMATCH');
      }
      this.pending.delete(key);
      this.spent.add(key);
      return signed;
    }

    throw failure('AUTHORIZATION_PHASE_INVALID');
  }

  async markUncertainDelivery(action) {
    await this.#checkExpiry();
    validateAction(action, this.permit);
    await this.#revoke();
  }

  async close() {
    await this.#revoke();
  }
}
