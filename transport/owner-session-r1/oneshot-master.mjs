import {createHash, randomBytes} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareOneShotRuntime} from './oneshot-owner-runtime.mjs';
import {createG6GuiSession} from './oneshot-g6-gui.mjs';

const [home,issuerDirectory]=process.argv.slice(2);
if(!home?.startsWith('/')||!issuerDirectory?.startsWith('/')){
  console.error('USAGE: node oneshot-master.mjs <home> <issuerDirectory>');
  process.exit(2);
}
const repoDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const runId=randomBytes(10).toString('hex');
const workDir=path.join(home,'JEV-Workspace/Staging','jev-enconvo-grok-oneshot-'+runId);
mkdirSync(workDir,{recursive:true,mode:0o700});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha256=x=>createHash('sha256').update(x).digest('hex');
function fail(c){throw Error(c)}
function logProgress(n,msg){console.log('PROGRESS='+String(n)+'% '+msg)}
function cleanState(v){
  const s=String(v??'').toLowerCase().replace(/[\s_-]+/g,'');
  return s;
}
function signedIn(data){
  const candidates=[
    data?.signedIn,data?.signed_in,data?.authenticated,
    data?.signIn?.signedIn,data?.signIn?.signed_in,data?.signIn?.authenticated,
    data?.status?.signedIn,data?.status?.authenticated,
  ];
  if(candidates.some(x=>x===true))return true;
  const states=[data?.state,data?.status,data?.signIn?.state,data?.signIn?.status,data?.status?.state].map(cleanState);
  return states.some(s=>['signedin','authenticated','connected','ready','active','success'].includes(s));
}
function responseJson(resp){
  if(!resp||typeof resp.json!=='function')fail('ENCONVO_HANDLER_RESPONSE_INVALID');
  return resp.json();
}
function loadHandler(file){
  const req=createRequire(file);
  const mod=req(file);
  const handler=mod?.default??mod;
  if(typeof handler!=='function')fail('ENCONVO_HANDLER_EXPORT_INVALID');
  return {handler,req};
}
async function callJsonHandler(file,body,{signal}={}){
  const {handler}=loadHandler(file);
  const req={json:async()=>body,signal:signal??new AbortController().signal};
  const resp=await handler(req);
  return responseJson(resp);
}
function clipboardRead(){
  const r=spawnSync('/usr/bin/pbpaste',[],{encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
  if(r.status!==0)fail('CLIPBOARD_READ_FAILED');
  return String(r.stdout??'');
}
function clipboardClear(){
  const r=spawnSync('/usr/bin/pbcopy',[],{input:'',encoding:'utf8',timeout:5000});
  if(r.status!==0)console.log('CLIPBOARD_CLEAR=FAILED');
  else console.log('CLIPBOARD_CLEAR=PASS');
}
function validWebhookUrl(s){
  try{
    const u=new URL(String(s).trim());
    return (u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))?u.toString():null;
  }catch{return null}
}
function validKey(s){
  const v=String(s??'').trim();
  if(v.length<8||v.length>4096||/[\r\n\0]/.test(v))return null;
  return v;
}
function treeStrings(tree){
  const out=[];
  const walk=n=>{if(!n||typeof n!=='object')return;for(const k of ['name','description','value'])if(typeof n[k]==='string'&&n[k].trim())out.push(n[k].trim());if(Array.isArray(n.children))for(const c of n.children)walk(c)};
  walk(tree);return out;
}
function urlFromTree(tree){
  const found=[];
  for(const s of treeStrings(tree)){
    const matches=s.match(/https?:\/\/[^\s"'<>]+/g)||[];
    for(const raw of matches){
      const v=validWebhookUrl(raw.replace(/[),.;]+$/,''));
      if(v&&!found.includes(v))found.push(v);
    }
  }
  const webhook=found.filter(x=>/webhook|hook|routine|automation/i.test(x));
  if(webhook.length===1)return webhook[0];
  if(found.length===1)return found[0];
  return null;
}

async function ensureGrokBuildSignedIn(){
  const root=path.join(home,'Applications/EnConvo.app/Contents/Resources/EnconvoCommands.bundle/Contents/Resources/coding_agent/account');
  const statusFile=path.join(root,'status.js'),signInFile=path.join(root,'sign_in.js');
  let status=await callJsonHandler(statusFile,{agent:'grok_build',refresh:true});
  if(signedIn(status)){
    console.log('GROK_BUILD_AUTH=ALREADY_SIGNED_IN');
    return;
  }
  console.log('GROK_BUILD_AUTH=SIGNIN_REQUESTED');
  let result;
  try{result=await callJsonHandler(signInFile,{agent:'grok_build'});}
  catch(e){console.log('GROK_BUILD_SIGNIN_HANDLER_ERROR='+String(e?.message||'UNKNOWN').slice(0,120));throw e}
  if(signedIn(result)){
    console.log('GROK_BUILD_AUTH=PASS');
    return;
  }
  console.log('OAUTH_HUMAN_ACTION_REQUIRED=YES provider=xAI');
  console.log('OAUTH_NOTE=Complete_the_official_xAI_OAuth_window;_this_runner_will_continue_automatically');
  const deadline=Date.now()+10*60_000;
  while(Date.now()<deadline){
    await sleep(4000);
    try{status=await callJsonHandler(statusFile,{agent:'grok_build',refresh:true});}catch{continue}
    if(signedIn(status)){
      console.log('GROK_BUILD_AUTH=PASS');
      return;
    }
  }
  fail('GROK_BUILD_OAUTH_TIMEOUT');
}

async function getExactRoutineInstructions(){
  const file=path.join(home,'Applications/EnConvo.app/Contents/Resources/EnconvoCommands.bundle/Contents/Resources/coding_agent/grokbot/instructions.js');
  const {handler}=loadHandler(file);
  const resp=await handler({json:async()=>({})});
  const data=await responseJson(resp);
  const text=typeof data?.text==='string'?data.text:'';
  if(!text.startsWith("This routine answers messages from Enconvo, an app on the user's Mac.")
    ||!text.includes('grokbot-web.inbound.v1')
    ||!text.includes('reply.url')
    ||!text.includes('one or two short sentences'))fail('ROUTINE_INSTRUCTIONS_INVALID');
  console.log('ROUTINE_INSTRUCTIONS_SHA256='+sha256(Buffer.from(text,'utf8')));
  return text;
}

async function configureRoutine(gui,instructions){
  const app='Grok Bot',name='Grok Bot Routine';
  await gui.launch(app,'Grok Bot launch');
  await sleep(1200);
  let s=await gui.snapshot(app,'initial');
  const existing=gui.hasText(s.native.data.tree,[name]);
  if(existing){
    console.log('ROUTINE_EXISTING=YES');
    try{s=await gui.clickByPatterns(app,[name],name,{expectAfter:['Webhook','Instructions','Edit','grokbot-web.inbound.v1']});}catch{}
    if(!gui.hasText(s.native.data.tree,['grokbot-web.inbound.v1'])){
      try{s=await gui.clickByPatterns(app,['Edit','编辑'],name+' edit',{expectAfter:['Instructions','Webhook']});}catch{}
    }
    if(!gui.hasText(s.native.data.tree,['grokbot-web.inbound.v1'])
      ||!gui.hasText(s.native.data.tree,["This routine answers messages from Enconvo"])){
      fail('EXISTING_ROUTINE_INSTRUCTIONS_UNVERIFIED');
    }
  }else{
    console.log('ROUTINE_EXISTING=NO');
    if(!gui.hasText(s.native.data.tree,['Routines','Routine','Automations','Automation','例行'])){
      s=await gui.clickByPatterns(app,['Routines','Routine','Automations','Automation','例行'],'Routines navigation',{expectAfter:['New Routine','Create Routine','Add Routine','Routines']});
    }else{
      try{s=await gui.clickByPatterns(app,['Routines','Routine','Automations','Automation','例行'],'Routines navigation',{expectAfter:['New Routine','Create Routine','Add Routine','Routines']});}catch{}
    }
    s=await gui.clickByPatterns(app,['New Routine','Create Routine','Add Routine','New automation','Create automation','新建 Routine','新建'],'Create Routine',{expectAfter:['Name','Routine name','Instructions','Trigger']});
    await gui.focusAndType(app,['Routine name','Name','名称'],name,'Routine name');
    await gui.focusAndType(app,['Instructions','Instruction','Prompt','指令'],instructions,'Routine instructions');
    s=await gui.snapshot(app,'trigger scan');
    if(!gui.hasText(s.native.data.tree,['Webhook Trigger'])){
      try{s=await gui.clickByPatterns(app,['Add Trigger','Trigger','Triggers','添加触发器'],'Add trigger',{expectAfter:['Webhook']});}catch{}
    }
    s=await gui.clickByPatterns(app,['Webhook Trigger','Webhook','Web hook'],'Webhook Trigger',{expectAfter:['Webhook','Save','Create','Done']});
    s=await gui.clickByPatterns(app,['Save','Create','Done','保存','创建'],'Save Routine',{expectAfter:[name,'Webhook']});
    console.log('ROUTINE_CREATE=PASS');
  }
  s=await gui.snapshot(app,'routine final');
  if(gui.hasText(s.native.data.tree,['Enable','Turn on','Inactive','Disabled'])){
    try{
      s=await gui.clickByPatterns(app,['Enable','Turn on','启用'],'Enable Routine',{expectAfter:['Enabled','Active','On',name]});
      console.log('ROUTINE_ENABLE=PASS');
    }catch{}
  }
  return s;
}

async function collectWebhook(gui,tree){
  const app='Grok Bot';
  let webhookUrl=urlFromTree(tree);
  if(!webhookUrl){
    const beforeHash=sha256(Buffer.from(clipboardRead(),'utf8'));
    await gui.clickByPatterns(app,['Copy Webhook URL','Copy URL','Webhook URL'],'Copy Webhook URL');
    await sleep(250);
    const clip=clipboardRead();
    webhookUrl=validWebhookUrl(clip);
    if(!webhookUrl||sha256(Buffer.from(clip,'utf8'))===beforeHash)fail('WEBHOOK_URL_COPY_UNCONFIRMED');
  }
  console.log('WEBHOOK_URL_CAPTURED=PASS host='+new URL(webhookUrl).hostname);
  const beforeKeyHash=sha256(Buffer.from(clipboardRead(),'utf8'));
  await gui.clickByPatterns(app,['Copy Webhook Key','Copy Key','Copy secret','Webhook Key','Key'],'Copy Webhook Key');
  await sleep(250);
  const rawKey=clipboardRead(),webhookKey=validKey(rawKey);
  if(!webhookKey)fail('WEBHOOK_KEY_COPY_INVALID');
  const keyHash=sha256(Buffer.from(webhookKey,'utf8'));
  if(keyHash===beforeKeyHash)console.log('WEBHOOK_KEY_CLIPBOARD_UNCHANGED=NOTICE');
  console.log('WEBHOOK_KEY_CAPTURED=PASS sha256_prefix='+keyHash.slice(0,8));
  return {webhookUrl,webhookKey};
}

async function writeEnconvoCredentials({webhookUrl,webhookKey}){
  const connectFile=path.join(home,'Applications/EnConvo.app/Contents/Resources/EnconvoCommands.bundle/Contents/Resources/credentials/connect_key.js');
  const req=createRequire(connectFile),api=req('@enconvo/api'),pref='credentials|grok_bot';
  if(!api?.PreferenceManageUtils?.updatePreference)fail('ENCONVO_PREFERENCE_API_UNAVAILABLE');
  let prefPath;
  try{prefPath=api.PreferenceManageUtils.sharedPreferenceConfigPath?.(pref);}catch{}
  const backupPath=path.join(workDir,'credentials-grok_bot.backup');
  const hadExisting=!!prefPath&&existsSync(prefPath);
  if(hadExisting){copyFileSync(prefPath,backupPath);console.log('CREDENTIAL_BACKUP=PASS')}
  const restore=()=>{
    try{
      if(hadExisting&&prefPath&&existsSync(backupPath))copyFileSync(backupPath,prefPath);
      else if(!hadExisting&&prefPath&&existsSync(prefPath))rmSync(prefPath,{force:true});
      console.log('CREDENTIAL_ROLLBACK=PASS');
    }catch{console.log('CREDENTIAL_ROLLBACK=FAILED')}
  };
  await api.PreferenceManageUtils.updatePreference({keys:['webhookUrl'],value:webhookUrl,preferenceKey:pref,encrypt:false});
  await api.PreferenceManageUtils.updatePreference({keys:['apiKey'],value:webhookKey,preferenceKey:pref,encrypt:true});
  try{
    const info=await api.CommandManageUtils.getCommandInfo(pref).catch(()=>({}));
    api.Commander?.send?.('notifyCommandPreferencesChanged',{...info,commandKey:pref});
  }catch{}
  const loaded=await api.CommandManageUtils.loadCommandConfig({commandKey:pref,useAsRunParams:true}).catch(()=>null);
  const urlOk=validWebhookUrl(loaded?.webhookUrl)===webhookUrl;
  const keyOk=typeof loaded?.apiKey==='string'&&loaded.apiKey===webhookKey;
  if(!urlOk||!keyOk){restore();fail('CREDENTIAL_READBACK_FAILED')}
  try{
    const validation=await api.CredentialsProvider?.create?.(pref).validate();
    if(validation?.valid===false){restore();fail('CREDENTIAL_PROVIDER_VALIDATION_FAILED')}
  }catch(e){
    if(String(e?.message||'').startsWith('CREDENTIAL_PROVIDER_VALIDATION_FAILED'))throw e;
    console.log('CREDENTIAL_PROVIDER_VALIDATION=SKIPPED');
  }
  console.log('ENCONVO_CREDENTIAL_BACKFILL=PASS');
  return {restore};
}

async function testEndToEnd(){
  const file=path.join(home,'Applications/EnConvo.app/Contents/Resources/EnconvoCommands.bundle/Contents/Resources/coding_agent/grokbot/test.js');
  const {handler}=loadHandler(file);
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),130000);
  try{
    const resp=await handler({signal:ctl.signal});
    const data=await responseJson(resp);
    const result=String(data?.result??'unknown');
    console.log('GROKBOT_TEST_RESULT='+result+' status='+String(data?.status??''));
    if(result!=='ok')fail('GROKBOT_E2E_TEST_FAILED_'+result);
  }finally{clearTimeout(timer)}
}

let gui=null,credentialTxn=null;
try{
  console.log('JEV_ENCONVO_GROK_ONESHOT=START');
  logProgress(50,'one-shot runtime preparation');
  const runtime=await prepareOneShotRuntime({home,repoDir,workDir});
  const instructions=await getExactRoutineInstructions();
  logProgress(58,'official Grok Build authentication');
  await ensureGrokBuildSignedIn();
  logProgress(68,'Grok Bot routine configuration');
  gui=await createG6GuiSession({home,workDir,runtime,issuerDirectory});
  const routineState=await configureRoutine(gui,instructions);
  logProgress(82,'webhook handoff');
  const webhook=await collectWebhook(gui,routineState.native.data.tree);
  logProgress(90,'encrypted EnConvo credential backfill');
  credentialTxn=await writeEnconvoCredentials(webhook);
  clipboardClear();
  logProgress(95,'end-to-end Grok Bot test');
  await testEndToEnd();
  credentialTxn=null;
  logProgress(100,'complete');
  console.log('JEV_ENCONVO_GROK_ONESHOT=PASS');
  console.log('OWNER_MUTATIONS_USED='+String(gui.getMutationCount()));
  console.log('PRODUCTION_G6_CORE_CHANGED=NO');
  console.log('RAW_CREDENTIALS_OUTPUT=NO');
}catch(e){
  console.log('JEV_ENCONVO_GROK_ONESHOT=BLOCKED code='+String(e?.message||'UNKNOWN').slice(0,220).replace(/\s+/g,'_'));
  if(credentialTxn?.restore)credentialTxn.restore();
  process.exitCode=1;
}finally{
  clipboardClear();
  try{await gui?.close()}catch{}
}
