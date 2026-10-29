const STORAGE_KEY = 'marathon-tracking-v1';
const CACHE_KEY = 'marathon-tracking-cache-v2';
const SUPABASE_URL = '/api';
// Edge Function의 verify_jwt 검증에는 레거시 anon JWT를 사용한다.
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5cnJwYXF2d2ZlYWNvd21vc2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDYyMzMsImV4cCI6MjEwODA4MjIzM30.xLvhRTDA7MSrYiGF7n5e_dGFPw4sxohq-5tWuBSp95E';
const CACHE_TTL = 5 * 60 * 1000;
const MIN_REQUEST_INTERVAL = 1500;
let lastExternalRequestAt = 0;
const EVENTS = [
  { id:'myresult-176', name:'2026 춘천마라톤', date:'2026-10-25', source:'MyResult', url:'https://myresult.co.kr/176/' },
  { id:'myresult-177', name:'2026 JTBC 서울마라톤', date:'2026-11-01', source:'MyResult', url:'https://myresult.co.kr/177/' }
];
const NAME_INDEX = {'myresult-176': {'김현일': ['8880','12624']}};
let state = loadState();
let saveQueue = Promise.resolve();
let shareBusy = false;
let listSyncBusy = false;
const $ = id => document.getElementById(id);
let fullscreenMapFrame = null;
let fullscreenMapScroll = null;
function resizeCourseMap(frame = $('courseMapFrame')){if(!frame||frame.classList.contains('is-map-fullscreen'))return;try{const doc=frame.contentDocument;if(doc.fullscreenElement)return;const height=Math.max(doc.body.scrollHeight,doc.documentElement.scrollHeight);if(height>=400)frame.style.height=`${height}px`}catch{} }
function setMapFullscreen(frame, active){
  if(active&&fullscreenMapFrame===frame)return;
  if(active){
    if(fullscreenMapFrame&&fullscreenMapFrame!==frame){
      const previous=fullscreenMapFrame;
      setMapFullscreen(previous,false);
      previous.contentWindow.postMessage({type:'marathon-map-exit-fullscreen'},'*');
    }
    if(!fullscreenMapFrame)fullscreenMapScroll={x:window.scrollX,y:window.scrollY};
    fullscreenMapFrame=frame;
    frame.classList.add('is-map-fullscreen');
    document.documentElement.classList.add('map-fullscreen');
    if(frame.showPopover){
      frame.setAttribute('popover','manual');
      try{frame.showPopover()}catch{frame.removeAttribute('popover')}
    }
  }else{
    if(frame.hasAttribute('popover')){try{frame.hidePopover()}catch{}frame.removeAttribute('popover')}
    frame.classList.remove('is-map-fullscreen');
    const scroll=fullscreenMapFrame===frame?fullscreenMapScroll:null;
    if(fullscreenMapFrame===frame)fullscreenMapFrame=null;
    document.documentElement.classList.toggle('map-fullscreen',!!fullscreenMapFrame);
    if(scroll){fullscreenMapScroll=null;window.scrollTo(scroll.x,scroll.y)}
  }
}
window.addEventListener('message',event=>{
  if(event.data?.type!=='marathon-map-fullscreen'||typeof event.data.active!=='boolean')return;
  const frame=[$('courseMapFrame'),$('courseMapFrame10k')].find(frame=>frame?.contentWindow===event.source);
  if(frame)setMapFullscreen(frame,event.data.active);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&fullscreenMapFrame)fullscreenMapFrame.contentWindow.postMessage({type:'marathon-map-exit-fullscreen'},'*')});
function watchCourseMap(){const frame=$('courseMapFrame');if(!frame)return;const sync=()=>{resizeCourseMap();syncCourseMarkers()};frame.addEventListener('load',()=>{sync();try{new ResizeObserver(sync).observe(frame.contentDocument.body)}catch{}},{once:true});sync();let n=0;const timer=setInterval(()=>{sync();if(++n>100)clearInterval(timer)},300)}
function syncCourseMarkers(){const e=selected(),frame=$('courseMapFrame'),frame10k=$('courseMapFrame10k');if(!e||!frame)return;const beforeRace=Date.now()<Date.parse(e.date+'T00:00:00+09:00');const c=cache(),is10k=b=>String(c[`${e.id}:${b}`]?.course||'').trim().toUpperCase()==='10K',makeRunners=filter=>state.bibs.filter(filter).map(b=>{const r=c[`${e.id}:${b}`];if(!r||r.status!=='ok')return null;const total=parseTime(r.total),last=r.segments?.[r.segments.length-1];return {bib:b,name:state.names?.[`${e.id}:${b}`]||r.name,progress:!beforeRace&&total?Math.min(1,parseTime(last?.elapsed||r.total)/total):0}}).filter(Boolean);const mixed=state.bibs.some(is10k)&&state.bibs.some(b=>!is10k(b));frame.contentWindow?.postMessage({type:'marathon-runners',runners:makeRunners(mixed?b=>!is10k(b):()=>true)},'*');if(mixed)frame10k?.contentWindow?.postMessage({type:'marathon-runners',runners:makeRunners(is10k)},'*')}
function parseTime(value){const m=String(value||'').match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0}
function loadState(){try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY))||{};return {eventId:EVENTS.some(e=>e.id===saved.eventId)?saved.eventId:'',bibs:Array.isArray(saved.bibs)?saved.bibs.filter(b=>/^\d{1,8}$/.test(b)).slice(0,50):[],names:saved.names&&typeof saved.names==='object'?saved.names:{},list:saved.list&&/^[a-f0-9]{64}$/.test(saved.list.token)?saved.list:null}}catch{return {eventId:'',bibs:[],names:{}}}}
function persistLocalState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function listPayload(){return {eventId:state.eventId,bibs:[...state.bibs],names:Object.fromEntries(state.bibs.map(b=>[b,state.names?.[`${state.eventId}:${b}`]?.trim()]).filter(([,name])=>name))}}
async function callListApi(body){
  const response=await fetch('/api/tracking-lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||`저장 요청 실패 (HTTP ${response.status})`);
  return data;
}
function listUrl(token){const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('share',token);return url.toString()}
function saveState(){
  if(state.list&&(state.list.eventId!==state.eventId||(state.list.token&&!state.list.editToken)))state.list=null;
  const payload=listPayload();
  if(!payload.eventId||(!payload.bibs.length&&!state.list)){persistLocalState();return Promise.resolve(true)}
  const list=state.list ||= {eventId:state.eventId};
  list.dirty=true;
  persistLocalState();
  $('saveStatus').textContent='Supabase에 저장 중…';
  const task=saveQueue.then(async()=>{
    if(list.revoked)return false;
    const data=await callListApi({...payload,action:list.token?'update':'create',...(list.token?{token:list.token,editToken:list.editToken}:{})});
    Object.assign(list,{token:data.token||list.token,editToken:data.editToken||list.editToken,expiresAt:data.expiresAt});
    if(state.list===list){list.dirty=JSON.stringify(listPayload())!==JSON.stringify(payload);persistLocalState();history.replaceState(null,'',listUrl(list.token));$('saveStatus').textContent=`Supabase에 저장됨 · 공유 링크 만료: ${new Date(list.expiresAt).toLocaleDateString('ko-KR')}`}
    return true;
  }).catch(()=>{if(state.list===list)$('saveStatus').textContent='서버 저장 실패. 이 브라우저에 보관했습니다. 공유 버튼으로 다시 저장할 수 있습니다.';return false});
  saveQueue=task;
  return task;
}
async function clearSavedList(){
  const list=state.list;
  const controls=[...document.querySelectorAll('input,button')];controls.forEach(el=>el.disabled=true);
  try{
    await saveQueue;
    if(list?.editToken&&list.token)await callListApi({action:'revoke',token:list.token,editToken:list.editToken});
    if(list)list.revoked=true;
    state={eventId:'',bibs:[],names:{}};persistLocalState();
    const url=new URL(location.href);url.search='';url.hash='';history.replaceState(null,'',url.toString());
    render();$('saveStatus').textContent=list?.editToken?'저장된 목록과 공유 링크를 삭제했습니다.':'이 브라우저의 목록을 비웠습니다.';
  }catch{$('saveStatus').textContent='서버 삭제 실패. 목록을 보존했습니다. 다시 시도해 주세요.'}
  finally{controls.forEach(el=>el.disabled=false)}
}
function selected(){return EVENTS.find(e=>e.id===state.eventId)}
function renderEvents(){const q=$('eventSearch').value.trim().toLowerCase();$('eventList').innerHTML=EVENTS.filter(e=>`${e.name} ${e.source} ${e.date}`.toLowerCase().includes(q)).map(e=>`<button class="event-option ${e.id===state.eventId?'selected':''}" data-event="${e.id}"><span><strong>${e.name}</strong><small>${e.date}</small></span><span class="source">${e.source}</span></button>`).join('')||'<p class="status">검색 결과가 없습니다.</p>'}
function render(){const e=selected();$('selectedEvent').textContent=e?`${e.name} · ${e.source}`:'먼저 대회를 선택하세요.';$('bibList').innerHTML=state.bibs.map(b=>`<span class="bib-chip">${b}<button aria-label="${b} 삭제" data-remove="${b}">×</button></span>`).join('');renderEvents();renderResults()}
function renderCandidates(name){const matches=NAME_INDEX[state.eventId]?.[name]||[];$('candidateList').innerHTML=matches.map(b=>`<button class="candidate-option" data-candidate="${b}">#${b} ${name}<small>배번 추가</small></button>`).join('')}
function cache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY))||{}}catch{return {}}}
function renderResults(){const e=selected();const hasCourse=e?.id==='myresult-176'||e?.id==='myresult-177';$('courseMap').hidden=!hasCourse;$('courseMap').parentElement.hidden=!hasCourse;if(hasCourse){$('courseEventName').textContent=e.name;$('courseSource').textContent='| GPX';renderCourseMaps()}else{$('courseMap10k').hidden=true;}if(!e||!state.bibs.length){$('results').innerHTML='';$('status').textContent='조회할 배번을 추가하세요.';return}const c=cache();$('results').innerHTML=state.bibs.map(b=>{const key=`${e.id}:${b}`,r=c[key];return r?card(e,b,r):`<div class="result-card is-collapsed"><div class="result-head" aria-expanded="false"><strong>배번 ${b}</strong><span class="result-meta">미조회</span></div><p class="result-meta">기록 조회 버튼을 눌러 확인하세요.</p></div>`}).join('');syncCourseMarkers()}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function recordUrl(value,fallback){try{const url=new URL(value);return /^https?:$/.test(url.protocol)?escapeHtml(url.href):fallback}catch{return fallback}}
function card(e,b,r){const name=escapeHtml(state.names?.[`${e.id}:${b}`]||r.name);if(r.status!=='ok')return `<div class="result-card is-collapsed"><div class="result-head" aria-expanded="false"><strong>배번 ${b}</strong><span class="result-meta">${escapeHtml(r.status)}</span></div><p class="result-meta">${escapeHtml(r.message)}</p><a href="${e.url}${b}" target="_blank" rel="noreferrer">원본 사이트에서 확인 ↗</a></div>`;const rows=(r.segments||[]).map(s=>`<tr><td>${escapeHtml(s.point)}</td><td>${escapeHtml(s.timeOfDay)}</td><td>${escapeHtml(s.split)}</td><td>${escapeHtml(s.elapsed)}</td></tr>`).join('');return `<div class="result-card is-collapsed"><div class="result-head" aria-expanded="false"><strong>${name||`배번 ${b}`} <span class="bib-number">#${b}</span> <button class="name-edit" data-edit-name="${b}" aria-label="이름 수정">✎</button></strong><span class="result-meta">${e.source}</span></div><div class="result-grid"><div class="metric"><small>총기록</small><b>${escapeHtml(r.total||'—')}</b></div><div class="metric"><small>구간 수</small><b>${r.segments?.length||0}</b></div><div class="metric"><small>조회 시각</small><b>${new Date(r.fetchedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</b></div></div><div class="segment-table"><table><thead><tr><th>구간명</th><th>통과시간</th><th>구간기록</th><th>누적기록</th></tr></thead><tbody>${rows}</tbody></table></div><a href="${recordUrl(r.sourceUrl,e.url+b)}" target="_blank" rel="noreferrer">원본 기록 열기 ↗</a></div>`}
async function callEdge(e,query){const r=await fetch(`${SUPABASE_URL}/myresult-search-v5`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:e.id.replace('myresult-',''),query})});const data=await r.json();if(!r.ok)throw new Error(data.error||`HTTP ${escapeHtml(r.status)}`);return data}
async function waitForRequestSlot(){const wait=Math.max(0,MIN_REQUEST_INTERVAL-(Date.now()-lastExternalRequestAt));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastExternalRequestAt=Date.now()}
async function queryBib(e,b){const c=cache();const key=`${e.id}:${b}`;if(c[key]?.status==='ok'&&Date.now()-c[key].fetchedAt<CACHE_TTL)return c[key];try{await waitForRequestSlot();const data=await callEdge(e,b);const result={status:'ok',name:data.name,course:data.course,total:data.total,segments:data.segments||[],sourceUrl:data.sourceUrl,fetchedAt:Date.now()};c[key]=result;localStorage.setItem(CACHE_KEY,JSON.stringify(c));return result}catch(error){const result={status:'error',message:error.message,sourceUrl:e.url+b,fetchedAt:Date.now()};c[key]=result;localStorage.setItem(CACHE_KEY,JSON.stringify(c));return result}}
async function syncSharedList(){
  const list=state.list;
  if(listSyncBusy||!list?.token||list.editToken)return;
  listSyncBusy=true;
  try{
    const data=await callListApi({action:'read',token:list.token});
    if(state.list!==list)return;
    const payload={eventId:data.eventId,bibs:data.bibs,names:data.names};
    if(JSON.stringify(listPayload())===JSON.stringify(payload))return;
    state={eventId:data.eventId,bibs:data.bibs,names:Object.fromEntries(Object.entries(data.names).map(([bib,name])=>[`${data.eventId}:${bib}`,name])),list};
    persistLocalState();render();
  }catch{$('saveStatus').textContent='공유 목록 갱신 실패. 네트워크 연결 또는 링크 만료 여부를 확인하세요.'}
  finally{listSyncBusy=false}
}
async function refresh(){await syncSharedList();const e=selected();if(!e||!state.bibs.length)return;$('status').textContent=`${state.bibs.length}개 배번을 순차 확인하는 중…`;for(const b of state.bibs){const c=cache();c[`${e.id}:${b}`]={status:'loading',fetchedAt:Date.now()};localStorage.setItem(CACHE_KEY,JSON.stringify(c));renderResults();await queryBib(e,b);renderResults()}$('status').textContent='조회가 완료되었습니다. 자동 연동이 없는 기록은 원본 링크에서 확인하세요.'}
async function share(){
  if(shareBusy||!selected()||!state.bibs.length)return;
  shareBusy=true;$('shareBtn').disabled=true;
  try{
    if((!state.list?.token||state.list.editToken)&&!await saveState())throw new Error('Supabase 저장에 실패했습니다. 다시 시도해 주세요.');
    const url=listUrl(state.list.token);
    try{await navigator.clipboard.writeText(url);$('status').textContent='공유 링크를 복사했습니다.'}
    catch{$('status').replaceChildren('공유 링크: ');const link=document.createElement('a');link.href=url;link.textContent=url;$('status').append(link)}
  }catch(error){$('status').textContent=error.message}
  finally{shareBusy=false;$('shareBtn').disabled=false}
}
async function importShare(){
  const params=new URLSearchParams(location.search),token=params.get('share')||(!params.has('event')?state.list?.token:null);
  if(token){
    if(state.list?.token===token&&state.list.editToken&&state.list.dirty){await saveState();return true}
    if(!/^[a-f0-9]{64}$/.test(token))throw new Error('올바르지 않은 공유 링크입니다.');
    const data=await callListApi({action:'read',token});
    const owned=state.list?.token===token&&state.list.editToken?state.list:null;
    state={eventId:data.eventId,bibs:data.bibs,names:Object.fromEntries(Object.entries(data.names).map(([bib,name])=>[`${data.eventId}:${bib}`,name])),list:owned||{eventId:data.eventId,token,expiresAt:data.expiresAt}};
    persistLocalState();history.replaceState(null,'',listUrl(token));
    $('saveStatus').textContent=owned?'Supabase에서 저장된 목록을 불러왔습니다.':'공유 목록입니다. 수정하면 내 목록으로 별도 저장됩니다.';
    return true;
  }
  const id=params.get('event'),bibs=(params.get('bibs')||'').split(',').filter(b=>/^\d{1,8}$/.test(b)).slice(0,50);
  if(EVENTS.some(e=>e.id===id)&&bibs.length){
    let names={};try{const parsed=JSON.parse(params.get('names')||'{}');names=Object.fromEntries(Object.entries(parsed).filter(([bib,name])=>bibs.includes(bib)&&typeof name==='string'&&name.trim().length<=60).map(([bib,name])=>[`${id}:${bib}`,name.trim()]))}catch{}
    state={eventId:id,bibs:[...new Set(bibs)],names};
    // 기존 공유 링크는 한 번 읽은 뒤 개인정보가 없는 링크로 전환한다.
    const url=new URL(location.href);url.search='';history.replaceState(null,'',url.toString());
  }
  if(state.bibs.length){await saveState();return true}
  return false;
}
$('eventSearch').addEventListener('input',renderEvents);$('eventList').addEventListener('click',e=>{const id=e.target.closest('[data-event]')?.dataset.event;if(id){state.eventId=id;saveState();render()}});$('bibForm').addEventListener('submit',e=>{e.preventDefault();const query=$('bibInput').value.trim();if(!state.eventId){$('status').textContent='먼저 대회를 선택하세요.';return}if(!query){$('status').textContent='이름 또는 배번을 입력하세요.';return}if(!/^\d{1,8}$/.test(query)){$('status').textContent=`“${query}” 이름 검색은 공식 검색 연동 후 후보 배번을 표시할 수 있습니다. 현재는 원본 사이트에서 검색해 주세요.`;return}if(!state.bibs.includes(query))state.bibs.push(query);$('bibInput').value='';saveState();render();$('status').textContent=`배번 ${query}을(를) 추가했습니다.`});$('bibList').addEventListener('click',e=>{const b=e.target.dataset.remove;if(b){state.bibs=state.bibs.filter(x=>x!==b);saveState();render()}});$('refreshBtn').addEventListener('click',refresh);$('shareBtn').addEventListener('click',share);$('clearBtn').addEventListener('click',clearSavedList);
 $('bibForm').addEventListener('submit',()=>{const query=$('bibInput').value.trim();if(query&&!/^\d{1,8}$/.test(query)){renderCandidates(query)}});$('candidateList').addEventListener('click',e=>{const b=e.target.closest('[data-candidate]')?.dataset.candidate;if(b&&!state.bibs.includes(b)){state.bibs.push(b);saveState();render();$('status').textContent=`배번 ${b}을(를) 추가했습니다.`}});document.addEventListener('click',e=>{const head=e.target.closest('.result-head,.course-map-title,.setup-panel>.panel-title,.bib-panel>.panel-title');if(!head)return;const card=head.closest('.result-card,.course-map,.setup-panel,.bib-panel');if(card){card.classList.toggle('is-collapsed');head.setAttribute('aria-expanded',String(!card.classList.contains('is-collapsed')))}});
// 공식 Edge Function 검색 결과를 후보 목록에 반영한다.
$('bibForm').addEventListener('submit',async()=>{const query=$('bibInput').value.trim();const e=selected();if(!e||!query||/^\d{1,8}$/.test(query))return;$('status').textContent='이름으로 참가자를 검색하는 중…';try{const data=await callEdge(e,query);const candidates=Array.isArray(data.candidates)?data.candidates:[];$('candidateList').innerHTML=candidates.map(c=>`<button class="candidate-option" data-candidate="${c.num}">#${c.num} ${c.name}<small>배번 추가</small></button>`).join('')||'<p class="status">검색 결과가 없습니다.</p>';$('status').textContent=candidates.length?'검색 결과에서 배번을 선택하세요.':'검색 결과가 없습니다.'}catch(error){$('status').textContent=`이름 검색 실패: ${error.message}`}});
const splitFrame=$('courseMapFrame10k');splitFrame?.addEventListener('load',()=>{try{const resize=()=>resizeCourseMap(splitFrame);resize();new ResizeObserver(resize).observe(splitFrame.contentDocument.body)}catch{}syncCourseMarkers()});
let editingBib='';document.addEventListener('click',e=>{const button=e.target.closest('[data-edit-name]');if(!button)return;e.stopImmediatePropagation();const eInfo=selected();if(!eInfo)return;editingBib=button.dataset.editName;state.names ||= {};$('nameEditInput').value=state.names[`${eInfo.id}:${editingBib}`]||'';$('nameDialog').showModal()});$('nameForm').addEventListener('submit',e=>{if(e.submitter?.value!=='save')return;const eInfo=selected();if(!eInfo)return;state.names[`${eInfo.id}:${editingBib}`]=$('nameEditInput').value.trim();saveState();renderResults()});
function renderCourseMaps(){const e=selected();if(!e||!['myresult-176','myresult-177'].includes(e.id))return;const c=cache(),is10k=b=>String(c[`${e.id}:${b}`]?.course||'').trim().toUpperCase()==='10K',mixed=state.bibs.some(is10k)&&state.bibs.some(b=>!is10k(b)),prefix='GPX/';const file=course=>e.id==='myresult-176'?`2026_춘천_${course}.gpx`:`2026_JTBC_${course}.gpx`;const route=course=>e.id==='myresult-176'?(course==='10k'?'322':'321'):(course==='10k'?'759':'755');const src=course=>'gpx-viewer.html?url='+prefix+encodeURIComponent(file(course))+'&fallback='+encodeURIComponent('https://ayrrpaqvwfeacowmosgv.supabase.co/functions/v1/wari-jtbc-route?routeYearId='+route(course)+'&tolerance=0.00009');$('courseMap10k').hidden=!mixed;const mainSrc=src(mixed?'full':(state.bibs.some(is10k)?'10k':'full'));if($('courseMapFrame').getAttribute('src')!==mainSrc)$('courseMapFrame').src=mainSrc;if(mixed&&$('courseMapFrame10k').getAttribute('src')!==src('10k'))$('courseMapFrame10k').src=src('10k')}
if(new URLSearchParams(location.search).has('mock')){const mockEvent='myresult-176',mockBibs=['5050','30655'],mockSegments=course=>[{point:'출발',timeOfDay:'08:00:00',split:'-',elapsed:'00:00:00'},{point:'10K',timeOfDay:'08:55:00',split:course==='10K'?'00:55:00':'00:50:00',elapsed:course==='10K'?'00:55:00':'00:50:00'},{point:course==='10K'?'5K':'30K',timeOfDay:'10:10:00',split:course==='10K'?'00:45:00':'02:10:00',elapsed:course==='10K'?'00:45:00':'02:10:00'}],mockCache=cache();state.eventId=mockEvent;state.bibs=mockBibs;state.names={'myresult-176:5050':'김정미','myresult-176:30655':'김철수'};mockCache['myresult-176:5050']={status:'ok',name:'김정미',course:'FULL',total:'04:20:00',segments:mockSegments('FULL'),sourceUrl:'#',fetchedAt:Date.now()};mockCache['myresult-176:30655']={status:'ok',name:'김철수',course:'10K',total:'01:55:00',segments:mockSegments('10K'),sourceUrl:'#',fetchedAt:Date.now()};localStorage.setItem(CACHE_KEY,JSON.stringify(mockCache));renderResults()}

async function initialize(){
  const controls=[...document.querySelectorAll('input,button')];controls.forEach(el=>el.disabled=true);
  let imported=false,error='';
  try{imported=await importShare()}catch{error='공유 목록을 불러오지 못했습니다. 만료되었거나 네트워크 연결에 문제가 있습니다.'}
  finally{controls.forEach(el=>el.disabled=false)}
  render();watchCourseMap();
  if(error){$('saveStatus').textContent=error;return}
  if(imported)refresh();
}
if(new URLSearchParams(location.search).has('mock')){watchCourseMap()}else{initialize()}

setInterval(()=>{if(!document.hidden)syncSharedList()},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncSharedList()});
