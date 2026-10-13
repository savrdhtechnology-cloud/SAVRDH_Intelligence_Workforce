"use client";
import {useEffect,useState} from "react";
import {adminApi} from "./admin-api-client";
type Product={id:string;workspace_id:string;name:string;connection_status:string};
export default function AdminProductRegistry(){
 const [items,setItems]=useState<Product[]>([]),[spaces,setSpaces]=useState<string[]>([]),[ws,setWs]=useState(""),[name,setName]=useState(""),[key,setKey]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function load(){setBusy(true);try{const result=await adminApi<{products:Product[];workspaceIds:string[]}>("/api/admin/products");setItems(result.products);setSpaces(result.workspaceIds);setWs(w=>w||result.workspaceIds[0]||"");}catch(e){setError(String(e))}finally{setBusy(false)}}
 useEffect(()=>{void load()},[]);
 async function save(){setBusy(true);try{await adminApi("/api/admin/products",{workspace_id:ws,name,product_key:key});setName("");setKey("");await load()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section className="savos-panel"><h2>Product Registry</h2><p>New products are initially disconnected. No automatic external actions.</p>{error&&<p role="alert">{error}</p>}
 <label>Workspace<select value={ws} onChange={e=>setWs(e.target.value)}>{spaces.map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Product Name<input value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>Product Key<input value={key} onChange={e=>setKey(e.target.value.toLowerCase())}/></label>
 <button onClick={save} disabled={busy||!ws||!name||!key}>Save Product</button>
 <div className="savos-item-list">{items.filter(x=>x.workspace_id===ws).map(x=><div key={x.id}>{x.name}<em>{x.connection_status}</em></div>)}</div></section>
}
