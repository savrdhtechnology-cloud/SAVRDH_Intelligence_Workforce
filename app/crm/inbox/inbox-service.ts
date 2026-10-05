import { crmFetch } from "../request";
import { crmSupabase } from "../supabase-client";
import { ConversationDetail,ConversationRecord,InboxContext } from "./inbox-types";

async function authHeaders(){
  const {data}=await crmSupabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token)throw new Error("Authentication required.");
  return {Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
}
async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const res=await crmFetch(url,{...init,headers:{...(await authHeaders()),...(init?.headers||{})}});
  const body=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(body.message||body.error||"Inbox request failed");
  return body as T;
}
export const getInboxContext=()=>api<InboxContext>("/api/inbox/conversations?context=1");
export const listConversations=(query="")=>api<{conversations:ConversationRecord[];context?:InboxContext}>(`/api/inbox/conversations${query?"?"+query:""}`);
export const getConversation=(id:string)=>api<ConversationDetail>(`/api/inbox/conversations/${id}`);
export const createConversation=(input:Record<string,unknown>)=>api<{id:string}>("/api/inbox/conversations",{method:"POST",body:JSON.stringify(input)});
export const updateConversation=(id:string,input:Record<string,unknown>)=>api<{ok:true}>(`/api/inbox/conversations/${id}`,{method:"PATCH",body:JSON.stringify(input)});
export const assignConversation=(id:string,input:Record<string,unknown>)=>api<any>(`/api/inbox/conversations/${id}/assign`,{method:"POST",body:JSON.stringify(input)});
export const closeConversation=(id:string)=>api<any>(`/api/inbox/conversations/${id}/close`,{method:"POST"});
export const reopenConversation=(id:string)=>api<any>(`/api/inbox/conversations/${id}/reopen`,{method:"POST"});
export const escalateConversation=(id:string,reason:string)=>api<any>(`/api/inbox/conversations/${id}/escalate`,{method:"POST",body:JSON.stringify({reason})});
export const sendMessage=(input:Record<string,unknown>)=>api<any>("/api/inbox/messages",{method:"POST",body:JSON.stringify(input)});
export const retryMessage=(id:string)=>api<any>(`/api/inbox/messages/${id}/retry`,{method:"POST"});
export const markMessageRead=(id:string,read=true)=>api<any>(`/api/inbox/messages/${id}/read`,{method:"POST",body:JSON.stringify({read})});
export const draftReply=(id:string,input:Record<string,unknown>)=>api<any>(`/api/inbox/messages/${id}/draft`,{method:"POST",body:JSON.stringify(input)});
export const createInboxTask=(input:Record<string,unknown>)=>api<any>("/api/inbox/tasks",{method:"POST",body:JSON.stringify(input)});
export const createInboxFollowup=(input:Record<string,unknown>)=>api<any>("/api/inbox/followups",{method:"POST",body:JSON.stringify(input)});
export const addInternalNote=(conversationId:string,body:string)=>api<any>(`/api/inbox/conversations/${conversationId}`,{method:"PATCH",body:JSON.stringify({internalNote:body})});
export const listChannelAccounts=()=>api<any>("/api/inbox/channels");
export const upsertChannelAccount=(input:Record<string,unknown>)=>api<any>("/api/inbox/channels",{method:"POST",body:JSON.stringify(input)});
