import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('API, dashboard and URL safety smoke tests', async t => {
  const proc=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,PORT:'8189'},stdio:'ignore'});
  t.after(()=>proc.kill());
  const base='http://127.0.0.1:8189';let ready=false;
  for(let i=0;i<40;i++){try{const r=await fetch(base+'/api/health');if(r.ok){ready=true;break;}}catch{}await delay(100);}
  assert.equal(ready,true,'server should start');
  const health=await (await fetch(base+'/api/health')).json();assert.equal(health.ok,true);assert.equal(health.browserConfigured,false);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/ABDOLAH AI/);
  const blocked=await fetch(base+'/api/browser/navigate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'test',url:'http://127.0.0.1'})});
  assert.equal(blocked.status,400);assert.equal((await blocked.json()).error,'PRIVATE_NETWORK_BLOCKED');
  const scheme=await fetch(base+'/api/browser/navigate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'test',url:'file:///etc/passwd'})});
  assert.equal(scheme.status,400);assert.equal((await scheme.json()).error,'UNSUPPORTED_PROTOCOL');
});
