import type {Health,Task} from '@mission/domain';
export const readable=(text:string)=>text.replaceAll('_',' ');
export function dateTime(date:string,timezone?:string) {try {return new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:timezone}).format(new Date(date));}catch{return date;}}
export function formatTimestampsInText(text:string,timezone:string) {return text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,value=>dateTime(value,timezone));}
export function localInput(date:string,timezone=Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(date)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
/** Resolve a wall-clock input in the displayed IANA zone, independently of the browser zone. */
export function zonedInputToIso(value:string,timezone:string):string {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Choose a valid exact deadline.');
  const naive=(input:string)=>{const [date,time]=input.split('T');const [year,month,day]=date!.split('-').map(Number);const [hour,minute]=time!.split(':').map(Number);return Date.UTC(year!,month!-1,day!,hour!,minute!);};
  const target=naive(value);let guess=target;
  for(let i=0;i<5;i++){const represented=naive(localInput(new Date(guess).toISOString(),timezone));const difference=target-represented;if(!difference)break;guess+=difference;}
  const result=new Date(guess).toISOString();
  if(localInput(result,timezone)!==value)throw new Error('That local time does not exist in the displayed timezone, usually because clocks move forward. Choose another time.');
  return result;
}
export const healthLabels:Record<Health,string>={on_track:'On track',at_risk:'At risk',blocked:'Blocked',unknown:'ETA unknown'};
export const taskLabels:Record<Task['status'],string>={todo:'Not started',in_progress:'In progress',blocked:'Blocked',reported_complete:'Reported complete'};
export function tone(value:string):'neutral'|'blue'|'green'|'amber'|'red' {return ['verified','on_track','synced','completed'].includes(value)?'green':['blocked','failed','conflict'].includes(value)?'red':['at_risk','pending','outcome_unknown','stale'].includes(value)?'amber':value==='in_progress'?'blue':'neutral';}
