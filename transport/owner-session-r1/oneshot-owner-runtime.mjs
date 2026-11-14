import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const BASE_ISSUER_SOURCE_SHA256='96ec5558ea47f14f2e638b67ba13ae41655f922778efda35fcb4d7c132982907';
const MAX_SESSION_MS=1_200_000;
const MAX_OPERATIONS=32;

const sha256=(x)=>createHash('sha256').update(x).digest('hex');
const shaFile=(p)=>sha256(readFileSync(p));
function replaceOne(src,oldText,newText,code){
  if(!src.includes(oldText))throw Error(code);
  const out=src.replace(oldText,newText);
  if(out.includes(oldText))throw Error(code+'_DUPLICATE');
  return out;
}

export async function prepareOneShotRuntime({home,repoDir,workDir}){
  const capabilityPath=path.join(repoDir,'transport/owner-session-r1/oneshot-capability.json');
  const capabilityBytes=readFileSync(capabilityPath);
  const capability=JSON.parse(capabilityBytes);
  if(capability?.id!=='CAP_ENCONVO_GROK_R2_ONESHOT'
    || capability?.risk_level!=='L3_GUI_WRITE'
    || capability?.owner_auth?.required!==true
    || capability?.owner_auth?.once_per_task!==true
    || capability?.owner_auth?.max_gui_owner_session_seconds!==1200
    || capability?.owner_auth?.max_operations!==MAX_OPERATIONS
    || capability?.permanent_authorization!==false
    || JSON.stringify(capability?.allowed_apps)!==JSON.stringify(['EnConvo','Grok Bot'])){
    throw Error('ONESHOT_CAPABILITY_INVALID');
  }
  mkdirSync(workDir,{recursive:true,mode:0o700});

  const baseSource=path.join(home,'JEV-Workspace/Staging/taskops-enconvo-grok-mcp-r1-issuerfix/transport/owner-session-r1/generated/TaskOwnerSessionIssuer.fixed.swift');
  if(shaFile(baseSource)!==BASE_ISSUER_SOURCE_SHA256)throw Error('BASE_ISSUER_SOURCE_DRIFT');
  let swift=readFileSync(baseSource,'utf8');
  swift=replaceOne(swift,'private let capabilityID = "CAP_ENCONVO_GROK_R1"','private let capabilityID = "CAP_ENCONVO_GROK_R2_ONESHOT"','ISSUER_CAPABILITY_PATCH_FAILED');
  swift=replaceOne(swift,'private let maxSessionTTL: Int64 = 300_000','private let maxSessionTTL: Int64 = 1_200_000','ISSUER_TTL_PATCH_FAILED');
  swift=replaceOne(swift,`private let exactTools = Set([
    "desktop_status", "desktop_snapshot", "desktop_click", "desktop_type",
    "desktop_launch", "file_read", "file_backup", "oauth_status",
])`,`private let exactTools = Set([
    "desktop_status", "desktop_snapshot", "desktop_click", "desktop_type",
    "desktop_launch", "file_read", "file_backup", "oauth_status",
    "clipboard_read", "clipboard_clear",
])`,'ISSUER_TOOLS_PATCH_FAILED');
  swift=replaceOne(swift,'private let exactApps = Set(["EnConvo"])','private let exactApps = Set(["EnConvo", "Grok Bot"])','ISSUER_APPS_PATCH_FAILED');
  swift=replaceOne(swift,`private let exactPaths = Set([
    "/Users/Tigger_1/Library/Application Support/Enconvo",
    "/Users/Tigger_1/Library/Application Support/com.frostyeve.enconvo",
    "/Users/Tigger_1/JEV-Workspace/G6-TaskOps",
])`,`private let exactPaths = Set([
    "/Users/Tigger_1/Library/Application Support/Enconvo",
    "/Users/Tigger_1/Library/Application Support/com.frostyeve.enconvo",
    "/Users/Tigger_1/Library/Application Support/Grok Bot",
    "/Users/Tigger_1/JEV-Workspace/G6-TaskOps",
    "/Users/Tigger_1/JEV-Workspace/Staging",
])`,'ISSUER_PATHS_PATCH_FAILED');
  swift=replaceOne(swift,`private let exactOperations = Set([
    "status", "routine.detect", "routine.create", "routine.update",
    "config.backup", "oauth.status", "recover.safe",
])`,`private let exactOperations = Set([
    "status", "oauth.signin", "oauth.status", "routine.detect", "routine.create",
    "routine.update", "routine.test", "credentials.backfill", "clipboard.read",
    "clipboard.clear", "config.backup", "recover.safe",
])`,'ISSUER_OPERATIONS_PATCH_FAILED');
  swift=replaceOne(swift,'target.range(of: "^/gui/EnConvo/[^\\\\s]{1,1000}$", options: .regularExpression) != nil,','target.range(of: "^/gui/(EnConvo|Grok Bot)/[^\\\\s]{1,1000}$", options: .regularExpression) != nil,','ISSUER_TARGET_PATCH_FAILED');

  const swiftPath=path.join(workDir,'TaskOwnerSessionIssuer.oneshot.swift');
  const issuerPath=path.join(workDir,'TaskOwnerSessionIssuer.oneshot');
  writeFileSync(swiftPath,swift,{mode:0o600});
  const build=spawnSync('/usr/bin/xcrun',['swiftc',swiftPath,'-o',issuerPath],{encoding:'utf8',timeout:120000});
  if(build.status!==0)throw Error('ONESHOT_ISSUER_BUILD_FAILED_'+String(build.stderr||'').slice(0,160).replace(/\s+/g,'_'));
  chmodSync(issuerPath,0o700);
  const issuerSha=shaFile(issuerPath);

  const baseClientPath=path.join(repoDir,'transport/owner-session-r1/owner-session-client.mjs');
  let client=readFileSync(baseClientPath,'utf8');
  const capabilitySha=sha256(capabilityBytes);
  client=replaceOne(client,"export const ISSUER_SHA256 = '5fd8a579aa8292076e50d651d9bc540cb2feebabf63c9e3900b3ca5e822997de';",`export const ISSUER_SHA256 = '${issuerSha}';`,'CLIENT_ISSUER_PIN_PATCH_FAILED');
  client=replaceOne(client,"export const CAPABILITY_SHA256 = '229e947495f44eb6652fce39dd14f074202f154bbe7d929b3c892ee6ec007122';",`export const CAPABILITY_SHA256 = '${capabilitySha}';`,'CLIENT_CAPABILITY_PIN_PATCH_FAILED');
  client=replaceOne(client,'export const MAX_SESSION_MS = 300_000;','export const MAX_SESSION_MS = 1_200_000;','CLIENT_TTL_PATCH_FAILED');
  client=replaceOne(client,'export const MAX_OPERATIONS = 6;','export const MAX_OPERATIONS = 32;','CLIENT_OPS_PATCH_FAILED');
  client=replaceOne(client,'&& /^\\/gui\\/EnConvo\\/\\S{1,1000}$/.test(claim.target)','&& /^\\/gui\\/(?:EnConvo|Grok Bot)\\/\\S{1,1000}$/.test(claim.target)','CLIENT_TARGET_PATCH_FAILED');
  const clientPath=path.join(workDir,'owner-session-client.oneshot.mjs');
  writeFileSync(clientPath,client,{mode:0o600});
  const mod=await import(pathToFileURL(clientPath).href+'?v='+Date.now());
  console.log('ONESHOT_RUNTIME_BUILD=PASS');
  console.log('ONESHOT_ISSUER_SHA256='+issuerSha);
  console.log('ONESHOT_CAPABILITY_SHA256='+capabilitySha);
  return {capability,capabilityPath,issuerPath,clientPath,OwnerSessionClient:mod.OwnerSessionClient,issuerSha,capabilitySha,MAX_SESSION_MS,MAX_OPERATIONS};
}
