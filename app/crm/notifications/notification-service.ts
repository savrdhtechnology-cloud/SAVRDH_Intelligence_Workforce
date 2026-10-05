import { crmFetch } from "../request";
import { crmSupabase } from "../supabase-client";
import { NotificationDetail,NotificationListResponse,NotificationPreference,NotificationSchedule,NotificationTemplate } from "./notification-types";
async function headers(){const {data}=await crmSupabase.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("Authentication required.");return {Authorization:"Bearer "+token,"Content-Type":"application/json"};}
async function api<T>(url:string,init?:RequestInit):Promise<T>{const res=await crmFetch(url,{...init,headers:{...(await headers()),...(init?.headers||{})}});const b=await res.json().catch(()=>({}));if(!res.ok)throw new Error(b.message||b.error||"Notification request failed");return b as T;}
export const listNotifications=(q="")=>api<NotificationListResponse>("/api/notifications"+(q?"?"+q:""));
export const getNotification=(id:string)=>api<NotificationDetail>("/api/notifications/"+id);
export const createNotification=(input:Record<string,unknown>)=>api<any>("/api/notifications",{method:"POST",body:JSON.stringify(input)});
export const updateNotification=(id:string,input:Record<string,unknown>)=>api<any>("/api/notifications/"+id,{method:"PATCH",body:JSON.stringify(input)});
export const markNotificationRead=(id:string)=>api<any>("/api/notifications/"+id+"/read",{method:"POST"});
export const markNotificationUnread=(id:string)=>api<any>("/api/notifications/"+id+"/unread",{method:"POST"});
export const markAllNotificationsRead=()=>api<any>("/api/notifications/read-all",{method:"POST"});
export const retryNotification=(id:string)=>api<any>("/api/notifications/"+id+"/retry",{method:"POST"});
export const cancelNotification=(id:string)=>api<any>("/api/notifications/"+id+"/cancel",{method:"POST"});
export const getPreferences=()=>api<{preferences:NotificationPreference[]}>("/api/notifications/preferences");
export const savePreferences=(preferences:NotificationPreference[])=>api<any>("/api/notifications/preferences",{method:"PATCH",body:JSON.stringify({preferences})});
export const getTemplates=()=>api<{templates:NotificationTemplate[]}>("/api/notifications/templates");
export const saveTemplate=(input:Record<string,unknown>)=>api<any>("/api/notifications/templates",{method:"POST",body:JSON.stringify(input)});
export const updateTemplate=(id:string,input:Record<string,unknown>)=>api<any>("/api/notifications/templates/"+id,{method:"PATCH",body:JSON.stringify(input)});
export const getChannels=()=>api<any>("/api/notifications/channels");
export const updateChannel=(id:string,input:Record<string,unknown>)=>api<any>("/api/notifications/channels/"+id,{method:"PATCH",body:JSON.stringify(input)});
export const getSchedules=()=>api<{schedules:NotificationSchedule[]}>("/api/notifications/schedules");
export const saveSchedule=(input:Record<string,unknown>)=>api<any>("/api/notifications/schedules",{method:"POST",body:JSON.stringify(input)});
export const updateSchedule=(id:string,input:Record<string,unknown>)=>api<any>("/api/notifications/schedules/"+id,{method:"PATCH",body:JSON.stringify(input)});
export const syncTaskReminders=()=>api<any>("/api/notifications/task-reminders",{method:"POST"});
export const runDueWorker=()=>api<any>("/api/notifications/worker",{method:"POST"});
