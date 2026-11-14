import {createHash, randomBytes} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import {OwnerSessionClient} from './owner-session-client.mjs';

const [home, issuerPath, capabilityManifestPath, issuerDirectory] = process.argv.slice(2);
if (!home?.startsWith('/') || !issuerPath?.startsWith('/') || !capabilityManifestPath?.startsWith('/') || !issuerDirectory?.startsWith('/')) {
  console.error('USAGE: node phase1-grok-auth.mjs <home> <issuerPath> <capabilityManifestPath> <issuerDirectory>');
  process.exit(2);
}

const nodeBin = '/opt/homebrew/opt/node@22/bin/node';
const guiRoot = path.join(home, '.local/share/jev-gui-permit-mcp');
const guiMain = path.join(guiRoot, 'main.mjs');
const signHelper = path.join(home, 'JEV-Workspace/Staging/webchat-direct-control-r1/sign-exact-review.mjs');
const jevMcp = path.join(home, '.local/bin/jev-mcp');
const windowPath = path.join(home, '.local/share/jev-gui-bridge/writes-window.json');
const bindPath = path.join(home, '.local/share/jev-central-gateway/gui-permit-bind.mjs');
const bridgePath = path.join(guiRoot, 'gui-bridge.mjs');
const appsPath = path.join(guiRoot, 'apps.mjs');
const discoverPath = path.join(guiRoot, 'catalog-discover.mjs');

const taskId = randomBytes(16).toString('hex');
const permitId = randomBytes(16).toString('hex');
const enc = (x) => Buffer.from(JSON.stringify(x), 'utf8').toString('base64');
const sha256 = (x) => createHash('sha256').update(x).digest('hex');

const capability = JSON.parse(readFileSync(capabilityManifestPath, 'utf8'));
if (capability?.id !== 'CAP_ENCONVO_GROK_R1'
  || capability?.target?.app !== 'EnConvo'
  || capability?.risk_level !== 'L3_GUI_WRITE'
  || capability?.owner_auth?.required !== true
  || capability?.owner_auth?.provider !== 'JEV_G6_OWNER_AUTH'
  || capability?.owner_auth?.once_per_task !== true
  || capability?.permanent_authorization !== false) {
  throw new Error('CAPABILITY_SCOPE_INVALID');
}

const {
  canonicalGuiArgs,
  guiActionDigest,
  guiTarget,
} = await import(bindPath);
const {
  verifyNativePin,
  writeWindow,
} = await import(bridgePath);
const {setIdentityContext} = await import(appsPath);
const {
  createDiscoveringProvider,
  parseNativeListApps,
} = await import(discoverPath);

const nativePin = verifyNativePin({});
if (!nativePin.ok) throw new Error('NATIVE_PIN_' + nativePin.code);
const discovery = createDiscoveringProvider({
  listApps: () => {
    const r = spawnSync(nativePin.bin, ['list-apps'], {
      encoding:'utf8',
      timeout:20000,
      env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'},
    });
    if (r.status !== 0) throw new Error('LIST_APPS_UNAVAILABLE');
    return parseNativeListApps(r.stdout);
  },
});
setIdentityContext({getCatalog:discovery.getCatalog, lookup:discovery.lookup, bindings:new Map()});
discovery.lookup('EnConvo');
const catalog = await discovery.getCatalog();

function createGuiRpc() {
  const child = spawn(nodeBin, [guiMain], {
    stdio:['pipe','pipe','pipe'],
    env:{
      ...process.env,
      HOME:home,
      PATH:'/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    },
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (x) => { stderr += x; });
  const rl = readline.createInterface({input:child.stdout, crlfDelay:Infinity});
  const pending = new Map();
  let nextId = 1;
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg);
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('GUI_RPC_TIMEOUT'));
    }, 30000);
    pending.set(id,{resolve,reject,timer});
    const req = {jsonrpc:'2.0',id,method};
    if (params !== undefined) req.params = params;
    child.stdin.write(JSON.stringify(req)+'\n', (err) => {
      if (!err) return;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error('GUI_RPC_WRITE_FAILED'));
    });
  });
  const close = async () => {
    child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
  return {call,close,getStderr:()=>stderr};
}

function payload(msg) {
  if (msg?.error) throw new Error('GUI_RPC_ERROR');
  const item = msg?.result?.content?.find?.((x)=>x?.type === 'text');
  if (!item?.text) throw new Error('GUI_PAYLOAD_MISSING');
  return JSON.parse(item.text);
}

async function typeSafeReview(toolName, args, draft, label) {
  const req = createRequire(import.meta.url);
  const base = path.join(home, '.local/lib/node_modules/@wonderwhy-er/desktop-commander');
  const sdk = (name) => { try { return req(name); } catch { return req(req.resolve(name,{paths:[base]})); } };
  const {Client} = sdk('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = sdk('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({name:'taskops-enconvo-phase1',version:'1.0.0'},{capabilities:{}});
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
    const isSnapshot = toolName === 'desktop_snapshot';
    r = await client.callTool({
      name:'jev_decide',
      arguments:{
        decision:'Should this exact '+toolName+' action for EnConvo proceed under the sealed G6 policy?',
        evidence:isSnapshot
          ? 'Exact read-only action: tool=desktop_snapshot; app=EnConvo; taskId='+taskId+'; actionDigest='+draft.actionDigest+'; target='+draft.target+'; environment=PRODUCTION; purpose='+label+'. No mutation payload, text input, credentials, file write, shell, launch, or unrelated action is supplied.'
          : 'Exact action purpose: click the visible EnConvo control named '+label+'. The action is one desktop_click only. The ref comes from the immediately preceding verified EnConvo snapshot. It is bound to snapshotDigest, target='+draft.target+', and actionDigest='+draft.actionDigest+'. No text input, credentials, file writes, shell execution, launch action, network action, or unrelated mutation is included. A fresh verified snapshot is required immediately after execution. Any mismatch or delivery uncertainty fails closed.',
        priorities:'Preserve Frozen G6 Core. Approve only the exact scoped action. Fail closed on ambiguity. No credential handling.',
        candidates:[
          {id:'approve',description:'Approve only this exact scoped '+toolName+' action.'},
          {id:'deny',description:'Deny this action.'},
        ],
        requirements:isSnapshot ? [
          'The action is limited to the exact supplied EnConvo target and action digest.',
          'The requested tool is desktop_snapshot and is read-only.',
          'The supplied snapshot arguments contain only app, taskId, and interactive=false; no text, ref, click, type, launch, credential, or mutation payload is supplied.',
        ] : [
          'The action is limited to one exact desktop_click in EnConvo.',
          'The click target is the visible '+label+' control from the immediately preceding verified snapshot and is bound to that snapshot digest.',
          'No text, credential, shell, file-write, launch, network, or unrelated mutation payload is present; a fresh verified snapshot is required immediately after execution.',
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
  const approveChecks = Array.isArray(obj?.checks)
    ? obj.checks.filter((x)=>x?.candidate === 'approve')
    : [];
  console.log('REVIEW '+toolName+' '+label+' selected='+String(rec?.selected)+' confidence='+String(rec?.confidence)+' approve_prob='+String(rec?.probabilities?.approve)+' checks='+approveChecks.map((x)=>x.answer).join(','));
  if (obj?.provider !== 'typesafe'
    || rec?.selected !== 'approve'
    || rec?.escaped !== false
    || typeof rec?.confidence !== 'number'
    || rec.confidence < 0.70
    || approveChecks.length !== 3
    || approveChecks.some((x)=>x.answer !== 'supported')) {
    throw new Error('JEV_NOT_APPROVED');
  }
  return obj;
}

function signExact(toolName, args, challenge, review) {
  const out = path.join(home, 'JEV-Workspace/Staging', 'phase1-review-'+randomBytes(8).toString('hex')+'.json');
  const r = spawnSync(nodeBin, [
    signHelper,
    taskId,
    toolName,
    enc(args),
    enc(challenge),
    enc(review),
    out,
  ], {
    encoding:'utf8',
    timeout:120000,
    env:{...process.env,HOME:home},
  });
  if (r.status !== 0) throw new Error('SIGN_EXACT_FAILED');
  return JSON.parse(readFileSync(out,'utf8'));
}

function walk(node, ancestors = [], out = []) {
  if (!node || typeof node !== 'object') return out;
  out.push({node,ancestors});
  const next = [...ancestors,node];
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child,next,out);
  }
  return out;
}

function clickable(node) {
  return typeof node?.ref_id === 'string'
    && Array.isArray(node?.available_actions)
    && node.available_actions.includes('Click')
    && !(Array.isArray(node.states) && node.states.includes('disabled'));
}

function visible(node) {
  return !(Array.isArray(node?.states) && node.states.includes('offscreen'));
}

function textOf(node) {
  return [node?.name,node?.description,node?.value].filter((x)=>typeof x === 'string').join(' | ');
}

function findControl(tree, patterns, label) {
  const entries = walk(tree);
  for (const pattern of patterns) {
    const matcher = typeof pattern === 'string'
      ? (s)=>s.split(' | ').some((part)=>part.trim().toLowerCase() === pattern.toLowerCase())
      : (s)=>pattern.test(s);
    const direct = entries.find(({node})=>visible(node) && clickable(node) && matcher(textOf(node)));
    if (direct) return direct.node;
    for (const entry of entries) {
      if (!matcher(textOf(entry.node))) continue;
      const ancestor = [...entry.ancestors].reverse().find((n)=>visible(n) && clickable(n));
      if (ancestor) return ancestor;
    }
  }
  throw new Error('CONTROL_NOT_FOUND_'+label);
}

const issued = Date.now();
const permit = {
  schema:'TASK_PERMIT_V1',
  permit_id:permitId,
  task_id:taskId,
  capability_id:capability.id,
  risk_level:capability.risk_level,
  issued_at:new Date(issued - 1_000).toISOString(),
  expires_at:new Date(issued + 300_000).toISOString(),
  max_operations:6,
  allowed_tools:[...capability.allowed_tools],
  allowed_apps:[...capability.allowed_apps],
  allowed_paths:[...capability.allowed_paths],
  allowed_operations:[...capability.allowed_operations],
  evidence_required:true,
  rollback_required:true,
  replay_protection:{...capability.replay_protection},
  task_owner_auth:{
    required:true,
    provider:capability.owner_auth.provider,
    once_per_task:true,
  },
};

const owner = new OwnerSessionClient({
  issuerPath,
  capabilityManifestPath,
  command:issuerPath,
  args:['--issuer-dir',issuerDirectory],
  requestTimeoutMs:120000,
  maxOutputBytes:65536,
});
const gui = createGuiRpc();
let writesOpen = false;
let mutationCount = 0;
let currentSnapshot = null;

async function snapshot(label) {
  const args = canonicalGuiArgs({app:'EnConvo',taskId,interactive:false});
  const first = payload(await gui.call('tools/call',{name:'desktop_snapshot',arguments:args}));
  if (first.code !== 'SIGNED_REVIEW_REQUIRED' || !first.productionReview?.claimDraft) {
    throw new Error('SNAPSHOT_CHALLENGE_INVALID');
  }
  const challenge = first.productionReview;
  const review = await typeSafeReview('desktop_snapshot',args,challenge.claimDraft,label);
  const productionReview = signExact('desktop_snapshot',args,challenge,review);
  const second = payload(await gui.call('tools/call',{
    name:'desktop_snapshot',
    arguments:{...args,productionReview},
  }));
  if (second.ok !== true || second.code !== 'EXECUTED' || !second.native?.data?.tree || !second.snapshotDigest) {
    throw new Error('SNAPSHOT_EXECUTION_FAILED');
  }
  currentSnapshot = second;
  console.log('SNAPSHOT '+label+' refs='+String(second.native.data.ref_count)+' digest='+second.snapshotDigest.slice(0,12));
  return second;
}

async function clickControl(control, label) {
  if (!currentSnapshot?.snapshotDigest) throw new Error('SNAPSHOT_REQUIRED');
  if (mutationCount >= 5) throw new Error('PHASE1_MUTATION_LIMIT');
  const args = canonicalGuiArgs({
    app:'EnConvo',
    taskId,
    ref:control.ref_id,
    snapshotDigest:currentSnapshot.snapshotDigest,
  });
  const actionDigest = guiActionDigest('desktop_click',args);
  const target = guiTarget({toolName:'desktop_click',args,actionDigest});
  const now = Date.now();
  const signed = await owner.signGrant(ownerSession.session_id,{
    version:1,
    grantId:randomBytes(16).toString('hex'),
    nonce:randomBytes(16).toString('hex'),
    toolName:'desktop_click',
    target,
    actionDigest,
    issuedMs:now,
    expiresMs:Math.min(now + 60_000, ownerSession.expires_ms),
  });
  const guiOwnerGrant = signed.grant;
  const first = payload(await gui.call('tools/call',{
    name:'desktop_click',
    arguments:{...args,guiOwnerGrant},
  }));
  if (first.code !== 'SIGNED_REVIEW_REQUIRED' || !first.productionReview?.claimDraft) {
    throw new Error('CLICK_CHALLENGE_INVALID_'+label+'_'+String(first.code));
  }
  const challenge = first.productionReview;
  const review = await typeSafeReview('desktop_click',args,challenge.claimDraft,label);
  const productionReview = signExact('desktop_click',args,challenge,review);
  const second = payload(await gui.call('tools/call',{
    name:'desktop_click',
    arguments:{...args,guiOwnerGrant,productionReview},
  }));
  if (second.ok !== true || second.code !== 'EXECUTED') {
    const nativeCode = String(
      second?.native?.error?.code ??
      second?.native?.code ??
      second?.native?.native?.error?.code ??
      second?.native?.native?.code ??
      'UNKNOWN'
    ).slice(0,120);
    console.log('CLICK_NATIVE_FAILURE label='+label+' outer='+String(second.code)+' native='+nativeCode);
    throw new Error('CLICK_EXECUTION_FAILED_'+label+'_'+String(second.code)+'_NATIVE_'+nativeCode);
  }
  mutationCount += 1;
  console.log('CLICK '+String(mutationCount)+' '+label+'=PASS');
  currentSnapshot = null;
}

let ownerSession;
try {
  const init = await gui.call('initialize');
  if (init?.result?.serverInfo?.name !== 'jev-gui-permit-mcp') throw new Error('GUI_SERVER_INVALID');

  console.log('OWNER_AUTH_REQUESTED=YES');
  ownerSession = await owner.openSession(permit);
  console.log('OWNER_SESSION_OPEN=PASS max='+String(ownerSession.max_operations));

  writeWindow({
    path:windowPath,
    enabled:true,
    apps:['EnConvo'],
    ttlMs:240_000,
    now:Date.now(),
    catalog,
  });
  writesOpen = true;
  console.log('WRITES_WINDOW=OPEN ttl=240s');

  let s = await snapshot('initial');
  let c = findControl(s.native.data.tree,['设置与帮助'], 'SETTINGS_HELP');
  await clickControl(c,'设置与帮助');

  s = await snapshot('after-settings-help');
  c = findControl(s.native.data.tree,['设置',/^设置$/i,/打开设置/], 'SETTINGS');
  await clickControl(c,'设置');

  s = await snapshot('settings-page');
  c = findControl(s.native.data.tree,[
    'Coding Agents',
    /coding agents/i,
    /编程智能体/,
    /编码智能体/,
    /编码代理/,
  ], 'CODING_AGENTS');
  await clickControl(c,'Coding Agents');

  s = await snapshot('coding-agents');
  c = findControl(s.native.data.tree,['Grok Build',/grok build/i], 'GROK_BUILD');
  await clickControl(c,'Grok Build');

  s = await snapshot('grok-build');
  const entries = walk(s.native.data.tree);
  const already = entries.some(({node})=>/sign out|logout|已登录|退出登录/i.test(textOf(node)));
  if (already) {
    console.log('GROK_BUILD_AUTH=ALREADY_SIGNED_IN');
    console.log('OAUTH_HANDOFF=NOT_NEEDED');
  } else {
    c = findControl(s.native.data.tree,['Sign In',/sign in/i,/登录 xai/i,/登录/i], 'SIGN_IN');
    await clickControl(c,'Sign In');
    console.log('GROK_BUILD_AUTH=SIGN_IN_CLICKED');
    console.log('OAUTH_HANDOFF=TRIGGERED');
  }

  console.log('PHASE1=PASS');
  console.log('TASK_ID='+taskId);
  console.log('MUTATIONS='+String(mutationCount));
  console.log('RAW_CREDENTIALS_READ=NO');
  console.log('PRODUCTION_CODE_CHANGE=NO');
} finally {
  if (writesOpen) {
    try {
      writeWindow({path:windowPath,enabled:false,now:Date.now()});
      console.log('WRITES_WINDOW=CLOSED');
    } catch {
      console.log('WRITES_WINDOW=CLOSE_FAILED');
    }
  }
  try { await owner.close(); } catch {}
  try { await gui.close(); } catch {}
}
