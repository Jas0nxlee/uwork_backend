"""Compile actual DOM read expressions before starting an owned runtime."""
import ast
import json
from pathlib import Path
import subprocess

path=Path(__file__).with_name('prepublish-plan-approval-case.py')
tree=ast.parse(path.read_text());values=dict(detail_only=False,json=json,FEEDBACK='反馈\n第二行',selector='[data-elicitation-dialog-card] textarea',marker='OWNED_PLAN_B',card={'x':1,'y':2},x=1,y=2)
expressions=[]
for call in ast.walk(tree):
    if not isinstance(call,ast.Call):continue
    if (isinstance(call.func,ast.Name) and call.func.id=='until') or (isinstance(call.func,ast.Attribute) and call.func.attr=='evaluate'):
        expression=eval(compile(ast.Expression(call.args[0]),str(path),'eval'),values)
        assert isinstance(expression,str);expressions.append(dict(line=call.lineno,expression=expression))
assert len(expressions)>=10
script="const fs=require('node:fs');for(const p of JSON.parse(fs.readFileSync(0,'utf8'))){try{new Function('return ('+p.expression+');')}catch(e){throw Error('driver line '+p.line+': '+e.message)}}"
r=subprocess.run(['node','-e',script],input=json.dumps(expressions),text=True,capture_output=True);assert r.returncode==0,r.stderr
print(json.dumps(dict(status='passed',actualDomExpressions=len(expressions))))
