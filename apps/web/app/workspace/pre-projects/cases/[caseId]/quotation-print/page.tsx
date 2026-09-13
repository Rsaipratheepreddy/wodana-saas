import { redirect } from "next/navigation";
export default async function Page({params,searchParams}:{params:Promise<{caseId:string}>;searchParams:Promise<{quote?:string}>}){const {caseId}=await params,{quote}=await searchParams;redirect(`/quotation/${encodeURIComponent(caseId)}?quote=${encodeURIComponent(quote??'')}`);}
