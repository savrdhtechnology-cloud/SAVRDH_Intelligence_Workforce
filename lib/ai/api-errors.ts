import type { NextRequest } from 'next/server';

/** Last-resort safe error boundary for configuration, transport and malformed input failures. */
export function withApiErrors<A extends unknown[]>(handler:(req:NextRequest,...args:A)=>Promise<Response>){
 return async(req:NextRequest,...args:A):Promise<Response>=>{
  try{return await handler(req,...args);}
  catch(error){
   const message=error instanceof Error?error.message:'';
   if(message==='Supabase environment is not configured')return Response.json({error:'DATABASE_NOT_READY',message:'CRM database connection is not configured for this deployment.'},{status:503});
   if(error instanceof SyntaxError||error instanceof TypeError&&/trim|Cannot read|is not a function/.test(message))return Response.json({error:'VALIDATION_ERROR',message:'Invalid request fields. Check the values and try again.'},{status:422});
   return Response.json({error:'OPERATION_UNCONFIRMED',message:'The CRM operation could not be confirmed. Refresh its record before retrying; an external request may already have been accepted.'},{status:503});
  }
 };
}
