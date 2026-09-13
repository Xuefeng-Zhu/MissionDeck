export const BACKEND=import.meta.env.VITE_MISSIONDECK_BACKEND || 'http://127.0.0.1:4318';
const sessionKey='mission-control.session';
export const isExtension=typeof chrome!=='undefined' && !!chrome.runtime?.id;
export async function readSession():Promise<string|null> {
  if (isExtension) {const value=(await chrome.storage.session.get(sessionKey))[sessionKey];return typeof value==='string'?value:null;}
  return sessionStorage.getItem(sessionKey);
}
export async function writeSession(token:string|null):Promise<void> {
  if (isExtension) { if (token) await chrome.storage.session.set({[sessionKey]:token}); else await chrome.storage.session.remove(sessionKey); }
  else if (token) sessionStorage.setItem(sessionKey,token); else sessionStorage.removeItem(sessionKey);
}
export class ApiError extends Error { constructor(public status:number,message:string){super(message);} }
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const token=await readSession();
  let response:Response;
  try { response=await fetch(BACKEND+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}}); }
  catch { throw new ApiError(0,'Mission Control is offline. Start the local server, then retry. Your saved missions remain on the server.'); }
  const data=await response.json().catch(()=>({error:'The server returned an unreadable response.'}));
  if (!response.ok) {
    const message=typeof data.error==='string'?data.error:data.error?.message || data.message || `Request failed (${response.status}).`;
    const details=Array.isArray(data.details)?data.details.slice(0,3).map((detail:unknown)=>typeof detail==='string'?detail:detail&&typeof detail==='object'&&'message' in detail?String(detail.message):'').filter(Boolean):[];
    throw new ApiError(response.status,[message,...details].join(' '));
  }
  return data as T;
}
export const post=<T,>(path:string,body:unknown={})=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
