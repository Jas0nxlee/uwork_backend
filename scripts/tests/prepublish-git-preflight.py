"""Compile and execute actual DOM reads against a bounded stub before GUI."""
import ast
import json
from pathlib import Path
import subprocess
import sys

path=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).with_name('prepublish-git-commit-case.py')
assert path.name=='prepublish-git-commit-case.py'
tree=ast.parse(path.read_text());values=dict(json=json,expected='test: 记录',selector='[data-testid=git-commit-message-input]');expressions=[]
for call in ast.walk(tree):
    if isinstance(call,ast.Call) and ((isinstance(call.func,ast.Name) and call.func.id=='until') or (isinstance(call.func,ast.Attribute) and call.func.attr=='evaluate')):
        expression=eval(compile(ast.Expression(call.args[0]),str(path),'eval'),values);assert isinstance(expression,str);expressions.append(dict(line=call.lineno,expression=expression))
assert len(expressions)>=10
script="""
const fs=require('node:fs'),vm=require('node:vm');
const element={disabled:false,value:'test: 记录',getAttribute:()=> 'false',hasAttribute:()=>false};
const document={body:{innerText:'原生企业资产联动完成。'},querySelector:s=>s.includes('v4-stop')?null:element,querySelectorAll:()=>[]};
for(const p of JSON.parse(fs.readFileSync(0,'utf8'))){
 const result=vm.runInNewContext('('+p.expression+')',{document},{timeout:100});
 if(typeof result?.ok!=='boolean')throw Error('driver line '+p.line+': ok must be a boolean, not a DOM reference');
 if(JSON.stringify(result).length>4096)throw Error('unbounded projection at '+p.line);
}
"""
r=subprocess.run(['node','-e',script],input=json.dumps(expressions),text=True,capture_output=True);assert r.returncode==0,r.stderr
print(json.dumps(dict(status='passed',actualDomExpressions=len(expressions),boundedBooleanProjections=True)))
