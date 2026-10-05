"use client";
import Link from "next/link";
import { Bell,CheckCheck } from "lucide-react";
import { useEffect,useState } from "react";
import { listNotifications,markAllNotificationsRead,markNotificationRead } from "./notification-service";
import { NotificationRecord } from "./notification-types";
export default function NotificationBell(){
 const [open,setOpen]=useState(false),[items,setItems]=useState<NotificationRecord[]>([]),[count,setCount]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function refresh(){try{const r=await listNotifications("read=unread");setItems((r.notifications||[]).slice(0,6));setCount(Number(r.metrics?.unread||0));}catch{/* Keep last confirmed notification count on transient failure. */}}
 useEffect(()=>{refresh();const id=window.setInterval(refresh,60000);return()=>window.clearInterval(id);},[]);
 return <div className="notification-bell-wrap"><button className="notification-bell" onClick={()=>setOpen(v=>!v)} aria-label="Notifications"><Bell size={14}/>{count>0&&<em>{count>99?"99+":count}</em>}</button>{open&&<div className="notification-bell-menu"><div className="notification-bell-head"><b>Notifications</b><button disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await markAllNotificationsRead();await refresh();}catch(e){setError(e instanceof Error?e.message:"Could not mark notifications read.");}finally{setBusy(false);}}}><CheckCheck size={11}/>Read all</button></div>{error&&<p role="alert">{error}</p>}{items.length?items.map(n=><Link key={n.id} href={n.deep_link||("/crm/notifications/"+n.id)} onClick={async()=>{try{await markNotificationRead(n.id);setOpen(false);await refresh();}catch(e){setError(e instanceof Error?e.message:"Could not mark notification read.");}}}><span className={"dot "+n.priority}/><div><b>{n.title}</b><span>{n.body}</span><time>{new Date(n.created_at).toLocaleString("en-IN")}</time></div></Link>):<p>No unread notifications.</p>}<Link className="notification-bell-all" href="/crm/notifications" onClick={()=>setOpen(false)}>Open notification center</Link></div>}</div>;
}
