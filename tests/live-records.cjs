const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const prediction = require('../runner-prediction.js');
const source = fs.readFileSync('app.js','utf8');
const query = source.split('\n').find(line=>line.startsWith('async function queryBib('));
const refresh = source.slice(source.indexOf('async function refresh('),source.indexOf('async function share('));
const sync = source.split('\n').find(line=>line.startsWith('function syncCourseMarkers('));
let now = Date.parse('2026-10-31T08:31:00+09:00');
const event = {id:'race',date:'2026-10-31'};
const fiveK = [{point:'출발',elapsed:'00:00:00',timeOfDay:'08:00:00'},{point:'5K',elapsed:'00:30:00',timeOfDay:'08:30:00'}];
let records = {'race:1':{status:'ok',course:'FULL',segments:fiveK,fetchedAt:now-120000}};
let response = {course:'FULL',segments:fiveK};
let calls=0, renders=0, offline=false, release;
const pins=[];
const route = prediction.buildRoute([{lat:0,lon:0,ele:0},{lat:0,lon:0.4,ele:0}]);
const context = vm.createContext({
    Date:{now:()=>now,parse:Date.parse},URLSearchParams,
    state:{eventId:'race',bibs:['1'],names:{}},
    CACHE_TTL:300000,CACHE_KEY:'cache',refreshBusy:false,
    cache:()=>JSON.parse(JSON.stringify(records)),
    localStorage:{setItem(key,value){records=JSON.parse(value)}},
    selected:()=>event,syncSharedList:async()=>{},waitForRequestSlot:async()=>{},
    document:{hidden:false},location:{search:''},
    $:()=>({textContent:'',contentWindow:{postMessage(message){pins.push(prediction.predict(message.runners[0],route,null,now))}}}),
    callEdge:async()=>{calls++;if(release)await new Promise(resolve=>release=resolve);if(offline)throw new Error('offline');return response},
    renderResults(){renders++;vm.runInContext('syncCourseMarkers()',context)},
});
vm.runInContext(query+'\n'+refresh+'\n'+sync,context);
const run=code=>vm.runInContext(code,context);
(async()=>{
    await run('refresh({automatic:true})');
    assert.equal(calls,1);assert.equal(renders,1);assert.ok(pins.at(-1).progress>5000/42195);
    await run('refresh({automatic:true})');assert.equal(calls,1);
    now=Date.parse('2026-10-31T09:06:00+09:00');
    response={course:'FULL',segments:[...fiveK,{point:'10K',elapsed:'01:05:00',timeOfDay:'09:05:00'}]};
    await run('refresh({automatic:true})');
    assert.equal(calls,2);assert.equal(pins.at(-1).segmentPace,420);
    assert.ok(pins.at(-1).progress>10000/42195);
    assert.ok(pins.at(-1).progress<11000/42195);
    const before = pins.at(-1).progress;
    offline=true;now+=120000;
    await run('refresh({automatic:true})');
    assert.equal(records['race:1'].status,'ok');assert.equal(records['race:1'].segments.length,3);
    assert.ok(pins.at(-1).progress>=before);
    context.document.hidden=true;await run('refresh({automatic:true})');assert.equal(calls,3);
    context.document.hidden=false;now=Date.parse('2026-11-01T09:00:00+09:00');
    await run('refresh({automatic:true})');assert.equal(calls,3);
    now=Date.parse('2026-10-30T09:00:00+09:00');
    await run('refresh({automatic:true})');assert.equal(calls,3);
    now=Date.parse('2026-10-31T09:10:00+09:00');offline=false;release=true;
    const pending=run('refresh({automatic:true})');
    await new Promise(resolve=>setImmediate(resolve));
    await run('refresh({automatic:true})');assert.equal(calls,4);
    release();await pending;release=null;
    await run('refresh()');assert.equal(calls,5);
    assert.ok(!source.includes("c[`${e.id}:${b}`]={status:'loading'"));
    assert.ok(source.includes('setInterval(()=>refresh({automatic:true}),60000)'));
    console.log('PASS: 5K→10K re-anchors map with new split pace; polling, concurrency, failures, manual refresh, race-day/visibility guards');
})().catch(error=>{console.error(error);process.exitCode=1});
