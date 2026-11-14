import {createHash} from 'node:crypto';
import {chmodSync,copyFileSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const [home,hotfixDir]=process.argv.slice(2);
if(!home?.startsWith('/')||!hotfixDir?.startsWith('/')){
  console.error('USAGE: node deploy-gui-native-mcp-hotfix-r1.mjs <home> <hotfixDir>');
  process.exit(2);
}
const target=path.join(home,'.local/share/jev-gui-permit-mcp');
const sha=x=>createHash('sha256').update(x).digest('hex');
const expectedBridge='b3658c78998c55a5bb90ac4ed4d6dfa5881229b4115e17861ede902750ea32ef';

const currentBridgePath=path.join(target,'gui-bridge.mjs');
const currentSumsPath=path.join(target,'CODE_SHA256SUMS');
const currentBridge=readFileSync(currentBridgePath);
const currentSums=readFileSync(currentSumsPath,'utf8');
if(sha(currentBridge)!==expectedBridge)throw Error('CURRENT_BRIDGE_DRIFT');
if(!currentSums.includes(expectedBridge+'  gui-bridge.mjs'))throw Error('CURRENT_SUMS_DRIFT');

for(const p of [target,path.join(target,'state')]){
  const st=lstatSync(p);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o022)!==0)throw Error('TARGET_UNSAFE');
}
const lsof=spawnSync('/usr/sbin/lsof',['-t','+D',target],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
if(lsof.error||lsof.signal||![0,1].includes(lsof.status)||String(lsof.stderr||'').trim())throw Error('IDLE_CHECK_FAILED');
if(lsof.status!==1||String(lsof.stdout||'').trim())throw Error('MCP_STILL_RUNNING');

const manifest=JSON.parse(readFileSync(path.join(hotfixDir,'HOTFIX_MANIFEST.json'),'utf8'));
if(manifest?.schema!=='jev.gui-native-mcp-hotfix.r1'||manifest.sourceBridgeSha256!==expectedBridge)throw Error('HOTFIX_MANIFEST_INVALID');
if(manifest.gatewayChanged!==false||manifest.ownerAuthChanged!==false||manifest.brainReviewChanged!==false)throw Error('HOTFIX_SCOPE_INVALID');

const patchedBridge=readFileSync(path.join(hotfixDir,'gui-bridge.mjs'));
const patchedSums=readFileSync(path.join(hotfixDir,'CODE_SHA256SUMS'));
if(sha(patchedBridge)!==manifest.patchedBridgeSha256)throw Error('PATCHED_BRIDGE_HASH_MISMATCH');
if(sha(patchedSums)!==manifest.patchedCodeSumsSha256)throw Error('PATCHED_SUMS_HASH_MISMATCH');
const patchedLine=patchedSums.toString('utf8').split('\n').find(x=>x.endsWith('  gui-bridge.mjs'));
if(!patchedLine||patchedLine.slice(0,64)!==sha(patchedBridge))throw Error('PATCHED_SUMS_ENTRY_INVALID');

const backup=path.join(home,'.jev-repair-audit','gui-native-mcp-hotfix-'+new Date().toISOString().replace(/[-:.]/g,''));
mkdirSync(backup,{recursive:true,mode:0o700});
copyFileSync(currentBridgePath,path.join(backup,'gui-bridge.mjs'));
copyFileSync(currentSumsPath,path.join(backup,'CODE_SHA256SUMS'));

const atomic=(dest,data)=>{
  const tmp=dest+'.tmp.'+process.pid;
  writeFileSync(tmp,data,{mode:0o600});
  renameSync(tmp,dest);
  chmodSync(dest,0o600);
};

const verifyInstalledSums=()=>{
  const lines=readFileSync(currentSumsPath,'utf8').trim().split('\n');
  for(const line of lines){
    const m=line.match(/^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$/);
    if(!m)throw Error('POST_SUMS_FORMAT_INVALID');
    if(sha(readFileSync(path.join(target,m[2])))!==m[1])throw Error('POST_HASH_MISMATCH_'+m[2]);
  }
};

try{
  atomic(currentBridgePath,patchedBridge);
  atomic(currentSumsPath,patchedSums);
  verifyInstalledSums();

  const check=spawnSync('/opt/homebrew/opt/node@22/bin/node',['--check',currentBridgePath],{encoding:'utf8',timeout:10000});
  if(check.status!==0)throw Error('POST_NODE_CHECK_FAILED');

  const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'hotfix-check',version:'1'}}};
  const list={jsonrpc:'2.0',id:2,method:'tools/list',params:{}};
  const smoke=spawnSync('/opt/homebrew/opt/node@22/bin/node',[path.join(target,'main.mjs')],{
    input:JSON.stringify(init)+'\n'+JSON.stringify(list)+'\n',
    encoding:'utf8',
    timeout:20000,
    env:{...process.env,HOME:home,PATH:'/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}
  });
  const out=String(smoke.stdout||'');
  if(smoke.status!==0||!out.includes('"id":1')||!out.includes('"id":2')||!out.includes('desktop_click')||!out.includes('desktop_snapshot'))throw Error('POST_ADAPTER_SMOKE_FAILED');

  console.log('GUI_NATIVE_MCP_HOTFIX_DEPLOY=PASS');
  console.log('BACKUP_DIR='+backup);
  console.log('BRIDGE_SHA256='+sha(patchedBridge));
  console.log('CODE_SUMS_SHA256='+sha(patchedSums));
  console.log('GATEWAY_CHANGED=NO');
  console.log('OWNERAUTH_CHANGED=NO');
  console.log('BRAIN_REVIEW_CHANGED=NO');
  console.log('ROLLBACK_READY=YES');
}catch(e){
  try{
    atomic(currentBridgePath,readFileSync(path.join(backup,'gui-bridge.mjs')));
    atomic(currentSumsPath,readFileSync(path.join(backup,'CODE_SHA256SUMS')));
  }catch{}
  console.error('GUI_NATIVE_MCP_HOTFIX_DEPLOY=ROLLBACK');
  console.error('ERROR='+String(e?.message||e));
  process.exit(1);
}
