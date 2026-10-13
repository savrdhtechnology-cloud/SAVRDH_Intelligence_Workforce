import {crmSupabase} from "../crm/supabase-client";
export async function adminApi<T>(path:string,body?:object):Promise<T>{
 const {data}=await crmSupabase.auth.getSession();
 if(!data.session)throw new Error("Sign in required");
 const response=await fetch(path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+data.session.access_token,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(!response.ok)throw new Error(result.message||"Request failed");
 return result as T;
}
