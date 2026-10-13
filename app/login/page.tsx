"use client";
import {useEffect,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {crmSupabase,crmSupabaseConfigured} from "../crm/supabase-client";
export default function AIOSLogin(){
 const router=useRouter();const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{if(!crmSupabaseConfigured){setReady(true);return;}crmSupabase.auth.getSession().then(({data})=>{if(data.session)router.replace("/admin");setReady(true)}).catch(()=>setReady(true))},[router]);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError("");const form=new FormData(event.currentTarget);
 const email=String(form.get("email")||"").trim(),password=String(form.get("password")||"");
 try{const {error}=await crmSupabase.auth.signInWithPassword({email,password});if(error)throw error;router.replace("/admin");router.refresh()}catch(e){setError(e instanceof Error?e.message:"Sign in failed")}finally{setBusy(false)}}
 return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#07121d",color:"#e8f2f8",padding:20}}>
 <section style={{width:"100%",maxWidth:410,padding:30,background:"#102333",border:"1px solid #32556a",borderRadius:17}}>
 <small style={{letterSpacing:2,color:"#60dfcf"}}>SAVRDH AI OS</small><h1>Workforce Admin Login</h1><p style={{color:"#a3c0ce"}}>Sign in using your authorized Savrdh AI OS credentials.</p>
 {!crmSupabaseConfigured?<p role="alert">Supabase configuration required.</p>:<form onSubmit={submit} style={{display:"grid",gap:13}}>
 <label>Email<input name="email" type="email" required autoComplete="username" style={{display:"block",width:"100%",marginTop:7,padding:12,borderRadius:8}}/></label>
 <label>Password<input name="password" type="password" required autoComplete="current-password" style={{display:"block",width:"100%",marginTop:7,padding:12,borderRadius:8}}/></label>
 <button type="submit" disabled={!ready||busy} style={{background:"#49d6c4",color:"#08252a",border:0,borderRadius:8,padding:13,fontWeight:700,cursor:"pointer"}}>{busy?"Signing in…":"Sign in to AI Workforce"}</button>
 {error&&<p role="alert" style={{color:"#ffaaa7"}}>{error}</p>}</form>}
 </section></main>
}
