// Share simultaneous identical mutations so double clicks cannot create two requests.
const pending=new Map<string,Promise<Response>>();
export async function crmFetch(url:string,init:RequestInit={}):Promise<Response>{
 const mutating=Boolean(init.method&&init.method!=='GET');
 const key=JSON.stringify([url,init.method,init.body,init.headers]);
 let request=mutating?pending.get(key):undefined;
 if(!request){
  request=fetch(url,{...init,signal:init.signal||AbortSignal.timeout(30000)}).catch(()=>{throw new Error('Network request could not be confirmed. Refresh the record before retrying.');});
  if(mutating){pending.set(key,request);void request.finally(()=>pending.delete(key)).catch(()=>undefined);}
 }
 return (await request).clone();
}
