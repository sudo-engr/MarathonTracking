const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js','utf8').replace("if(new URLSearchParams(location.search).has('mock')){watchCourseMap()}else{initialize()}", '');
const calls=[], database=new Map(), storage=new Map(), nodes=new Map();
let serial=0, clipboard='', fail=false;
const location={href:'https://test.example/?event=myresult-176&bibs=3909&names=old',search:''};
const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',value:'',hidden:false,style:{},parentElement:{},addEventListener(){},getAttribute(){return ''},contentWindow:{postMessage(){}},replaceChildren(text){this.textContent=text},append(){}});return nodes.get(id)};
const context=vm.createContext({
  URL,URLSearchParams,Date,Promise,setTimeout,clearTimeout,setInterval(){},window:{addEventListener(){}},
  location,history:{replaceState(a,b,url){location.href=url;location.search=new URL(url).search}},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{getElementById:node,addEventListener(){},createElement:()=>({}),querySelectorAll:()=>[]},
  navigator:{clipboard:{async writeText(text){clipboard=text}}},
  fetch:async(url,options)=>{
    assert.equal(url,'/api/tracking-lists');const body=JSON.parse(options.body);calls.push(body);
    if(fail)return {ok:false,status:503,json:async()=>({error:'unavailable'})};
    let data;
    if(body.action==='create'){
      const token=(++serial).toString(16).padStart(64,'0'),editToken=('e'+serial).padStart(64,'0');
      data={...body,token,editToken,expiresAt:'2026-11-23T00:00:00Z'};database.set(token,data);
    }else if(body.action==='read'){data=database.get(body.token)}
    else if(body.action==='update'){
      const existing=database.get(body.token);assert.equal(body.editToken,existing.editToken);data={...existing,...body};database.set(body.token,data);
    }else if(body.action==='revoke'){assert.equal(body.editToken,database.get(body.token).editToken);database.delete(body.token);data={ok:true}}
    return {ok:!!data,status:data?200:404,json:async()=>data||{error:'NOT_FOUND'}};
  },
});
vm.runInContext(source,context);
const run=code=>vm.runInContext(code,context);
(async()=>{
  run("state={eventId:'myresult-176',bibs:['3909'],names:{'myresult-176:3909':'김현일'}}");
  const first=run('saveState()');run("state.bibs.push('3358'); state.names['myresult-176:3358']='손지엽'");const second=run('saveState()');
  await Promise.all([first,second]);
  assert.deepEqual(calls.map(c=>c.action),['create','update']);
  const owned=JSON.parse(run('JSON.stringify(state.list)'));
  assert.deepEqual(database.get(owned.token).bibs,['3909','3358']);
  await run('share()');assert.ok(clipboard.includes('?share='));assert.ok(!/bibs|names|event=|editToken/.test(clipboard));
  assert.ok(!location.href.includes('3909'));
  // Reload uses Supabase and preserves this browser's edit credential.
  run('state=loadState()');await run('importShare()');assert.equal(run('state.list.editToken'),owned.editToken);
  // A viewer gets read access; sharing again must not create another list.
  run('state={eventId:"",bibs:[],names:{}}');await run('importShare()');
  const count=calls.filter(c=>c.action==='create').length;
  await run('share()');assert.equal(calls.filter(c=>c.action==='create').length,count);
  assert.equal(run('state.list.editToken'),undefined);
  // An already-open viewer reads additions from the same shared list without sharing again.
  const original=database.get(owned.token);
  database.set(owned.token,{...original,bibs:[...original.bibs,'2222']});
  await run('syncSharedList()');
  assert.ok(run("state.bibs.includes('2222')"));
  assert.equal(run('state.list.token'),owned.token);
  assert.equal(calls.filter(c=>c.action==='create').length,count);
  database.set(owned.token,original);await run('syncSharedList()');
  run("state.names['myresult-176:3909']='수정본'");await run('saveState()');
  assert.notEqual(run('state.list.token'),owned.token);assert.equal(database.get(owned.token).names['3909'],'김현일');
  fail=true;run("state.bibs.push('777')");assert.equal(await run('saveState()'),false);
  assert.match(node('saveStatus').textContent,/실패/);assert.ok(storage.get('marathon-tracking-v1').includes('777'));
  fail=false;run('state=loadState()');await run('importShare()');assert.ok(run("state.bibs.includes('777')"));await run('share()');assert.deepEqual(database.get(run('state.list.token')).bibs,['3909','3358','777']);
  const fork=run('state.list.token');await run('clearSavedList()');assert.ok(!database.has(fork));assert.ok(database.has(owned.token));
  // Legacy links migrate once, with the same bib/name data and a clean URL.
  run('state='+JSON.stringify({eventId:'myresult-176',bibs:['111'],names:{},list:owned}));
  location.href='https://test.example/?event=myresult-176&bibs=3909&names='+encodeURIComponent('{"3909":"기존 이름"}');location.search=new URL(location.href).search;
  await run('importShare()');assert.equal(run("state.names['myresult-176:3909']"),'기존 이름');assert.ok(!location.href.includes('names='));
  assert.equal(run("escapeHtml('<img src=x onerror=alert(1)>')"),'&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(run("recordUrl('javascript:alert(1)','https://safe.example/')"),'https://safe.example/');
  console.log('PASS: Supabase autosave, serialized edits, owner reload, read-only sharing/fork, errors/retry, revocation, legacy migration, escaped names');
})().catch(error=>{console.error(error);process.exitCode=1});
