import {createHash, randomBytes, verify} from 'node:crypto';
import {chmodSync, existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import readline from 'node:readline';

const ENROLL_SHA='e49a3daf62cd3385670bc0a5e4af893d61487adebe56a364254679b73470f4b4';
const SIGN_SHA='a3bb97853fe7866569d7815a15f12f28bcdcd3726a3efe62d2beae1991c28102';
const H32=/^[a-f0-9]{32}$/;
const H64=/^[a-f0-9]{64}$/;
const sha256=(x)=>createHash('sha256').update(x).digest('hex');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function fail(c){throw Error(c)}
function exact(o,ks,c){
  if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).sort().join('|')!==[...ks].sort().join('|'))fail(c);
}
function pinned(p,h,c){
  const st=lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||realpathSync(p)!==p||sha256(readFileSync(p))!==h)fail(c);
}
function payload(msg){
  if(msg?.error)throw Error('GUI_RPC_ERROR_'+String(msg.error.code||'UNKNOWN'));
  const item=msg?.result?.content?.find?.(x=>x?.type==='text');
  if(!item?.text)throw Error('GUI_PAYLOAD_MISSING');
  return JSON.parse(item.text);
}
function walk(node,ancestors=[],out=[]){
  if(!node||typeof node!=='object')return out;
  out.push({node,ancestors});
  const next=[...ancestors,node];
  if(Array.isArray(node.children))for(const child of node.children)walk(child,next,out);
  return out;
}
function norm(s){return String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase()}
function textOf(n){return [n?.name,n?.description,n?.value].filter(x=>typeof x==='string').join(' | ')}
function visible(n){return !(Array.isArray(n?.states)&&n.states.includes('offscreen'))}
function clickable(n){return typeof n?.ref_id==='string'&&Array.isArray(n?.available_actions)&&n.available_actions.includes('Click')&&!(Array.isArray(n.states)&&n.states.includes('disabled'))}
function matcherFor(p){
  if(p instanceof RegExp)return s=>p.test(s);
  const q=norm(p);
  return s=>String(s).split(' | ').some(part=>norm(part)===q)||norm(s).includes(q);
}
function findControl(tree,patterns,label,{roles=null}={}){
  const entries=walk(tree);
  for(const pattern of patterns){
    const match=matcherFor(pattern);
    const direct=entries.filter(({node})=>visible(node)&&clickable(node)&&match(textOf(node))&&(!roles||roles.includes(node.role)));
    if(direct.length===1)return direct[0].node;
    if(direct.length>1){
      const exactMatches=direct.filter(({node})=>String(node.name||'').trim().toLowerCase()===String(pattern).toLowerCase());
      if(exactMatches.length===1)return exactMatches[0].node;
      fail('CONTROL_AMBIGUOUS_'+label);
    }
    const lifted=[];
    for(const entry of entries){
      if(!match(textOf(entry.node)))continue;
      const a=[...entry.ancestors].reverse().find(n=>visible(n)&&clickable(n)&&(!roles||roles.includes(n.role)));
      if(a&&!lifted.includes(a))lifted.push(a);
    }
    if(lifted.length===1)return lifted[0];
    if(lifted.length>1)fail('CONTROL_AMBIGUOUS_'+label);
  }
  fail('CONTROL_NOT_FOUND_'+label);
}
function hasText(tree,patterns){
  const entries=walk(tree);
  return patterns.some(p=>{
    const m=matcherFor(p);
    return entries.some(({node})=>visible(node)&&m(textOf(node)));
  });
}
function findField(tree,patterns,label){
  const entries=walk(tree);
  const fieldRole=n=>['textfield','textbox','text area','textarea','searchfield','combobox'].includes(String(n?.role||'').toLowerCase());
  for(const pattern of patterns){
    const match=matcherFor(pattern);
    const direct=entries.filter(({node})=>visible(node)&&fieldRole(node)&&typeof node.ref_id==='string'&&match(textOf(node)));
    if(direct.length===1)return direct[0].node;
    if(direct.length>1)fail('FIELD_AMBIGUOUS_'+label);
    for(let i=0;i<entries.length;i++){
      if(!match(textOf(entries[i].node)))continue;
      for(let j=i+1;j<Math.min(entries.length,i+10);j++){
        const n=entries[j].node;
        if(visible(n)&&fieldRole(n)&&typeof n.ref_id==='string')return n;
      }
    }
  }
  fail('FIELD_NOT_FOUND_'+label);
}

function createGuiRpc({home,nodeBin,guiMain}){
  const child=spawn(nodeBin,[guiMain],{stdio:['pipe','pipe','pipe'],env:{...process.env,HOME:home,PATH:'/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  let stderr='';child.stderr.on('data',x=>{stderr=(stderr+x).slice(-20000)});
  const rl=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
  const pending=new Map();let nextId=1;
  rl.on('line',line=>{let msg;try{msg=JSON.parse(line)}catch{return}const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);clearTimeout(p.timer);p.resolve(msg)});
  child.on('exit',()=>{for(const [id,p] of pending){clearTimeout(p.timer);p.reject(Error('GUI_RPC_EXITED'));pending.delete(id)}});
  const call=(method,params,timeout=45000)=>new Promise((resolve,reject)=>{
    const id=nextId++;const timer=setTimeout(()=>{pending.delete(id);reject(Error('GUI_RPC_TIMEOUT'))},timeout);
    pending.set(id,{resolve,reject,timer});const req={jsonrpc:'2.0',id,method};if(params!==undefined)req.params=params;
    child.stdin.write(JSON.stringify(req)+'\n',err=>{if(!err)return;const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(timer);reject(Error('GUI_RPC_WRITE_FAILED'))});
  });
  const close=async()=>{try{child.stdin.end()}catch{};await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2500)]);if(child.exitCode===null)try{child.kill('SIGTERM')}catch{}};
  return {call,close,getStderr:()=>stderr};
}

async function createTypeSafeClient({home}){
  const req=createRequire(import.meta.url);
  const base=path.join(home,'.local/lib/node_modules/@wonderwhy-er/desktop-commander');
  const sdk=name=>{try{return req(name)}catch{return req(req.resolve(name,{paths:[base]}))}};
  const {Client}=sdk('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport}=sdk('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'taskops-enconvo-grok-oneshot',version:'2.0.0'},{capabilities:{}});
  const transport=new StdioClientTransport({command:'/bin/zsh',args:[path.join(home,'.local/bin/jev-mcp')],stderr:'pipe',env:{...process.env,HOME:home,PATH:'/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}});
  await client.connect(transport);
  return client;
}

export async function createG6GuiSession({home,workDir,runtime,issuerDirectory}){
  const nodeBin='/opt/homebrew/opt/node@22/bin/node';
  const guiRoot=path.join(home,'.local/share/jev-gui-permit-mcp');
  const guiMain=path.join(guiRoot,'main.mjs');
  const windowPath=path.join(home,'.local/share/jev-gui-bridge/writes-window.json');
  const bindPath=path.join(home,'.local/share/jev-central-gateway/gui-permit-bind.mjs');
  const bridgePath=path.join(guiRoot,'gui-bridge.mjs');
  const appsPath=path.join(guiRoot,'apps.mjs');
  const discoverPath=path.join(guiRoot,'catalog-discover.mjs');
  const reviewPath=path.join(home,'.local/share/jev-central-gateway/production-review.mjs');
  const enrollPath=path.join(home,'.config/jev-owner/production-brain/r7-production-trust.json');
  const signBin=path.join(home,'.local/share/jev-gui-bridge/g6-sign');
  pinned(enrollPath,ENROLL_SHA,'ENROLL_DRIFT');pinned(signBin,SIGN_SHA,'SIGNER_DRIFT');

  const {canonicalGuiArgs,guiActionDigest,guiTarget}=await import(bindPath);
  const {verifyNativePin,writeWindow}=await import(bridgePath);
  const {setIdentityContext}=await import(appsPath);
  const {createDiscoveringProvider,parseNativeListApps}=await import(discoverPath);
  const {parseEnrollment,productionReviewBytes}=await import(reviewPath);
  const nativePin=verifyNativePin({});
  if(!nativePin.ok)fail('NATIVE_PIN_'+nativePin.code);
  const discovery=createDiscoveringProvider({listApps:()=>{
    const r=spawnSync(nativePin.bin,['list-apps'],{encoding:'utf8',timeout:20000,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});
    if(r.status!==0)fail('LIST_APPS_UNAVAILABLE');
    return parseNativeListApps(r.stdout);
  }});
  setIdentityContext({getCatalog:discovery.getCatalog,lookup:discovery.lookup,bindings:new Map()});
  discovery.lookup('EnConvo');discovery.lookup('Grok Bot');
  const catalog=await discovery.getCatalog();
  const gui=createGuiRpc({home,nodeBin,guiMain});
  const typeSafe=await createTypeSafeClient({home});
  const taskId=randomBytes(16).toString('hex'),permitId=randomBytes(16).toString('hex');
  const issued=Date.now();
  const permit={
    schema:'TASK_PERMIT_V1',permit_id:permitId,task_id:taskId,capability_id:runtime.capability.id,risk_level:runtime.capability.risk_level,
    issued_at:new Date(issued-1000).toISOString(),expires_at:new Date(issued+runtime.MAX_SESSION_MS).toISOString(),max_operations:runtime.MAX_OPERATIONS,
    allowed_tools:[...runtime.capability.allowed_tools],allowed_apps:[...runtime.capability.allowed_apps],allowed_paths:[...runtime.capability.allowed_paths],
    allowed_operations:[...runtime.capability.allowed_operations],evidence_required:true,rollback_required:true,replay_protection:{...runtime.capability.replay_protection},
    task_owner_auth:{required:true,provider:runtime.capability.owner_auth.provider,once_per_task:true},
  };
  const owner=new runtime.OwnerSessionClient({issuerPath:runtime.issuerPath,capabilityManifestPath:runtime.capabilityPath,command:runtime.issuerPath,args:['--issuer-dir',issuerDirectory],requestTimeoutMs:120000,maxOutputBytes:65536});
  const init=await gui.call('initialize');
  if(init?.result?.serverInfo?.name!=='jev-gui-permit-mcp')fail('GUI_SERVER_INVALID');
  console.log('OWNER_AUTH_REQUESTED=YES');
  const ownerSession=await owner.openSession(permit);
  console.log('OWNER_SESSION_OPEN=PASS max='+ownerSession.max_operations);
  let writesOpen=false,windowIssued=0,mutationCount=0,currentSnapshot=null;

  function renewWindow(force=false){
    const now=Date.now();
    if(!force&&writesOpen&&now-windowIssued<8*60_000)return;
    writeWindow({path:windowPath,enabled:true,apps:['EnConvo','Grok Bot'],ttlMs:10*60_000,now,catalog});
    writesOpen=true;windowIssued=now;
    console.log('WRITES_WINDOW=OPEN_OR_RENEWED ttl=600s');
  }
  renewWindow(true);

  async function review(toolName,args,draft,label,{secret=false}={}){
    const isSnapshot=toolName==='desktop_snapshot';
    const digest=sha256(Buffer.from(JSON.stringify(args),'utf8'));
    let evidence;
    if(isSnapshot)evidence='Exact read-only GUI observation: tool=desktop_snapshot; app='+args.app+'; taskId='+taskId+'; actionDigest='+draft.actionDigest+'; target='+draft.target+'; purpose='+label+'. No mutation, credential, file write, shell or unrelated action.';
    else if(toolName==='desktop_type')evidence='Exact scoped desktop_type in '+args.app+' for '+label+'. Text is intentionally redacted from review evidence; length='+String(args.text?.length??0)+'; localArgsDigest='+digest+'; gateway actionDigest='+draft.actionDigest+'; target='+draft.target+'. The text stays local to the approved task process. No shell, file write, launch or unrelated action.';
    else evidence='Exact scoped '+toolName+' in '+args.app+' for '+label+'. actionDigest='+draft.actionDigest+'; target='+draft.target+'; localArgsDigest='+digest+'. The action is bound to this task and exact target. No unrelated mutation is included.';
    const r=await typeSafe.callTool({name:'jev_decide',arguments:{
      decision:'Should this exact '+toolName+' action proceed under sealed G6 for the bounded EnConvo/Grok Bot one-shot task?',
      evidence,
      priorities:'Preserve Frozen G6 Core. Approve only the exact scoped action. Fail closed on ambiguity. Secrets must remain local and never appear in review evidence or logs.',
      candidates:[{id:'approve',description:'Approve only this exact scoped action.'},{id:'deny',description:'Deny this action.'}],
      requirements:[
        'The action is limited to the exact supplied app, task, target and action digest.',
        isSnapshot?'The requested action is read-only desktop_snapshot.':'The requested mutation is one exact '+toolName+' action under the bounded task Owner session.',
        secret?'Sensitive text is redacted from evidence and bound only by local length/digest plus the signed gateway action digest.':'No credential leakage, shell execution, unrelated file mutation or unscoped action is present.',
      ],
      escape_hatches:false,escalate_on_contradiction:true,
    }});
    const obj=r?.structuredContent&&typeof r.structuredContent==='object'?r.structuredContent:JSON.parse(r.content.find(x=>x.type==='text').text);
    const rec=obj?.recommendation,checks=Array.isArray(obj?.checks)?obj.checks.filter(x=>x?.candidate==='approve'):[];
    console.log('REVIEW '+toolName+' '+label+' selected='+String(rec?.selected)+' confidence='+String(rec?.confidence)+' checks='+checks.map(x=>x.answer).join(','));
    if(obj?.provider!=='typesafe'||rec?.selected!=='approve'||rec?.escaped!==false||typeof rec?.confidence!=='number'||rec.confidence<0.70||checks.length!==3||checks.some(x=>x.answer!=='supported'))fail('JEV_NOT_APPROVED');
    return obj;
  }

  function signExact(toolName,args,challenge,reviewObj){
    exact(challenge,['issuerId','claimDraft'],'CHALLENGE_FIELDS_INVALID');
    if(challenge.issuerId!=='tigger-owner-brain-20261111')fail('ISSUER_INVALID');
    const d=challenge.claimDraft;
    exact(d,['version','challengeId','nonce','scope','taskDigest','actionDigest','decisionDigest','toolName','target','operationClass','environment','issuedMs','expiresMs'],'DRAFT_FIELDS_INVALID');
    const now=Date.now();
    if(d.version!==1||!H32.test(d.challengeId)||!H32.test(d.nonce)||!H64.test(d.taskDigest)||!H64.test(d.actionDigest)||!H64.test(d.decisionDigest)||d.scope!=='JEV-G6-GATEWAY-PRODUCTION-REVIEW-V1'||d.operationClass!=='gui'||d.environment!=='PRODUCTION'||d.toolName!==toolName||d.expiresMs-d.issuedMs!==60000||now<d.issuedMs||now>=d.expiresMs)fail('DRAFT_INVALID');
    const canon=canonicalGuiArgs(args),actionDigest=guiActionDigest(toolName,canon),target=guiTarget({toolName,args:canon,actionDigest});
    if(d.actionDigest!==actionDigest||d.target!==target)fail('BINDING_INVALID');
    const rec=reviewObj?.recommendation;
    if(reviewObj?.provider!=='typesafe'||reviewObj?.tool!=='jev_decide'||rec?.selected!=='approve'||rec?.escaped!==false||typeof rec?.confidence!=='number'||rec.confidence<0.70)fail('JEV_REVIEW_NOT_APPROVED');
    if(!Array.isArray(reviewObj.checks)||reviewObj.checks.some(x=>x.candidate==='approve'&&x.answer!=='supported'))fail('JEV_REQUIREMENT_NOT_SUPPORTED');
    const evidence={schema:'jev.g6.taskops.oneshot.typesafe-review.v1',reviewed_at:new Date(now).toISOString(),task_id:taskId,challenge_id:d.challengeId,tool_name:toolName,target:d.target,action_digest:d.actionDigest,decision:'APPROVE_EXACT_SCOPED_ACTION',jev:{provider:reviewObj.provider,model:reviewObj.model,confidence:rec.confidence,probabilities:rec.probabilities,checks:reviewObj.checks}};
    const claim={...d,brainEvidenceDigest:sha256(Buffer.from(JSON.stringify(evidence),'utf8'))};
    const bytes=productionReviewBytes(claim),prefix=path.join(workDir,'review-'+claim.challengeId);
    const bytesFile=prefix+'.bytes',brainFile=prefix+'.brain.der',ownerFile=prefix+'.owner.der';
    writeFileSync(bytesFile,bytes,{mode:0o600});
    try{
      for(const [role,file] of [['brain',brainFile],['owner',ownerFile]]){
        const r=spawnSync(signBin,[role,bytesFile,file],{encoding:'utf8',timeout:120000});
        if(r.status!==0)fail(role.toUpperCase()+'_SIGN_FAILED');
      }
      const trust=parseEnrollment({raw:readFileSync(enrollPath,'utf8'),pinnedSha256:ENROLL_SHA,now});
      const brain=readFileSync(brainFile),ownerSig=readFileSync(ownerFile);
      if(!verify('sha256',bytes,trust.brainPublic,brain)||!verify('sha256',bytes,trust.ownerPublic,ownerSig))fail('LOCAL_VERIFY_FAILED');
      const receipt=(role,sig)=>({role,claim,signatureDERBase64:sig.toString('base64')});
      return {claim,brainReceipt:receipt('BRAIN',brain),ownerReceipt:receipt('OWNER',ownerSig)};
    }finally{
      for(const p of [bytesFile,brainFile,ownerFile])try{rmSync(p,{force:true})}catch{}
    }
  }

  async function snapshot(app,label){
    const args=canonicalGuiArgs({app,taskId,interactive:false});
    const first=payload(await gui.call('tools/call',{name:'desktop_snapshot',arguments:args}));
    if(first.code!=='SIGNED_REVIEW_REQUIRED'||!first.productionReview?.claimDraft)fail('SNAPSHOT_CHALLENGE_INVALID_'+label);
    const ch=first.productionReview,rv=await review('desktop_snapshot',args,ch.claimDraft,label),pr=signExact('desktop_snapshot',args,ch,rv);
    const second=payload(await gui.call('tools/call',{name:'desktop_snapshot',arguments:{...args,productionReview:pr}}));
    if(second.ok!==true||second.code!=='EXECUTED'||!second.native?.data?.tree||!second.snapshotDigest)fail('SNAPSHOT_EXECUTION_FAILED_'+label);
    currentSnapshot=second;
    console.log('SNAPSHOT '+app+' '+label+' refs='+String(second.native.data.ref_count)+' digest='+second.snapshotDigest.slice(0,12));
    return second;
  }

  async function mutate(toolName,args,label,{secret=false}={}){
    renewWindow();
    if(mutationCount>=runtime.MAX_OPERATIONS)fail('ONESHOT_MUTATION_LIMIT');
    const canon=canonicalGuiArgs(args),actionDigest=guiActionDigest(toolName,canon),target=guiTarget({toolName,args:canon,actionDigest}),now=Date.now();
    const signed=await owner.signGrant(ownerSession.session_id,{version:1,grantId:randomBytes(16).toString('hex'),nonce:randomBytes(16).toString('hex'),toolName,target,actionDigest,issuedMs:now,expiresMs:Math.min(now+60_000,ownerSession.expires_ms)});
    const guiOwnerGrant=signed.grant;
    const first=payload(await gui.call('tools/call',{name:toolName,arguments:{...canon,guiOwnerGrant}}));
    if(first.code!=='SIGNED_REVIEW_REQUIRED'||!first.productionReview?.claimDraft)fail('MUTATION_CHALLENGE_INVALID_'+label+'_'+String(first.code));
    const ch=first.productionReview,rv=await review(toolName,canon,ch.claimDraft,label,{secret}),pr=signExact(toolName,canon,ch,rv);
    const second=payload(await gui.call('tools/call',{name:toolName,arguments:{...canon,guiOwnerGrant,productionReview:pr}}));
    mutationCount+=1;
    if(second.ok===true&&second.code==='EXECUTED'){
      console.log('MUTATION '+String(mutationCount)+' '+toolName+' '+label+'=PASS');
      currentSnapshot=null;return second;
    }
    const nativeCode=String(second?.native?.error?.code??second?.native?.code??second?.native?.native?.error?.code??second?.native?.native?.code??'UNKNOWN').slice(0,120);
    console.log('MUTATION_FAILURE '+toolName+' '+label+' outer='+String(second.code)+' native='+nativeCode);
    const err=Error('MUTATION_EXECUTION_FAILED_'+label+'_'+String(second.code)+'_NATIVE_'+nativeCode);
    err.result=second;throw err;
  }

  async function launch(app,label='launch'){
    return mutate('desktop_launch',canonicalGuiArgs({app,taskId}),label);
  }
  async function clickNode(app,node,snapshotObj,label){
    const args=canonicalGuiArgs({app,taskId,ref:node.ref_id,snapshotDigest:snapshotObj.snapshotDigest});
    return mutate('desktop_click',args,label);
  }
  async function clickByPatterns(app,patterns,label,{expectAfter=[],roles=null,retryConfirmedUnchanged=true}={}){
    let pre=await snapshot(app,label+' pre'),control=findControl(pre.native.data.tree,patterns,label,{roles});
    try{
      await clickNode(app,control,pre,label);
    }catch(e){
      if(!String(e.message).includes('MUTATION_EXECUTION_FAILED_'))throw e;
      const post=await snapshot(app,label+' delivery-check');
      if(expectAfter.length&&hasText(post.native.data.tree,expectAfter)){
        console.log('DELIVERY_CONFIRMED_BY_STATE '+label+'=PASS');return post;
      }
      if(!retryConfirmedUnchanged)throw e;
      let fresh;
      try{fresh=findControl(post.native.data.tree,patterns,label,{roles})}catch{throw e}
      console.log('DELIVERY_CONFIRMED_UNCHANGED '+label+' retry=ONE');
      await clickNode(app,fresh,post,label+' retry');
    }
    const out=await snapshot(app,label+' post');
    if(expectAfter.length&&!hasText(out.native.data.tree,expectAfter))console.log('POSTCONDITION_TEXT_NOT_SEEN '+label);
    return out;
  }
  async function typeText(app,text,label,{secret=false}={}){
    if(typeof text!=='string'||!text.length)fail('TYPE_TEXT_EMPTY_'+label);
    const args=canonicalGuiArgs({app,taskId,text});
    return mutate('desktop_type',args,label,{secret});
  }
  async function focusAndType(app,fieldPatterns,text,label,{secret=false}={}){
    const pre=await snapshot(app,label+' field-scan'),field=findField(pre.native.data.tree,fieldPatterns,label);
    await clickNode(app,field,pre,label+' focus');
    await typeText(app,text,label+' type',{secret});
    return snapshot(app,label+' post');
  }

  async function close(){
    if(writesOpen)try{writeWindow({path:windowPath,enabled:false,now:Date.now(),catalog})}catch{}
    try{await typeSafe.close()}catch{}
    try{await owner.close()}catch{}
    try{await gui.close()}catch{}
  }
  return {taskId,permit,ownerSession,snapshot,launch,clickByPatterns,focusAndType,typeText,findControl,findField,hasText,walk,textOf,close,getMutationCount:()=>mutationCount,getCatalog:()=>catalog};
}
