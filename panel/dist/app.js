import {renderDashboardTranscript} from '/dashboard-transcript.js';
import {createTranscriptManager} from '/transcript-rendering.js';
const transcriptManager=createTranscriptManager();
let frameCursor=0,bootstrapped=false;
function iso(t){if(typeof t==='number')return new Date(t*1000).toISOString();return t||new Date(0).toISOString();}
function normalizeSegment(s){return {...s,segment_id:s.segment_id||s.id,absolute_start_time:s.absolute_start_time||iso(s.start??s.start_time),absolute_end_time:s.absolute_end_time||iso(s.end??s.end_time),completed:s.completed??true};}
function transcriptSegments(data){
 if(!bootstrapped){transcriptManager.bootstrap((data.transcript||[]).map(normalizeSegment));bootstrapped=true;}
 const frames=data.frames||[];
 for(const frame of frames.slice(frameCursor)){
  if(frame.type==='transcript_retract'){transcriptManager.handleMessage(frame);continue;}
  let confirmed=frame.confirmed||frame.segments||(frame.type==='transcription_segment'?[frame]:[]);
  let pending=frame.pending||[];
  if(!frame.confirmed){pending=[...pending,...confirmed.filter(s=>s.completed===false)];confirmed=confirmed.filter(s=>s.completed!==false);}
  transcriptManager.handleMessage({...frame,type:'transcript',confirmed:confirmed.map(normalizeSegment),pending:pending.map(normalizeSegment)});
 }
 frameCursor=frames.length;
 return transcriptManager.getSegments();
}
const $=id=>document.getElementById(id);
const tagEmoji={prediction:'🔮',risk:'⚠️',evidence:'🔎',disagreement:'🗣️',product_idea:'💡',commitment:'🤝',objection:'🛑'};
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
function when(value){if(typeof value==='number' && value>1000000000)return new Date(value*1000).toLocaleTimeString();if(typeof value==='number')return `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;return value?String(value):'Time unavailable';}
function passage(r){return r.segments.map(s=>s.text).join(' ');}
function meta(r){const names=[...new Set(r.segments.map(s=>s.speaker))].join(', ');return `${names} · ${when(r.segments[0]?.start)} · ${r.latency_ms} ms evaluation`;}
let latestRender=null;
let lastVersion='';
async function refresh(){try{
 const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw Error('Panel cannot read results');const data=await response.json();
 $('status').textContent=data.listener_running?'Listener running':'Listener stopped';$('dot').className=data.listener_running?'live':'';
 $('freshness').textContent=data.age_seconds===null?'Waiting for first evaluation':`Results last written ${Math.round(data.age_seconds)}s ago`;
 if(!editorLoaded)loadEditor(data.config);$('active-version').textContent=`${Object.keys(data.config.questions).length} active · ${data.config_version}`;if(!dirty && data.results.at(-1)?.question_version===data.config_version)$('save-status').textContent=`Active · ${data.config_version}. Used by the latest evaluation.`;
 if(data.version+data.config_version!==lastVersion){lastVersion=data.version+data.config_version;render(data);}
}catch(e){$('status').textContent='Panel disconnected';$('dot').className='';$('freshness').textContent='Reconnecting automatically…';}finally{setTimeout(refresh,1000);}}
function highlightedTranscript(value,keywords,threshold){
 const paragraph=text('p','');const matches=[];
 for(const keyword of keywords||[]){
  if(keyword.probability<threshold||!keyword.text)continue;
  const escaped=keyword.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(escaped,'giu');
  for(const match of value.matchAll(pattern)){
   const start=match.index,end=start+match[0].length;
   // Never highlight a keyword inside a longer word.
   if((start>0&&/[\p{L}\p{N}_]/u.test(value[start-1]))||(end<value.length&&/[\p{L}\p{N}_]/u.test(value[end])))continue;
   matches.push({start,end,probability:keyword.probability});
  }
 }
 matches.sort((a,b)=>a.start-b.start||b.end-a.end);let cursor=0;
 for(const match of matches){if(match.start<cursor)continue;paragraph.append(document.createTextNode(value.slice(cursor,match.start)));const mark=text('mark',value.slice(match.start,match.end),'keyword-highlight');mark.title=`Keyword relevance ${Math.round(match.probability*100)}%`;paragraph.append(mark);cursor=match.end;}
 paragraph.append(document.createTextNode(value.slice(cursor)));return paragraph;
}
function render(data){const rows=data.results;const cards=rows.flatMap(r=>(r.signals||[]).map(kind=>({r,kind})));
 $('commitments').textContent=rows.filter(r=>r.signals?.length).length;$('objections').textContent=Object.keys(data.config.questions).length;$('evaluations').textContent=rows.length;$('latency').textContent=rows.length?`${rows.at(-1).latency_ms} ms`:'—';
 const evaluations=new Map();rows.forEach(r=>{if(r.segments.length===1)evaluations.set(r.segments[0].id,r);});
 const container=$('transcript');const scroller=$('transcript-scroll');
 const follow=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90;
 latestRender={data};
 renderDashboardTranscript(container,transcriptSegments(data),evaluations,data.config.threshold,$('transcript-search').value);
 if(follow)requestAnimationFrame(()=>requestAnimationFrame(()=>scroller.scrollTop=scroller.scrollHeight));

}

refresh();
let editorLoaded=false, dirty=false;
function addQuestion(id='',question=''){
 const row=text('div','','question-row');const idLabel=text('label','ID');const input=document.createElement('input');input.value=id;input.required=true;input.pattern='[a-z][a-z0-9_]{0,39}';input.maxLength=40;idLabel.append(input);
 const qLabel=text('label','Yes / no question');const area=document.createElement('textarea');area.value=question;area.required=true;area.minLength=5;area.maxLength=2000;qLabel.append(area);
 const remove=text('button','Remove');remove.type='button';remove.onclick=()=>{row.remove();markDirty();};row.append(idLabel,qLabel,remove);$('question-fields').append(row);
}
function loadEditor(config){$('shared-prompt').value=config.prompt||'';dirty=false;$('question-fields').replaceChildren();Object.entries(config.questions).forEach(([id,q])=>addQuestion(id,q));$('threshold').value=Math.round(config.threshold*100);editorLoaded=true;}
function markDirty(){dirty=true;$('save-status').textContent='Unsaved changes. Apply setup to use them for new speech.';}
$('questions-form').addEventListener('input',markDirty);
$('add-question').onclick=()=>{addQuestion();markDirty();};
async function applyQuestions(config){
 const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});
 if(!r.ok)throw Error('Could not apply. Use 1–12 unique IDs, valid questions and a threshold from 0–100%.');
 const saved=await r.json();loadEditor(saved.config);$('save-status').textContent=`Saved · ${saved.version}. Waiting for the next evaluation to use this setup.`;return saved;
}
$('questions-form').onsubmit=async e=>{e.preventDefault();const questions={};try{
 for(const row of document.querySelectorAll('.question-row')){const id=row.querySelector('input').value.trim();if(id in questions)throw Error('Question IDs must be unique.');questions[id]=row.querySelector('textarea').value.trim();}
 await applyQuestions({prompt:$('shared-prompt').value,questions,threshold:Number($('threshold').value)/100});
}catch(error){$('save-status').textContent=error.message;}};
if(document.modelContext?.registerTool){const life=new AbortController();Promise.resolve(document.modelContext.registerTool({name:'apply_detection_questions',description:'Replace the live detector questions and threshold; effective on its next evaluation.',inputSchema:{type:'object',properties:{prompt:{type:'string',maxLength:8000},questions:{type:'object',additionalProperties:{type:'string'}},threshold:{type:'number',minimum:0,maximum:1}},required:['questions','threshold'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>applyQuestions({...input,prompt:input.prompt??$('shared-prompt').value})},{signal:life.signal})).catch(()=>{});window.addEventListener('pagehide',()=>life.abort());}

$('transcript-search').addEventListener('input',()=>{if(latestRender)render(latestRender.data);});
$('follow-live').onclick=()=>{$('transcript-scroll').scrollTop=$('transcript-scroll').scrollHeight;};
