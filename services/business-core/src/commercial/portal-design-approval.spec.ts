import {describe,it,expect,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {decidePortalDesign,portalReviewDesign} from './portal-design-approval';
const id='18af9b83-ed18-42d7-9ff2-5626cf7790e9';
const grant={id:'grant',name:'Client Name',role:'approver'};
const input={versionId:id,challengeId:id,decision:'accept',note:''};
function setup(status='client_review'){
 const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT action')?{rows:[],rowCount:0}:sql.startsWith('SELECT d.id')?{rows:[{id:'design',status,number:1}],rowCount:1}:{rows:[],rowCount:1});
 return {query,client:{query} as unknown as PoolClient};
}
describe('verified client design approval',()=>{
 it('records client approval with the client identity, not an internal staff actor',async()=>{const {client,query}=setup();const verify=vi.fn(async()=>'+971555555555');await expect(decidePortalDesign(client,'w','c',grant,input,verify)).resolves.toEqual({ok:true});expect(verify).toHaveBeenCalledOnce();expect(query).toHaveBeenCalledWith(expect.stringContaining('SET status=$4'),['w','c',id,'approved']);expect(query).toHaveBeenCalledWith(expect.stringContaining("NULL,$9,'client_portal'"),[id,'w','c','design',id,'approved','','Client Name','grant']);});
 it('returns rejected files to changes requested with remarks',async()=>{const {client,query}=setup();await decidePortalDesign(client,'w','c',grant,{...input,decision:'changes',note:'Change the height'},async()=>'phone');expect(query).toHaveBeenCalledWith(expect.stringContaining('SET status=$4'),['w','c',id,'changes_requested']);});
 it('requires remarks to reject',async()=>{const {client,query}=setup();await expect(decidePortalDesign(client,'w','c',grant,{...input,decision:'changes'},async()=>'phone')).rejects.toThrow('remarks');expect(query).not.toHaveBeenCalled();});
 it('does not allow a viewer to decide',async()=>{const {client,query}=setup();await expect(decidePortalDesign(client,'w','c',{...grant,role:'viewer'},input,async()=>'phone')).rejects.toThrow('approver');expect(query).not.toHaveBeenCalled();});
 it('keeps invalid OTP attempts without changing the design',async()=>{const {client,query}=setup();await expect(decidePortalDesign(client,'w','c',grant,input,async()=>null)).resolves.toEqual({invalidCode:true});expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);});
 it.each(['draft','internal_review','internal_approved','approved','changes_requested'])('rejects a decision on status %s',async(status)=>{const {client}=setup(status);await expect(portalReviewDesign(client,'w','c',id)).rejects.toThrow('no longer awaiting');});
 it('limits the lookup to the latest revision, active case and unarchived design',async()=>{const {client,query}=setup();await portalReviewDesign(client,'w','c',id);expect(query).toHaveBeenCalledWith(expect.stringContaining("c.status='active' AND d.archived_at IS NULL AND v.number="),['w','c',id]);});
 it('safely retries the same decision without another OTP or duplicate activity',async()=>{const query=vi.fn(async()=>({rowCount:1,rows:[{action:'approved',note:'',version_id:id,client_grant_id:'grant'}]}));const verify=vi.fn();await expect(decidePortalDesign({query} as unknown as PoolClient,'w','c',grant,input,verify)).resolves.toEqual({ok:true,replayed:true});expect(query).toHaveBeenCalledOnce();expect(verify).not.toHaveBeenCalled();});
 it('rejects changed retries and another client’s decision id',async()=>{const query=vi.fn(async()=>({rowCount:1,rows:[{action:'approved',note:'',version_id:id,client_grant_id:'other'}]}));await expect(decidePortalDesign({query} as unknown as PoolClient,'w','c',grant,input,vi.fn())).rejects.toThrow('differently');});
});
