"""Compile actual generated projections with the repository's Node 24 before launch."""
import ast
import json
from pathlib import Path
import subprocess
import sys

path=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).with_name('prepublish-git-review-case.py')
assert path.name=='prepublish-git-review-case.py'
tree=ast.parse(path.read_text());values=dict(json=json,scope='body',label='已暂存',selector='[data-testid=git-pane]',value='review',markers=['OWNED_REVIEW_INDEX_B','OWNED_REVIEW_WORK_C'],count=2,x=1,y=2);expressions=[]
for call in ast.walk(tree):
    if isinstance(call,ast.Call) and ((isinstance(call.func,ast.Name) and call.func.id=='until') or (isinstance(call.func,ast.Attribute) and call.func.attr=='evaluate')):
        expression=eval(compile(ast.Expression(call.args[0]),str(path),'eval'),values);assert isinstance(expression,str);expressions.append(dict(line=call.lineno,expression=expression))
assert len(expressions)==12, "all twelve current DOM projections must be checked"
script="""
const fs=require('node:fs');
const expressions=JSON.parse(fs.readFileSync(0,'utf8'));
for(const p of expressions){try{new Function('return ('+p.expression+');')}catch(e){throw Error('driver line '+p.line+': '+e.message)}}
const lines=['OWNED_REVIEW_INDEX_B','OWNED_REVIEW_WORK_C'].map(text=>({textContent:text,getAttribute:()=> 'change'}));
const shadow={textContent:'OWNED_REVIEW_INDEX_BOWNED_REVIEW_WORK_C',querySelectorAll:s=>s==='[data-content] [data-line]'?lines:[]};
const pane={innerText:'Review header',querySelectorAll:s=>s==='*'?[{shadowRoot:shadow}]:[]};
const reads=expressions.filter(p=>p.expression.includes('function walk(r)'));
if(reads.length!==1)throw Error('expected exactly one original shadow projection');
const result=new Function('document','return ('+reads[0].expression+');')({querySelector:()=>pane});
if(!result.ok||!result.markers.includes('OWNED_REVIEW_INDEX_B')||!result.markers.includes('OWNED_REVIEW_WORK_C'))throw Error('visible code rows must remain separate in the actual projection');
"""
node='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
r=subprocess.run([node,'-e',script],input=json.dumps(expressions),text=True,capture_output=True);assert r.returncode==0,r.stderr
print(json.dumps(dict(status='passed',actualDomExpressions=len(expressions),nodeMajor=24,shadowRowsVerified=True)))
