import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const mode = process.env.FAKE_ISSUER_MODE ?? 'normal';
const logPath = process.env.FAKE_ISSUER_LOG;
const sessionId = '11111111111111111111111111111111';
let operationCount = 0;
let maxOperations = 4;

function record(command) {
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify({pid: process.pid, command})}\n`, {mode: 0o600});
}

function emit(response) {
  if (mode === 'malformed') {
    process.stdout.write('{not-json}\n');
    return;
  }
  const value = mode === 'extra_field' ? {...response, unexpected: true} : response;
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

createInterface({input: process.stdin, crlfDelay: Infinity}).on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    emit({ok: false, code: 'JSON_LINE_INVALID'});
    return;
  }
  record(request.command);

  if (request.command === 'open_session') {
    maxOperations = request.permit.max_operations;
    emit({
      ok: true,
      code: 'OWNER_SESSION_OPEN',
      session_id: sessionId,
      task_id: request.permit.task_id,
      permit_id: request.permit.permit_id,
      expires_ms: Math.min(Date.parse(request.permit.expires_at), Date.now() + 300_000),
      max_operations: maxOperations,
      private_key_exportable: false,
    });
    return;
  }

  if (request.command === 'sign_grant') {
    if (request.session_id !== sessionId) {
      emit({ok: false, code: 'SIGN_GRANT_SCHEMA_INVALID'});
      return;
    }
    if (operationCount >= maxOperations) {
      emit({ok: false, code: 'MAX_OPERATIONS_EXCEEDED'});
      return;
    }
    operationCount += 1;
    emit({
      ok: true,
      code: 'GUI_OWNER_GRANT_SIGNED',
      session_id: sessionId,
      task_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      permit_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      remaining_operations: maxOperations - operationCount,
      grant: {
        claim: request.grant,
        signatureDERBase64: Buffer.from(`fake-signature-${operationCount}`).toString('base64'),
      },
    });
    return;
  }

  emit({ok: false, code: 'COMMAND_DENIED'});
});
