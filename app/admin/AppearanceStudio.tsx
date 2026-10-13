"use client";
import {useEffect,useState} from "react";
import "./appearance.css";
const themes=[
{id:"devstudio",name:"DevStudio Motion",bg:"#061321",panel:"#10283c",accent:"#59e1dd",text:"#ebfaff"},
{id:"original",name:"Midnight Cyan",bg:"#07121d",panel:"#102333",accent:"#49d6c4",text:"#e8f2f8"},
{id:"ivory",name:"Ivory Platinum",bg:"#f7f5f0",panel:"#ffffff",accent:"#ad7b29",text:"#1c2938"},
{id:"electric",name:"Electric Blue",bg:"#090f29",panel:"#172345",accent:"#6689ff",text:"#f0f4ff"},
{id:"graphite",name:"Graphite Gold",bg:"#101113",panel:"#27282c",accent:"#d9ab62",text:"#f8f3e9"},
{id:"crimson",name:"Crimson Ivory",bg:"#fff8f4",panel:"#ffffff",accent:"#b42b46",text:"#30252b"},
{id:"emerald",name:"Emerald Glass",bg:"#071d1b",panel:"#153933",accent:"#65d5a5",text:"#eafff4"}
] as const;
type Settings={id:string;font:string;size:number;heading:number;motion:boolean;speed:number};
const defaults:Settings={id:"original",font:"system",size:100,heading:100,motion:true,speed:1};
const storage="savrdh-ai-os-admin-appearance-v1";
const fonts:Record<string,string>={system:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",editorial:"Georgia,serif",modern:"'Trebuchet MS',sans-serif"};
function themeFor(id:string){return themes.find(t=>t.id===id)||themes[0]}
function apply(s:Settings){const root=document.querySelector<HTMLElement>(".savos-root");if(!root)return;const t=themeFor(s.id);root.style.setProperty("--savos-bg",t.bg);root.style.setProperty("--savos-panel",t.panel);root.style.setProperty("--savos-accent",t.accent);root.style.setProperty("--savos-text",t.text);root.style.setProperty("--savos-font",fonts[s.font]||fonts.system);root.style.setProperty("--savos-size",String(s.size/100));root.style.setProperty("--savos-heading-size",String(s.heading/100));root.style.setProperty("--savos-speed",String(s.speed));root.dataset.motion=s.motion?"on":"off";root.dataset.theme=s.id;}
export function useSavedAdminAppearance(){useEffect(()=>{try{const saved=localStorage.getItem(storage);if(saved)apply({...defaults,...JSON.parse(saved)})}catch{}},[])}
export default function AppearanceStudio(){
const [settings,setSettings]=useState<Settings>(defaults),[saved,setSaved]=useState<Settings>(defaults),[notice,setNotice]=useState("");
useEffect(()=>{try{const raw=localStorage.getItem(storage);if(raw){const s={...defaults,...JSON.parse(raw)};setSettings(s);setSaved(s)}}catch{}},[]);
const selected=themeFor(settings.id);
function change(patch:Partial<Settings>){setSettings(s=>{const next={...s,...patch};apply(next);return next});setNotice("Live preview active — click Apply to save.");}
function save(){try{localStorage.setItem(storage,JSON.stringify(settings));apply(settings);setSaved(settings);setNotice("Applied and saved in this browser.")}catch{setNotice("Preview applied, but browser storage is unavailable.")}}
return <div className="appearance-studio">
<div className="appearance-toolbar"><span>{notice||"Select a template and preview changes before applying"}</span><div><button onClick={()=>{setSettings(saved);apply(saved);setNotice("Restored saved appearance.")}}>Undo</button><button onClick={()=>change(defaults)}>Reset</button><button className="appearance-primary" onClick={save}>Apply in Browser</button></div></div>
<div className="appearance-columns">
<div className="appearance-left">
<section className="appearance-section"><h2>Theme templates</h2><p>Complete looks with coordinated backgrounds and accents.</p><div className="appearance-grid">{themes.map(t=><button key={t.id} className={settings.id===t.id?"appearance-theme active":"appearance-theme"} onClick={()=>change({id:t.id})}><div className="appearance-swatches">{[t.bg,t.panel,t.accent,t.text].map((v,i)=><span key={i} style={{background:v}}/>)}</div><strong>{t.name}</strong><small>{settings.id===t.id?"Selected":"Preview template"}</small></button>)}</div></section>
<section className="appearance-section"><h2>Typography</h2><label>Interface font<select value={settings.font} onChange={e=>change({font:e.target.value})}><option value="system">Apple System (SF Pro)</option><option value="modern">Modern Rounded</option><option value="editorial">Editorial Serif</option></select></label><label>Interface size {settings.size}%<input type="range" min="85" max="125" value={settings.size} onChange={e=>change({size:Number(e.target.value)})}/></label><label>Heading size {settings.heading}%<input type="range" min="85" max="125" value={settings.heading} onChange={e=>change({heading:Number(e.target.value)})}/></label></section>
<section className="appearance-section"><h2>Animation controls</h2><label className="appearance-checkbox"><input type="checkbox" checked={settings.motion} onChange={e=>change({motion:e.target.checked})}/> Enable animations</label><label>Animation speed {settings.speed.toFixed(1)}×<input type="range" min=".5" max="2" step=".1" value={settings.speed} onChange={e=>change({speed:Number(e.target.value)})}/></label></section>
</div>
<section className="appearance-section appearance-preview"><h2>Live theme preview</h2><p>Changes appear immediately; Apply saves them for the next visit.</p><div className={"appearance-demo "+(settings.id==="devstudio"?"appearance-demo-devstudio":"")} data-motion={settings.motion?"on":"off"} style={{background:selected.bg,color:selected.text,fontFamily:fonts[settings.font]}}><header style={{borderColor:selected.accent}}>◈ SAVRDH AI OS <span>Admin Workspace</span></header><h3 style={{fontSize:25*settings.heading/100}}>AI Workforce Command Center</h3><p style={{fontSize:13*settings.size/100}}>Develop, assign and monitor AI employees.</p><div className="appearance-demo-cards">{["AI Agent Factory","Product Assignments","Workflow Studio","Execution Monitor"].map(x=><div key={x} style={{background:selected.panel,borderColor:selected.accent+"55"}}><b style={{color:selected.accent}}>✦</b><strong>{x}</strong><small>Module preview</small></div>)}</div><button style={{background:selected.accent,color:selected.bg}}>Develop AI Agent →</button></div><p>Browser-local preview only; secure global theme synchronization is a separate backend feature.</p></section>
</div></div>;
}
