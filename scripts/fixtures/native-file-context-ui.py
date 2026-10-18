"""Definitions only: fixed owned Native file mention and send actions; no launcher."""
import json
import math
import re
import time

PROMPTS = {"a": "NATIVE_G07C_READ_A 请读取引用文件后简短回复", "b": "NATIVE_G07C_READ_B 请读取引用文件后简短回复"}
NAMES = {"a": "G07_CONTEXT_A.txt", "b": "G07_CONTEXT_B.txt"}
ACTIONS = ("observe", "prepare_a", "mention_a", "send_a", "prepare_b", "mention_b", "send_b")


class NativeFileContextUi:
    def __init__(self, raw_js, raw_cdp, owned_guard, action_budget, claim_once, root, task_id=None):
        if not isinstance(root, str) or not re.fullmatch(r"/Users/ljp/Desktop/uwork_backend/data/client-native-file-context-[a-z0-9-]+", root):
            raise ValueError("FILE_UI_SCOPE_REJECTED")
        if task_id is not None and (task_id == "draft" or not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,160}", task_id)):
            raise ValueError("FILE_UI_TASK_REJECTED")
        self._js, self._cdp, self._guard, self._budget, self._claim = raw_js, raw_cdp, owned_guard, action_budget, claim_once
        self._task, self._used = task_id, set()
        workspace = root + "/project-file-context"
        ids = {"workspace": "workspace-item-" + workspace, "tree": "workspace-file-tree-button-" + workspace,
               "a": "workspace-file-tree-row-" + workspace + "/" + NAMES["a"], "b": "workspace-file-tree-row-" + workspace + "/" + NAMES["b"]}
        self._expression = """(()=>{
 const ids=IDS, prompts=PROMPTS, names=NAMES;
 const shown=e=>!!e&&!e.hidden&&e.getClientRects().length>0&&!e.closest('[aria-hidden=true]');
 const list=(base,selector)=>{const a=Array.from(base?.querySelectorAll(selector)??[]);if(a.length>64)throw Error('FILE_UI_OVERFLOW');return a;};
 const one=a=>{if(a.length>1)throw Error('FILE_UI_AMBIGUOUS');return a[0];};
 const tid=id=>one(list(document,'[data-testid="'+CSS.escape(id)+'"]').filter(shown));
 const input=tid('v4-composer-input'), text=input?.innerText??'';
 const pane=one(list(document,'[data-session-id][data-testid^="v4-session-pane-"]').filter(shown));
 const taskId=pane?.dataset.sessionId&&pane.dataset.sessionId!=='draft'?pane.dataset.sessionId:null;
 const rect=e=>{if(!shown(e))return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,hit:!!h&&(h===e||e.contains(h)),disabled:e.matches(':disabled')||e.getAttribute('aria-disabled')==='true'};};
 const mentions=s=>input?Array.from(input.querySelectorAll('[data-mention-category=files]')).filter(e=>e.dataset.mentionId==='dropped-file:'+names[s]).length:0;
 const menu=one(list(document,'[role=menuitem]').filter(e=>shown(e)&&e.textContent.trim()==='添加到聊天'));
 const reply=marker=>list(pane,'[data-testid^="v4-row-"][class~="group/assistant-row"] > [data-conversation-selectable="true"]').some(e=>shown(e)&&e.textContent.includes(marker));
 const model=one(list(tid('chat-model-select-trigger'),'.composer-provider-prefix + span'));
 return{authenticated:!!tid('enterprise-identity-name'),composerVisible:!!input,composerEmpty:text.trim()==='',promptA:text.includes(prompts.a),promptB:text.includes(prompts.b),mentionA:mentions('a'),mentionB:mentions('b'),workspaceMatches:tid('composer-workspace-trigger')?.innerText.trim()==='project-file-context',modelMatches:model?.textContent.trim()==='联动受控模型',stopPresent:!!tid('v4-stop'),replyA:reply('NATIVE_G07C_READ_CONFIRMED'),replyB:reply('NATIVE_G07C_DENIAL_CONFIRMED'),taskId,controls:{composer:rect(input),workspace:rect(tid(ids.workspace)),tree:rect(tid(ids.tree)),a:rect(tid(ids.a)),b:rect(tid(ids.b)),add:rect(menu)}};
})()""".replace("IDS", json.dumps(ids)).replace("PROMPTS", json.dumps(PROMPTS)).replace("NAMES", json.dumps(NAMES))

    def _own(self):
        self._budget()
        epoch = self._guard()
        if type(epoch) is not int or epoch != 1:
            raise ValueError("FILE_UI_OWNER_REJECTED")

    def _read(self):
        self._own()
        value = self._js(self._expression)
        flags = {"authenticated", "composerVisible", "composerEmpty", "promptA", "promptB", "workspaceMatches", "modelMatches", "stopPresent", "replyA", "replyB"}
        if not isinstance(value, dict) or set(value) != flags | {"mentionA", "mentionB", "taskId", "controls"} or any(type(value[k]) is not bool for k in flags):
            raise ValueError("FILE_UI_PROJECTION_REJECTED")
        if any(type(value[k]) is not int or value[k] not in (0, 1) for k in ("mentionA", "mentionB")):
            raise ValueError("FILE_UI_MENTION_REJECTED")
        if value["taskId"] is not None and (value["taskId"] == "draft" or not isinstance(value["taskId"], str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,160}", value["taskId"])):
            raise ValueError("FILE_UI_TASK_REJECTED")
        controls = value["controls"]
        if not isinstance(controls, dict) or set(controls) != {"composer", "workspace", "tree", "a", "b", "add"}:
            raise ValueError("FILE_UI_CONTROL_REJECTED")
        for rect in controls.values():
            if rect is not None and (not isinstance(rect, dict) or set(rect) != {"x", "y", "hit", "disabled"} or any(type(rect[k]) not in (int, float) or not math.isfinite(rect[k]) or abs(rect[k]) > 100000 for k in ("x", "y")) or type(rect["hit"]) is not bool or type(rect["disabled"]) is not bool):
                raise ValueError("FILE_UI_CONTROL_REJECTED")
        self._own()
        return value

    def _input(self, method, **params):
        self._own()
        self._cdp(method, **params)

    def _click(self, control, button="left"):
        value = self._read()["controls"][control]
        if value is None or not value["hit"] or value["disabled"]:
            raise ValueError("FILE_UI_CONTROL_REJECTED")
        for kind, buttons in (("mousePressed", 2 if button == "right" else 1), ("mouseReleased", 0)):
            self._input("Input.dispatchMouseEvent", type=kind, x=value["x"], y=value["y"], button=button, buttons=buttons, clickCount=1)

    def _wait(self, predicate):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            value = self._read()
            if predicate(value):
                return value
            time.sleep(.05)
        raise ValueError("FILE_UI_WAIT_REJECTED")

    def run(self, action):
        if action not in ACTIONS:
            raise ValueError("FILE_UI_ACTION_REJECTED")
        if action == "observe":
            return self._read()
        if action in self._used:
            raise ValueError("FILE_UI_ONCE_REJECTED")
        value = self._read()
        stage = action[-1]
        if stage == "b" and (self._task is None or value["taskId"] != self._task):
            raise ValueError("FILE_UI_TASK_REJECTED")
        # The workspace chip is draft-only; the actual first accepted task is then pinned.
        scope_matches = value["workspaceMatches"] or (self._task is not None and value["taskId"] == self._task)
        if not value["authenticated"] or not value["modelMatches"] or not scope_matches:
            raise ValueError("FILE_UI_CONTEXT_REJECTED")
        if self._claim(action) is not True:
            raise ValueError("FILE_UI_ONCE_REJECTED")
        self._used.add(action)
        if action.startswith("prepare_"):
            if not value["composerEmpty"] or value["mentionA"] or value["mentionB"]:
                raise ValueError("FILE_UI_DRAFT_REJECTED")
            self._click("composer")
            self._input("Input.insertText", text=PROMPTS[stage])
            value = self._wait(lambda s: s["prompt" + stage.upper()])
        elif action.startswith("mention_"):
            if not value["prompt" + stage.upper()] or value["mentionA"] or value["mentionB"]:
                raise ValueError("FILE_UI_DRAFT_REJECTED")
            if value["controls"][stage] is None:
                workspace = value["controls"]["workspace"]
                if workspace is None:
                    raise ValueError("FILE_UI_CONTROL_REJECTED")
                self._input("Input.dispatchMouseEvent", type="mouseMoved", x=workspace["x"], y=workspace["y"], button="none")
                self._click("tree")
                self._wait(lambda s: s["controls"][stage] is not None)
            self._click(stage, "right")
            self._wait(lambda s: s["controls"]["add"] is not None)
            self._click("add")
            value = self._wait(lambda s: s["mention" + stage.upper()] == 1)
        else:
            if not value["prompt" + stage.upper()] or value["mention" + stage.upper()] != 1 or value["stopPresent"]:
                raise ValueError("FILE_UI_DRAFT_REJECTED")
            self._click("composer")
            self._input("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter", windowsVirtualKeyCode=13, nativeVirtualKeyCode=13, text="\r", unmodifiedText="\r")
            self._input("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter", windowsVirtualKeyCode=13, nativeVirtualKeyCode=13)
            value = self._wait(lambda s: s["composerEmpty"] and s["taskId"] is not None)
            if stage == "a":
                self._task = value["taskId"]
            elif value["taskId"] != self._task:
                raise ValueError("FILE_UI_TASK_REJECTED")
        return value
