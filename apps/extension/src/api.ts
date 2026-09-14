export const BACKEND=import.meta.env.VITE_MISSIONDECK_BACKEND || 'http://127.0.0.1:4318';
const sessionKey='mission-control.session';
export const SESSION_INVALID_PREFIX='mission-control.invalid-session:';
export const SESSION_STORAGE_KEYS=[sessionKey] as const;
const invalidSessionKey=(token:string)=>SESSION_INVALID_PREFIX+token;
export const SESSION_INVALID_EVENT='missiondeck:session-invalid';
export const isExtension=typeof chrome!=='undefined' && !!chrome.runtime?.id;
export async function readSession():Promise<string|null> {
  if (isExtension) {
    // Verify the token did not change while its token-specific marker was read.
    // A marker per token is monotonic across extension contexts; late writes for
    // older tokens cannot overwrite or resurrect another invalidation.
    for(let attempt=0;attempt<3;attempt++){
      const value=(await chrome.storage.session.get(sessionKey))[sessionKey];if(typeof value!=='string')return null;
      const invalid=Boolean((await chrome.storage.session.get(invalidSessionKey(value)))[invalidSessionKey(value)]);
      if((await chrome.storage.session.get(sessionKey))[sessionKey]===value)return invalid?null:value;
    }
    return null;
  }
  const value=sessionStorage.getItem(sessionKey);return value&&!sessionStorage.getItem(invalidSessionKey(value))?value:null;
}
export async function writeSession(token:string|null):Promise<void> {
  if(token){if(isExtension)await chrome.storage.session.set({[sessionKey]:token});else sessionStorage.setItem(sessionKey,token);return;}
  if(isExtension){const value=(await chrome.storage.session.get(sessionKey))[sessionKey];if(typeof value==='string')await invalidateSession(value);}
  else sessionStorage.removeItem(sessionKey);
}
export async function invalidateSession(token:string):Promise<void>{
  // Chrome storage offers no compare-and-swap. Marking one exact token invalid is
  // monotonic: a replacement token remains valid regardless of write ordering.
  if(isExtension)await chrome.storage.session.set({[invalidSessionKey(token)]:true});
  else {sessionStorage.setItem(invalidSessionKey(token),'true');if(sessionStorage.getItem(sessionKey)===token)sessionStorage.removeItem(sessionKey);}
}
export class ApiError extends Error {
  constructor(public status:number,message:string,public sessionInvalidated=false,public sessionSuperseded=false){super(message);}
}
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const token=await readSession();
  let response:Response;
  try { response=await fetch(BACKEND+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}}); }
  catch { throw new ApiError(0,'MissionDeck is offline. Start the local server, then retry. Your saved missions remain on the server.'); }
  const data=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
  if (!response.ok) {
    const message=typeof data.error==='string'?data.error:data.error?.message || data.message || `Request failed (${response.status}).`;
    const details=Array.isArray(data.details)?data.details.slice(0,3).map((detail:unknown)=>typeof detail==='string'?detail:detail&&typeof detail==='object'&&'message' in detail?String(detail.message):'').filter(Boolean):[];
    let sessionInvalidated=false;let sessionSuperseded=false;
    if(response.status===401&&token){
      // A delayed response from a revoked token must not erase a replacement
      // session created while that request was in flight.
      const current=await readSession();
      if(current===token){
        await invalidateSession(token);
        const after=await readSession();
        if(after&&after!==token)sessionSuperseded=true;
        else {sessionInvalidated=true;if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(SESSION_INVALID_EVENT,{detail:{message}}));}
      }else if(current===null){
        // Another extension view already revoked or invalidated this token.
        sessionInvalidated=true;
        if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(SESSION_INVALID_EVENT,{detail:{message}}));
      }else sessionSuperseded=true;
    }
    throw new ApiError(response.status,[message,...details].join(' '),sessionInvalidated,sessionSuperseded);
  }
  return data as T;
}
export const post=<T,>(path:string,body:unknown={})=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
