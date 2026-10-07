"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Shield, X } from "lucide-react";

const API_URL = "https://ldffgetuzoeupuhoaubn.supabase.co/functions/v1/savrdh-demo-access";

export function WorkforceDemoModal() {
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState<{leadRef:string}|null>(null);

  useEffect(()=>{
    const handler=()=>{ setOpen(true); setError(""); setSuccess(null); };
    window.addEventListener("savrdh:workforce-demo",handler);
    return()=>window.removeEventListener("savrdh:workforce-demo",handler);
  },[]);

  if(!open) return null;

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setLoading(true); setError("");
    const fd=new FormData(e.currentTarget);
    try{
      const res=await fetch(API_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"request_demo_booking",
          productSlug:"intelligence-workforce",
          name:String(fd.get("name")||""),
          company:String(fd.get("company")||""),
          phone:String(fd.get("phone")||""),
          email:String(fd.get("email")||""),
          teamSize:String(fd.get("teamSize")||""),
          preferredDate:String(fd.get("preferredDate")||""),
          preferredTime:String(fd.get("preferredTime")||""),
          notes:String(fd.get("notes")||""),
          emailConsent:true,
          sourcePage:window.location.href,
        })
      });
      const payload=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(payload.error||"Could not submit demo request");
      setSuccess({leadRef:payload.leadRef});
    }catch(err){ setError(err instanceof Error?err.message:"Could not submit demo request"); }
    finally{ setLoading(false); }
  }

  return <div className="wf-demo-overlay" role="dialog" aria-modal="true" aria-label="Request SAVRDH Intelligence Workforce demo">
    <button className="wf-demo-backdrop" aria-label="Close demo form" onClick={()=>setOpen(false)} />
    <section className="wf-demo-modal">
      <button className="wf-demo-close" onClick={()=>setOpen(false)} aria-label="Close"><X size={20}/></button>
      {success ? <div className="wf-demo-success">
        <div className="wf-demo-success-icon"><CheckCircle2 size={30}/></div>
        <div className="wf-demo-kicker">DEMO REQUEST RECEIVED</div>
        <h2>Thank you. Our team will follow up.</h2>
        <p>Your SAVRDH Intelligence Workforce demo request is now in Savrdh Technology CRM.</p>
        <div className="wf-demo-ref">Lead Reference: <strong>{success.leadRef}</strong></div>
        <button className="wf-demo-submit" onClick={()=>setOpen(false)}>Close</button>
      </div> :
      <>
        <div className="wf-demo-heading">
          <div className="wf-demo-icon"><Shield size={20}/></div>
          <div>
            <div className="wf-demo-kicker">SAVRDH INTELLIGENCE WORKFORCE • LIVE DEMONSTRATION</div>
            <h2>Book an Interactive AI Workspace Walkthrough</h2>
          </div>
        </div>
        <p className="wf-demo-intro">See AI agents, lead follow-ups, workflows, omnichannel communication and CRM automation in a guided product demonstration.</p>
        <form onSubmit={submit}>
          <div className="wf-demo-grid">
            <label>Full Name *<input name="name" required placeholder="e.g. Ramesh Sharma"/></label>
            <label>Company Name *<input name="company" required placeholder="e.g. Acme Pvt Ltd"/></label>
            <label>Phone Number *<input name="phone" required placeholder="e.g. 9876543210"/></label>
            <label>Work Email *<input name="email" type="email" required placeholder="e.g. ramesh@company.com"/></label>
            <label>Team / Business Size
              <select name="teamSize" defaultValue="10 - 50 Users">
                <option>1 - 10 Users</option><option>10 - 50 Users</option><option>50 - 200 Users</option><option>200+ Users</option>
              </select>
            </label>
            <label>Preferred Date<input name="preferredDate" type="date"/></label>
            <label className="wf-demo-span">Preferred Time<input name="preferredTime" type="time"/></label>
            <label className="wf-demo-span">Requirement / Notes<textarea name="notes" rows={3} placeholder="Tell us what you want to automate or see in the demo."/></label>
          </div>
          {error&&<div className="wf-demo-error">{error}</div>}
          <button className="wf-demo-submit" disabled={loading}><CalendarDays size={17}/>{loading?"Submitting...":"Confirm Live Demo Booking"}</button>
          <p className="wf-demo-consent">By submitting, you agree to receive follow-up about this requested demo from Savrdh Technology.</p>
        </form>
      </>}
    </section>
  </div>;
}

export function openWorkforceDemo(){
  if(typeof window!=="undefined") window.dispatchEvent(new Event("savrdh:workforce-demo"));
}
