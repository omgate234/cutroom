const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const {runtime} = require('../scripts/qa-runtime.cjs');
const qa = runtime();
const {loginVideoDb,cancelVideoDbLogin}=qa.load('main/videodb-login.js');
const realFetch=global.fetch;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
afterEach(()=>{cancelVideoDbLogin();global.fetch=realFetch;});
after(()=>{qa.restore();fs.rmSync(qa.dir,{recursive:true,force:true});});
function setup(exchange=()=>Response.json({access_token:'fixture-credential',token_type:'Bearer'})) {
 const browser=deferred();let query;
 qa.electron.shell.openExternal=async url=>{query=new URL(url).searchParams;browser.resolve(query);};
 global.fetch=async (url,options)=> {
  if(String(url).endsWith('/oauth/register'))return Response.json({client_id:'fixture-client'});
  if(String(url).endsWith('/oauth/token')) {
   const p=new URLSearchParams(options.body);
   assert.equal(createHash('sha256').update(p.get('code_verifier')).digest('base64url'),query.get('code_challenge'));
   assert.equal(p.get('redirect_uri'),query.get('redirect_uri'));
   return exchange(p);
  }
  throw new Error('Unexpected network call');
 };
 const result=loginVideoDb().then(key=>({key}),error=>({error:error.message}));
 return {browser:browser.promise,result};
}
function callback(q,patch={}) {
 const url=new URL(q.get('redirect_uri'));
 for(const [key,value] of Object.entries({state:q.get('state'),iss:'https://console.videodb.io',code:'test-code',...patch}))url.searchParams.set(key,value);
 return realFetch(url,{signal:AbortSignal.timeout(3000)});
}
test('loopback login uses S256 PKCE and resolves only after credential exchange',async()=>{
 const flow=setup();const q=await flow.browser;
 assert.equal(q.get('code_challenge_method'),'S256');assert.equal(q.get('scope'),'videodb');
 assert.equal((await callback(q)).status,200);assert.deepEqual(await flow.result,{key:'fixture-credential'});
 await assert.rejects(callback(q));
});
test('wrong state and issuer are rejected without consuming the pending login',async()=>{
 const flow=setup();const q=await flow.browser;
 assert.equal((await callback(q,{state:'wrong'})).status,400);
 assert.equal((await callback(q,{iss:'https://foreign.test'})).status,400);
 await callback(q);assert.equal((await flow.result).key,'fixture-credential');
});
test('expired or rejected grants return actionable errors',async()=>{
 const flow=setup(()=>Response.json({error:'invalid_grant'},{status:400}));const q=await flow.browser;
 await callback(q);assert.match((await flow.result).error,/Please try signing in again/);
});
test('cancelling closes the callback and rejects the outstanding login',async()=>{
 const flow=setup();const q=await flow.browser;cancelVideoDbLogin();
 assert.match((await flow.result).error,/cancelled/);await assert.rejects(callback(q));
});
test('a registration finishing after cancellation cannot open a browser',async()=>{
 const gate=deferred();let opened=false;
 global.fetch=()=>gate.promise;qa.electron.shell.openExternal=async()=>{opened=true;};
 const result=loginVideoDb().catch(e=>e.message);
 await new Promise(r=>setTimeout(r,10));cancelVideoDbLogin();
 gate.resolve(Response.json({client_id:'late'}));assert.match(await result,/cancelled/);
 await new Promise(r=>setImmediate(r));assert.equal(opened,false);
});

test('HTML registration failures report service status instead of JSON syntax errors', async () => {
 global.fetch=async()=>new Response('<!DOCTYPE html><html>Not found</html>',{status:404,headers:{'Content-Type':'text/html'}});
 await assert.rejects(loginVideoDb(),/not available on the server yet/);
});
test('HTML token failures report service status instead of JSON syntax errors', async () => {
 const flow=setup(()=>new Response('<!DOCTYPE html>',{status:404}));const q=await flow.browser;
 await callback(q);assert.match((await flow.result).error,/not available on the server yet/);
});
