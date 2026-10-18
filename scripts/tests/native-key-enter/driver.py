import ast,base64,json,pathlib,time
out=pathlib.Path(EVIDENCE)
expected=pathlib.Path(PAGE).as_uri()
def own():
    assert js('location.href')==expected,'Only own test HTML may receive input'
def facts():
    own()
    return json.loads(js("document.getElementById('facts').textContent"))
def capture(name):
    value=facts()
    with (out/(name+'-observed.json')).open('x')as f:json.dump(value,f,indent=2)
    with (out/(name+'.png')).open('xb')as f:f.write(base64.b64decode(cdp('Page.captureScreenshot',format='png')['data']))
    return value
def point(role,name):
    own()
    nodes=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(nodes)==1,(role,name,len(nodes))
    node=nodes[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node);q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content']
    return sum(q[0::2])/4,sum(q[1::2])/4
matches=[t for t in cdp('Target.getTargets')['targetInfos'] if t.get('type')=='page' and t.get('url')==expected]
assert len(matches)==1,'One owned Electron form target required'
switch_tab(matches[0]['targetId']);own()
raw=(out/'extracted-key.py').read_text();tree=ast.parse(raw);assert len(tree.body)==1 and isinstance(tree.body[0],ast.FunctionDef) and tree.body[0].name=='key'
exec(compile(tree,'AST-extracted-shared-key','exec'),globals())
scenarios=[('a','Shared Enter'),('b','Enter with carriage return'),('c','Submit positive control')]
results=[]
for name,label in scenarios:
    click_at_xy(*point('textbox',label));assert js('document.activeElement.id')=='input-'+name
    cdp('Input.insertText',text='OWNED_ENTER_PROTOCOL')
    assert js("document.activeElement.value==='OWNED_ENTER_PROTOCOL'")
    before=facts();start=len(before['rows'])
    if name=='a':key('Enter','Enter',0,13)
    elif name=='b':
        params=dict(key='Enter',code='Enter',modifiers=0,windowsVirtualKeyCode=13)
        cdp('Input.dispatchKeyEvent',type='keyDown',text='\r',unmodifiedText='\r',**params)
        cdp('Input.dispatchKeyEvent',type='keyUp',**params)
    else:click_at_xy(*point('button','Submit positive control'))
    time.sleep(.2)
    after=capture('scenario-'+name);events=after['rows'][start:]
    results.append({'scenario':name,'submitDelta':after['submits'][name]-before['submits'][name],'keydown':sum(e['type']=='keydown' and e['phase']=='bubble' for e in events),'keypress':sum(e['type']=='keypress' and e['phase']=='bubble' for e in events),'keyup':sum(e['type']=='keyup' and e['phase']=='bubble' for e in events),'events':events,'overflow':after['overflow']})
with(out/'results.json').open('x')as f:json.dump({'targetId':matches[0]['targetId'],'cases':results,'sharedKeyAstExecuted':True,'newTabsCreated':0,'credentialsRead':False,'businessStateInjected':False},f,indent=2)
assert all(r['overflow']==0 for r in results)
assert [r['submitDelta'] for r in results]==[1,1,1], 'Shared Enter, CR control and actual Submit must each submit once'
assert [r['keypress'] for r in results[:2]]==[1,1], 'Both Enter protocols must produce their trusted keypress'
print(json.dumps([{'scenario':r['scenario'],'submitDelta':r['submitDelta'],'keydown':r['keydown'],'keypress':r['keypress'],'keyup':r['keyup']}for r in results]))
