const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const { runtime } = require('../scripts/qa-runtime.cjs');
const qa = runtime();
const env = qa.load('main/env.js');
const { AgentSession } = qa.load('main/agent.js');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
after(() => { qa.restore(); fs.rmSync(qa.dir, { recursive: true, force: true }); });
test('stop invalidates an in-flight sign-in check before an adapter can spawn', async () => {
 const original = { signedIn:env.signedIn, other:env.otherVideoDbServers, spawn:cp.spawn };
 const gate = deferred(); let spawned = false;
 env.signedIn = () => gate.promise; env.otherVideoDbServers = async () => [];
 cp.spawn = () => { spawned = true; throw new Error('stale startup spawned'); };
 try {
  const agent = new AgentSession(qa.dir,()=>{},()=>{});
  const run = agent.start('claude','test-key'); agent.stop(); gate.resolve(true); await run;
  assert.equal(spawned,false); assert.equal(agent.status.state,'off');
 } finally { env.signedIn=original.signedIn; env.otherVideoDbServers=original.other; cp.spawn=original.spawn; }
});
test('a stopped session cannot publish a late ready state or save its session', async () => {
 const gate=deferred();const agent=new AgentSession(qa.dir,()=>{},()=>{});
 agent.caps={load:true,list:true,close:false,images:true,name:'test'};
 agent.conn={agent:{request:()=>gate.promise,notify:async()=>{}},close:()=>{}};
 const opening=agent.openSession('claude');agent.stop();gate.resolve({sessionId:'stale'});await opening;
 assert.equal(agent.status.state,'off');assert.equal(agent.sessionId,undefined);
});
test('cancellation tolerates an already-closed ACP connection', async () => {
 const agent=new AgentSession(qa.dir,()=>{},()=>{});
 agent.sessionId='test';agent.conn={agent:{notify:()=>Promise.reject(new Error('ACP connection closed'))},close:()=>{}};
 agent.busy=true;agent.stop();await new Promise(r=>setImmediate(r));assert.equal(agent.busy,false);
});
test('settings persist concurrent independent patches without losing either', async () => {
 const {setSettings,getSettings}=qa.load('main/settings.js');
 await setSettings({apiKey:'sso-fixture',videoDbAuth:'sso'});
 await Promise.all([setSettings({agent:'codex'}),setSettings({onboarded:true})]);
 const result=await getSettings();assert.equal(result.agent,'codex');assert.equal(result.onboarded,true);
});

test('legacy keys and environment credentials cannot bypass SSO onboarding', async () => {
 const {getSettings}=qa.load('main/settings.js');
 const previous=process.env.VIDEO_DB_API_KEY;
 try {
  process.env.VIDEO_DB_API_KEY='environment-key';
  fs.writeFileSync(require('node:path').join(qa.settingsDir,'settings.json'),JSON.stringify({apiKey:'legacy-key',onboarded:true}));
  const settings=await getSettings();
  assert.equal(settings.apiKey,'');assert.equal(settings.onboarded,false);
 } finally {
  if(previous===undefined)delete process.env.VIDEO_DB_API_KEY;else process.env.VIDEO_DB_API_KEY=previous;
 }
});
