import React,{useState,useRef,useId,useEffect} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {TranscriptSegment} from './transcript-segment';
const roots=new WeakMap();
const emojis={prediction:'🔮',risk:'⚠️',evidence:'🔎',disagreement:'🗣️',product_idea:'💡',commitment:'🤝',objection:'🛑'};
function SignalEvidence({kind,probability,result,segment,threshold}){
 const [position,setPosition]=useState(null);const button=useRef(null);const hideTimer=useRef(null);const id=useId();
 useEffect(()=>()=>clearTimeout(hideTimer.current),[]);
 function keep(){clearTimeout(hideTimer.current);}
 function hide(){keep();hideTimer.current=setTimeout(()=>setPosition(null),180);}
 const label=kind.replaceAll('_',' ');const percent=Math.round(Number(probability)*100);
 function show(){keep();const rect=button.current.getBoundingClientRect();const width=Math.min(380,window.innerWidth-24);setPosition({left:Math.max(12,Math.min(rect.right+12,window.innerWidth-width-12)),top:Math.max(12,Math.min(rect.top,window.innerHeight-350)),width});}
 return <>
  <button ref={button} type="button" className="side-emoji evidence-trigger" aria-label={`${label}, ${percent}%. Show evidence`} aria-describedby={position?id:undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={()=>setPosition(null)} onClick={()=>position?setPosition(null):show()} onKeyDown={e=>{if(e.key==='Escape')setPosition(null);}}>{emojis[kind]||'🏷️'}</button>
  {position&&createPortal(<div id={id} role="tooltip" className="signal-evidence" style={position} onMouseEnter={keep} onMouseLeave={hide}>
   <div className="evidence-heading">{emojis[kind]||'🏷️'} {label} <strong>{percent}%</strong></div>
   <div className="evidence-label">Transcript evidence evaluated</div><blockquote>“{segment.text}”</blockquote>
   {result.prompt&&<><div className="evidence-label">Shared guidance</div><p>{result.prompt}</p></>}
   <p className="evidence-note">This is the evaluated passage, not a model-selected proof span. Jev returns a probability, not a written rationale.</p>
  </div>,document.body)}
 </>;
}
function TextHover({children,className,label,details,passage}){
 const ref=useRef(null), timer=useRef(null), id=useId();const [position,setPosition]=useState(null);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 function keep(){clearTimeout(timer.current);}
 function hide(){keep();timer.current=setTimeout(()=>setPosition(null),160);}
 function show(){keep();const r=ref.current.getBoundingClientRect(),width=Math.min(320,innerWidth-24);setPosition({left:Math.max(12,Math.min(r.left,innerWidth-width-12)),top:Math.max(12,Math.min(r.bottom+8,innerHeight-150)),width});}
 return <><span ref={ref} className={className} tabIndex={0} aria-describedby={position?id:undefined} onMouseEnter={e=>{e.stopPropagation();show();}} onMouseLeave={hide} onFocus={show} onBlur={()=>setPosition(null)} onKeyDown={e=>{if(e.key==='Escape')setPosition(null);}} onClick={show}>{children}</span>{position&&createPortal(<div role="tooltip" id={id} className="signal-evidence" style={position} onMouseEnter={keep} onMouseLeave={hide}><div className="evidence-heading">{label}</div><p>{details}</p>{passage&&<blockquote>“{passage}”</blockquote>}</div>,document.body)}</>;
}
const categoryLabels={person:'Person',company:'Company',data:'Data / number',product:'Product',other:'Keyword'};
// Scores are saved with the evaluation; unscored older text stays readable.
function downlight(value,scores){
 const byWord=new Map((scores||[]).map(w=>[w.text.toLowerCase(),w.score]));
 return value.split(/(\b[\w’'-]+\b)/gu).map((word,i)=>{
  const score=byWord.get(word.toLowerCase());
  return <span key={i} style={{opacity:score==null?1:Math.max(.05,Math.min(1,score))}}>{word}</span>;
 });
}
function highlights(value,keywords,threshold,query,scores){
 const spans=[];
 for(const k of [...(keywords||[]).filter(k=>k.probability>=threshold),...(query?[{text:query,search:true}]:[])]){
  if(!k.text)continue;
  const regex=new RegExp(k.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
  for(const match of value.matchAll(regex))spans.push({start:match.index,end:match.index+match[0].length,search:k.search,probability:k.probability,category:k.category_probability>=threshold&&categoryLabels[k.category]?k.category:"other",category_probability:k.category_probability});
 }
 spans.sort((a,b)=>a.start-b.start||b.end-a.end);let cursor=0;const nodes=[];
 for(const span of spans){if(span.start<cursor)continue;nodes.push(...downlight(value.slice(cursor,span.start),scores));nodes.push(span.search?<mark key={span.start} className="search-highlight">{value.slice(span.start,span.end)}</mark>:<TextHover key={span.start} className={`keyword-highlight keyword-${span.category}`} label={value.slice(span.start,span.end)} passage={value} details={`${categoryLabels[span.category]} · ${Math.round((span.category==="other"?span.probability:span.category_probability)*100)}%`}>{downlight(value.slice(span.start,span.end),scores)}</TextHover>);cursor=span.end;}
 nodes.push(...downlight(value.slice(cursor),scores));return nodes;
}
export function renderDashboardTranscript(container,segments,evaluations,threshold,query=''){
 let root=roots.get(container);if(!root){root=createRoot(container);roots.set(container,root);}
 const visible=segments.filter(s=>!query||(s.text+' '+(s.speaker||'')).toLowerCase().includes(query.toLowerCase()));
 const names=[...new Set(segments.map(s=>s.speaker||'Unknown speaker'))];
 root.render(<div className="dashboard-transcript">{!visible.length?<p className="empty">{query?'No matching transcript passages.':'Waiting for speech…'}</p>:visible.map((s,i)=>{
  const result=evaluations.get(s.segment_id);const match=result?.segments[0].text===s.text?result:null;
  const tags=s.completed===false?[]:Object.entries(match?.probabilities||{}).filter(([k,v])=>Number(v)>=threshold);
  const speaker=s.speaker||'Unknown speaker';
  return <TranscriptSegment key={s.segment_id||s.absolute_start_time} segment={{...s,speaker,start_time:s.start_time||0}} speakerColor={{text:`speaker-${names.indexOf(speaker)%6}`}} showSpeakerHeader={i===0||(visible[i-1].speaker||'Unknown speaker')!==speaker}
   annotatedText={<span className={tags.length?'tagged-passage':''} data-tag={tags[0]?.[0]} title={tags.length?tags.map(([k,v])=>`${k.replaceAll('_',' ')} · ${Math.round(Number(v)*100)}%`).join(' / '):undefined}>{highlights(s.text,s.completed===false?[]:match?.keywords,threshold,query,match?.word_significance)}</span>}
   annotations={<span className="side-tags">{tags.map(([k,v])=><SignalEvidence key={k} kind={k} probability={v} result={match} segment={s} threshold={threshold}/>)}</span>}/>;
 })}</div>);
}
