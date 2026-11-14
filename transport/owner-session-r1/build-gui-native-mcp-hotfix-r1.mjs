import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const [home, outDir] = process.argv.slice(2);
if (!home?.startsWith('/') || !outDir?.startsWith('/')) {
  console.error('USAGE: node build-gui-native-mcp-hotfix-r1.mjs <home> <outDir>');
  process.exit(2);
}
const srcDir = path.join(home,'.local/share/jev-gui-permit-mcp');
const sha = x => createHash('sha256').update(x).digest('hex');
const sumsText = readFileSync(path.join(srcDir,'CODE_SHA256SUMS'),'utf8');
const entries = sumsText.trim().split('\n').map(line => {
  const m=line.match(/^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$/);
  if(!m) throw new Error('CODE_SUMS_INVALID');
  return {digest:m[1],name:m[2]};
});
for(const e of entries){
  const data=readFileSync(path.join(srcDir,e.name));
  if(sha(data)!==e.digest) throw new Error('SOURCE_HASH_MISMATCH_'+e.name);
}
const oldBridgeEntry=entries.find(e=>e.name==='gui-bridge.mjs');
if(!oldBridgeEntry) throw new Error('GUI_BRIDGE_ENTRY_MISSING');

rmSync(outDir,{recursive:true,force:true});
mkdirSync(outDir,{recursive:true,mode:0o700});
for(const e of entries) copyFileSync(path.join(srcDir,e.name),path.join(outDir,e.name));

const bridgePath=path.join(outDir,'gui-bridge.mjs');
let source=readFileSync(bridgePath,'utf8');
if(!source.includes("import {spawnSync} from 'node:child_process';")) throw new Error('SPAWN_IMPORT_DRIFT');
source=source.replace("import {spawnSync} from 'node:child_process';","import {spawn,spawnSync} from 'node:child_process';");

const startNeedle="  const native = invokeNative || ((toolName, args, meta) => {";
const endNeedle="\n\n  async function execute";
const start=source.indexOf(startNeedle);
const end=source.indexOf(endNeedle,start);
if(start<0||end<0) throw new Error('NATIVE_BLOCK_DRIFT');

const replacement = [
"  let nativeMcpProc = null;",
"  let nativeMcpSend = null;",
"  let nativeMcpReady = null;",
"  const closeNativeMcp = () => {",
"    const proc=nativeMcpProc;",
"    nativeMcpProc=null;nativeMcpSend=null;nativeMcpReady=null;",
"    if(proc && proc.exitCode===null){try{proc.kill('SIGTERM');}catch{}}",
"  };",
"  const ensureNativeMcp = async () => {",
"    if(nativeMcpReady){await nativeMcpReady;return;}",
"    if(!pin.ok) throw Error(pin.code);",
"    const bin=pin.bin;",
"    const stateDir=path.join(path.dirname(path.dirname(bin)),'state');",
"    const proc=spawn(bin,['mcp'],{",
"      cwd:path.dirname(bin),",
"      env:{...process.env,HOME:process.env.HOME||'/Users/Tigger_1',USER:process.env.USER||'Tigger_1',PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',AGENT_DESKTOP_HOME:stateDir},",
"      stdio:['pipe','pipe','ignore'],",
"    });",
"    nativeMcpProc=proc;",
"    let nextId=1000,buffer='';",
"    const pending=new Map();",
"    proc.stdout.setEncoding('utf8');",
"    proc.stdout.on('data',chunk=>{",
"      buffer+=chunk;",
"      if(buffer.length>2000000){for(const [id,p] of pending){clearTimeout(p.timer);p.reject(Error('NATIVE_OUTPUT_TOO_LARGE'));pending.delete(id);}buffer='';return;}",
"      let i;",
"      while((i=buffer.indexOf('\\n'))>=0){",
"        const line=buffer.slice(0,i);buffer=buffer.slice(i+1);",
"        try{const msg=JSON.parse(line);const p=pending.get(msg.id);if(p){clearTimeout(p.timer);pending.delete(msg.id);p.resolve(msg);}}catch{}",
"      }",
"    });",
"    proc.on('exit',()=>{for(const [id,p] of pending){clearTimeout(p.timer);p.reject(Error('NATIVE_PROCESS_EXITED'));pending.delete(id);}});",
"    nativeMcpSend=(method,params,timeout=15000)=>new Promise((resolve,reject)=>{",
"      if(proc.exitCode!==null)return reject(Error('NATIVE_PROCESS_EXITED'));",
"      const id=nextId++;",
"      const timer=setTimeout(()=>{pending.delete(id);reject(Error('NATIVE_TIMEOUT'));},timeout);",
"      pending.set(id,{resolve,reject,timer});",
"      const req={jsonrpc:'2.0',id,method};if(params!==undefined)req.params=params;",
"      proc.stdin.write(JSON.stringify(req)+'\\n',err=>{if(!err)return;const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(timer);reject(Error('NATIVE_WRITE_FAILED'));});",
"    });",
"    nativeMcpReady=(async()=>{",
"      const init=await nativeMcpSend('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'jev-gui-permit-mcp-hotfix',version:'1.0.0'}},15000);",
"      if(!init?.result)throw Error('NATIVE_MCP_INIT_FAILED');",
"      proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\\n');",
"    })();",
"    try{await nativeMcpReady;}catch(e){closeNativeMcp();throw e;}",
"  };",
"  const nativeMcpTool = async (toolName,args) => {",
"    try{",
"      await ensureNativeMcp();",
"      const response=await nativeMcpSend('tools/call',{name:toolName,arguments:args},15000);",
"      const blocks=response?.result?.content;",
"      if(!Array.isArray(blocks))return {ok:false,code:'NATIVE_MCP_RESPONSE_INVALID'};",
"      const payload=blocks.filter(x=>x?.type==='text').map(x=>x.text).join('');",
"      if(!payload)return {ok:false,code:'NATIVE_MCP_PAYLOAD_MISSING'};",
"      let data;try{data=JSON.parse(payload);}catch{return {ok:false,code:'NATIVE_MCP_PAYLOAD_INVALID'};}",
"      if(response.result.isError===true)return {ok:false,code:String(data?.code||'NATIVE_MCP_TOOL_FAILED'),native:data};",
"      return data;",
"    }catch(e){return {ok:false,code:String(e?.message||'NATIVE_MCP_FAILED').slice(0,80)};}",
"  };",
"  const native = invokeNative || (async (toolName, args, meta) => {",
"    if (!pin.ok) return {ok: false, code: pin.code};",
"    const bin = pin.bin;",
"    const name = toolName.replace(/^desktop_/, '').replace(/_/g, '-');",
"    const needsNativeApp = name === 'snapshot' || name === 'press' || name === 'type' || name === 'launch' || name === 'close-app';",
"    const nativeName = needsNativeApp ? (meta?.identity?.native || nativeApp(args.app, {catalog: catalogOf(), bindings})) : undefined;",
"    if(name==='snapshot' && !args.interactive)return nativeMcpTool('desktop_snapshot',{app:nativeName});",
"    if(name==='click')return nativeMcpTool('desktop_click',{ref_id:args.ref});",
"    const argv=[name];",
"    if (name === 'snapshot') {argv.push('--app', nativeName);if (args.interactive) argv.push('-i');}",
"    else if (name === 'press' || name === 'type') argv.push(String(args.text ?? args.key ?? args.keys), '--app', nativeName);",
"    else if (name === 'status' || name === 'version') {}",
"    else if (name === 'launch') argv.push(nativeName, '--activate');",
"    else if (name === 'close-app') argv.push(nativeName);",
"    else return {ok: false, code: 'NATIVE_TOOL_NOT_WIRED'};",
"    const r = spawnSync(bin, argv, {encoding:'utf8',timeout:60000,env:{...process.env,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});",
"    try{return JSON.parse(r.stdout);}catch{return {ok:false,code:'NATIVE_OUTPUT_INVALID',stderr:String(r.stderr||'').slice(0,200)};}",
"  });"
].join('\n');

source=source.slice(0,start)+replacement+source.slice(end);
const closeNeedle="return {execute, provenance, spend, pin, close() { spend.close(); try { guiVerifier?.close(); } catch {} }};";
if(!source.includes(closeNeedle)) throw new Error('CLOSE_BLOCK_DRIFT');
source=source.replace(closeNeedle,"return {execute, provenance, spend, pin, close() { closeNativeMcp(); spend.close(); try { guiVerifier?.close(); } catch {} }};");
writeFileSync(bridgePath,source,{mode:0o600});

const newBridgeSha=sha(Buffer.from(source));
const newEntries=entries.map(e=>e.name==='gui-bridge.mjs'?{...e,digest:newBridgeSha}:e);
const newSums=newEntries.map(e=>e.digest+'  '+e.name).join('\n')+'\n';
writeFileSync(path.join(outDir,'CODE_SHA256SUMS'),newSums,{mode:0o600});

writeFileSync(path.join(outDir,'HOTFIX_MANIFEST.json'),JSON.stringify({
  schema:'jev.gui-native-mcp-hotfix.r1',
  sourceBridgeSha256:oldBridgeEntry.digest,
  patchedBridgeSha256:newBridgeSha,
  sourceCodeSumsSha256:sha(Buffer.from(sumsText)),
  patchedCodeSumsSha256:sha(Buffer.from(newSums)),
  scope:['gui-bridge.mjs','CODE_SHA256SUMS'],
  nativeContract:{snapshotTransport:'mcp',clickTransport:'mcp',clickArgument:'ref_id',state:'package-local state'},
  gatewayChanged:false,ownerAuthChanged:false,brainReviewChanged:false
},null,2)+'\n',{mode:0o600});

const syntax=spawnSync('/opt/homebrew/opt/node@22/bin/node',['--check',bridgePath],{encoding:'utf8',timeout:10000});
if(syntax.status!==0)throw new Error('PATCHED_BRIDGE_SYNTAX_FAILED');
console.log('GUI_NATIVE_MCP_HOTFIX_BUILD=PASS');
console.log('OUTPUT='+outDir);
console.log('SOURCE_BRIDGE_SHA256='+oldBridgeEntry.digest);
console.log('PATCHED_BRIDGE_SHA256='+newBridgeSha);
console.log('PATCHED_CODE_SUMS_SHA256='+sha(Buffer.from(newSums)));
console.log('PRODUCTION_CHANGE=NO');
