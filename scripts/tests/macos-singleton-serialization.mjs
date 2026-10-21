// Pure production-factory/V8 replay of the pinned upstream POSIX framing.
// No Electron app import, GUI, singleton lock, or protocol registration.
import assert from 'node:assert/strict';
import { serialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { createDeepLinkSingleInstanceData } from '../../clients/uwork/packages/desktop/src/main/desktopDeepLinkUrl.ts';

const fixtureRoot='/Users/ljp/Desktop/uwork_backend/data/client-native-macos-confirmation-prepared-v3-20261020';
const executable='/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v6-clock/mac-arm64/UWork Preview.app/Contents/MacOS/UWork Preview';
const whitespace=new Set([9,10,11,12,13,32]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function split(input,trim){
  const chunks=[];let start=0;
  for(let end=0;end<=input.length;end++)if(end===input.length||input[end]===0){
    let left=start,right=end;
    if(trim){while(left<right&&whitespace.has(input[left]))left++;while(right>left&&whitespace.has(input[right-1]))right--;}
    chunks.push(input.subarray(left,right));start=end+1;
  }
  return chunks;
}
function join(chunks){return Buffer.concat(chunks.flatMap((chunk,index)=>index?[Buffer.from([0]),chunk]:[chunk]));}
function frame(argv,data){
  return join([Buffer.from('START'),Buffer.from(fixtureRoot+'/runtime/app'),Buffer.from(String(argv.length)),
    ...argv.map(arg=>Buffer.from(arg)),Buffer.from(String(data.length)),data]);
}
function receive(packet,trim){
  const tokens=split(packet,trim).slice(2),argc=Number(tokens[0].toString());
  const declared=Number(tokens[1+argc].toString()),payload=join(tokens.slice(2+argc));
  return {declared,payload,tooShort:declared>payload.length};
}
const cases=[
  ['ascii',fixtureRoot+'/project',false],
  ['ascii-wide-slice',('中'+fixtureRoot+'/ascii project'+'中').slice(1,-1),false],
  ['ascii-unicode-trim','\u3000'+fixtureRoot+'/ascii project'+'\u3000',false],
  ['unicode-no-space',fixtureRoot+'/项目',false],
  ['native-failed-unicode-space',fixtureRoot+'/project 基线',false],
  ['encoded-workspace-uri','zcode://workspace/open?path='+encodeURIComponent(fixtureRoot+'/确认 中文 空格'),true],
];
const results=cases.map(([name,path,uri])=>{
  const argv=uri?[executable,path]:[executable,'--open-workspace',path];
  const object=createDeepLinkSingleInstanceData(argv),data=serialize(object),packet=frame(argv,data);
  const old=receive(packet,true),fixedUpstream=receive(packet,false);
  let nulWhitespacePairs=0;
  for(let i=0;i<data.length-1;i++)if(data[i]===0&&whitespace.has(data[i+1]))nulWhitespacePairs++;
  assert.ok(fixedUpstream.payload.equals(data),'KEEP_WHITESPACE control must preserve every byte');
  return {name,argvCount:argv.length,additionalDataKeys:Object.keys(object),serializedBytes:data.length,serializedSha256:sha(data),
    nulWhitespacePairs,oldNativeTrim:{declared:old.declared,received:old.payload.length,tooShort:old.tooShort,preserved:old.payload.equals(data)},
    upstreamKeepControl:{received:fixedUpstream.payload.length,preserved:true}};
});
const lost=results.filter(row=>!row.oldNativeTrim.preserved);
console.log(JSON.stringify({status:lost.length?'contract-red':'contract-green',runtime:{electron:process.versions.electron??null,node:process.versions.node,v8:process.versions.v8,runAsNode:process.env.ELECTRON_RUN_AS_NODE==='1'},
  productionFactory:'desktopDeepLinkUrl.ts:createDeepLinkSingleInstanceData',results,
  boundary:'Actual runtime v8.serialize and original production object factory; pinned native framing replay, not a live C++ singleton invocation',
  appImported:false,guiStarted:false,protocolTouched:false,fuseChanged:false}));
if(lost.length){console.error('ASSERT_ADDITIONAL_DATA_SIZE_EXCEEDS_PAYLOAD');process.exitCode=1;}
