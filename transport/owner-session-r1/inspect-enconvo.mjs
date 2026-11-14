import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const [home, taskId] = process.argv.slice(2);
if (!home || !home.startsWith('/') || !/^[a-f0-9]{32}$/.test(taskId || '')) {
  console.error('USAGE: node inspect-enconvo.mjs <home> <taskId>');
  process.exit(2);
}

const nodeBin = '/opt/homebrew/opt/node@22/bin/node';
const guiMain = path.join(home, '.local/share/jev-gui-permit-mcp/main.mjs');
const signHelper = path.join(home, 'JEV-Workspace/Staging/webchat-direct-control-r1/sign-exact-review.mjs');
const jevMcp = path.join(home, '.local/bin/jev-mcp');
const work = mkdtempSync(path.join(tmpdir(), 'jev-enconvo-inspect-'));
const reviewOut = path.join(work, 'snapshot.production-review.json');
const snapshotOut = path.join(work, 'snapshot.json');

const enc = (x) => Buffer.from(JSON.stringify(x), 'utf8').toString('base64');

function createJsonRpcProcess() {
  const child = spawn(nodeBin, [guiMain], {
    stdio: ['pipe','pipe','pipe'],
    env: {
      ...process.env,
      HOME: home,
      PATH: '/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    },
  });
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const rl = readline.createInterface({input: child.stdout, crlfDelay: Infinity});
  const pending = new Map();
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    p.resolve(msg);
  });
  let nextId = 1;
  const call = (method, params = undefined) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('GUI_RPC_TIMEOUT'));
    }, 30000);
    pending.set(id, {
      resolve: (msg) => { clearTimeout(timer); resolve(msg); },
    });
    const req = {jsonrpc:'2.0', id, method};
    if (params !== undefined) req.params = params;
    child.stdin.write(JSON.stringify(req) + '\n', (err) => {
      if (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  });
  const close = async () => {
    child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  };
  return {child, call, close, getStderr:()=>stderr};
}

function parseToolPayload(msg) {
  if (msg?.error) throw new Error('GUI_RPC_ERROR_' + JSON.stringify(msg.error));
  const item = msg?.result?.content?.find?.((x)=>x?.type==='text');
  if (!item?.text) throw new Error('GUI_TOOL_PAYLOAD_MISSING');
  return JSON.parse(item.text);
}

async function jevReview(args, draft) {
  const req = createRequire(import.meta.url);
  const base = path.join(home, '.local/lib/node_modules/@wonderwhy-er/desktop-commander');
  const sdk = (name) => { try { return req(name); } catch { return req(req.resolve(name,{paths:[base]})); } };
  const {Client} = sdk('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = sdk('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({name:'taskops-enconvo-inspector',version:'1.0.0'},{capabilities:{}});
  const transport = new StdioClientTransport({
    command:'/bin/zsh',
    args:[jevMcp],
    stderr:'pipe',
    env:{
      ...process.env,
      HOME:home,
      PATH:'/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    },
  });
  await client.connect(transport);
  let r;
  try {
    r = await client.callTool({
      name:'jev_decide',
      arguments:{
        decision:'Should this exact desktop_snapshot action for EnConvo proceed under the sealed G6 policy?',
        evidence:'Exact action: tool=desktop_snapshot; app=EnConvo; taskId='+taskId+'; actionDigest='+draft.actionDigest+'; target='+draft.target+'; operationClass=gui; environment=PRODUCTION. This action is read-only and does not mutate application or file state.',
        priorities:'Preserve Frozen G6 Core. Fail closed on ambiguity. Approve only the exact bound read-only action. No credential exposure. No unrelated mutation.',
        candidates:[
          {id:'approve',description:'Approve only this exact scoped desktop_snapshot action.'},
          {id:'deny',description:'Deny this action.'},
        ],
        requirements:[
          'The action is limited to the exact supplied EnConvo target and action digest.',
          'The action is read-only and does not mutate application or system state.',
          'The action does not require reading or outputting raw credentials.',
        ],
        escape_hatches:false,
        escalate_on_contradiction:true,
      },
    });
  } finally {
    try { await client.close(); } catch {}
  }
  const obj = r?.structuredContent && typeof r.structuredContent === 'object'
    ? r.structuredContent
    : JSON.parse(r.content.find((x)=>x.type==='text').text);
  const rec = obj?.recommendation;
  if (obj?.provider!=='typesafe' || rec?.selected!=='approve' || rec?.escaped!==false
      || typeof rec?.confidence!=='number' || rec.confidence<0.70) {
    throw new Error('JEV_NOT_APPROVED');
  }
  if (!Array.isArray(obj.checks) || obj.checks.some((x)=>x.candidate==='approve' && x.answer!=='supported')) {
    throw new Error('JEV_REQUIREMENT_NOT_SUPPORTED');
  }
  return obj;
}

const gui = createJsonRpcProcess();
try {
  const init = await gui.call('initialize');
  if (init?.result?.serverInfo?.name !== 'jev-gui-permit-mcp') throw new Error('GUI_SERVER_INVALID');

  const args = {app:'EnConvo', taskId, interactive:false};
  const firstMsg = await gui.call('tools/call',{name:'desktop_snapshot',arguments:args});
  const first = parseToolPayload(firstMsg);
  if (first.code !== 'SIGNED_REVIEW_REQUIRED' || !first.productionReview?.issuerId || !first.productionReview?.claimDraft) {
    throw new Error('SNAPSHOT_CHALLENGE_INVALID');
  }

  const challenge = first.productionReview;
  const review = await jevReview(args, challenge.claimDraft);
  const signed = spawnSync(nodeBin, [
    signHelper,
    taskId,
    'desktop_snapshot',
    enc(args),
    enc(challenge),
    enc(review),
    reviewOut,
  ], {encoding:'utf8', timeout:120000, env:{...process.env,HOME:home}});
  if (signed.status !== 0) {
    throw new Error('SIGN_EXACT_FAILED:' + (signed.stderr || signed.stdout || '').slice(0,500));
  }
  const productionReview = JSON.parse(readFileSync(reviewOut,'utf8'));

  const secondMsg = await gui.call('tools/call',{
    name:'desktop_snapshot',
    arguments:{...args, productionReview},
  });
  const second = parseToolPayload(secondMsg);
  if (second.ok !== true || second.code !== 'EXECUTED') {
    throw new Error('SNAPSHOT_EXECUTION_FAILED:' + JSON.stringify(second).slice(0,1000));
  }

  await import('node:fs/promises').then(({writeFile})=>
    writeFile(snapshotOut, JSON.stringify(second,null,2)+'\n', {mode:0o600})
  );
  const native = second.native || {};
  console.log('INSPECT=PASS');
  console.log('SNAPSHOT_CODE=' + second.code);
  console.log('APP=' + (second.app || args.app));
  console.log('TASK_ID=' + taskId);
  console.log('REF_COUNT=' + (native.ref_count ?? 'UNKNOWN'));
  console.log('SNAPSHOT_ID=' + (native.snapshot_id ?? 'UNKNOWN'));
  console.log('SNAPSHOT_DIGEST=' + (second.snapshotDigest ?? 'UNKNOWN'));
  console.log('OUTPUT=' + snapshotOut);
  console.log('PRODUCTION_CHANGE=NO');
} finally {
  await gui.close();
}
