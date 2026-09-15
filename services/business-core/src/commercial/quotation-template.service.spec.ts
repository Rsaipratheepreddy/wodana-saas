import { describe, expect, it, vi } from "vitest";
import { CommercialService } from "./commercial.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { ConfigService } from "@nestjs/config";
import type { CatalogSellingPriceService } from "./catalog-selling-price.service";
import type { PreProjectReadinessService } from "../pre-projects/pre-project-readiness.service";
import type { RequestActor } from "../auth/actor";

it("checks template catalog versions without changing rates, retaining written scope for unavailable products", async () => {
 const ref=(id:string,version:number,name:string)=>({role:"material",recordId:id,version,snapshot:{id,name,code:id,kind:"material",version,catalogId:"catalog"}});
 const content={currency:"AED",rooms:[],lines:[{id:"line",title:"Cabinet",quantity:16,rate:1450,unit:"m²",material:"Oak · oak\n\n18 mm",finish:"",catalogLinks:[ref("oak",1,"Oak")]},{id:"other",title:"Panel",quantity:1,rate:900,unit:"nos",material:"Archived veneer · archive",finish:"",catalogLinks:[ref("archive",1,"Archived veneer")]}]};
 const query=vi.fn().mockResolvedValueOnce({rows:[{id:"template",name:"Joinery",version:1,content}]}).mockResolvedValueOnce({rows:[{id:"oak",name:"Oak updated",code:"oak",kind:"material",version:2,catalogId:"catalog"}]});
 const access={withPermission:vi.fn(async (_a,_w,_p,fn)=>fn({query}))};
 const service=new CommercialService(access as unknown as WorkspaceAccessService,{} as ConfigService,{} as CatalogSellingPriceService,{} as PreProjectReadinessService);
 const result=await service.prepareQuotationTemplate({} as RequestActor,"workspace-A","template");
 expect(result.template.content.lines[0].rate).toBe(1450);expect(result.template.content.lines[0].quantity).toBe(16);
 expect(result.template.content.lines[0].catalogLinks![0].version).toBe(2);expect(result.template.content.lines[0].material).toBe("Oak updated · oak\n\n18 mm");
 expect(result.template.content.lines[1].catalogLinks).toEqual([]);expect(result.template.content.lines[1].material).toBe("Archived veneer · archive");
 expect(result.warnings).toHaveLength(2);expect(query.mock.calls.every(call=>call[1][0]==="workspace-A")).toBe(true);
});
