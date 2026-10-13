import { redirect } from "next/navigation";
/** Compatibility: retire the legacy CRM dashboard without deleting its underlying routes or APIs. */
export default function RetiredCRMEntry(){redirect("/admin");}
