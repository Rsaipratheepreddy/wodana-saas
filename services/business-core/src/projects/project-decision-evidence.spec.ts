import {describe,it,expect} from 'vitest';
import {emptyProject} from './execution.domain';
import {captureDecisionEvidence} from './project-decision-evidence';
describe('decision evidence ownership',()=>{
 it('snapshots exact record files and rejects cross-record, missing, duplicate and oversized selections',()=>{
  const data=emptyProject();data.files=[{id:'f',recordId:'order',name:'QC.png',mimeType:'image/png',bytes:20,sha256:'digest',by:'qc',at:'now'}];
  const result=captureDecisionEvidence(data,'order',['f']);expect(result[0]).toEqual({id:'f',name:'QC.png',mimeType:'image/png',bytes:20,sha256:'digest'});
  data.files[0].name='Changed';expect(result[0].name).toBe('QC.png');
  for(const ids of [['missing'],['f','f'],Array.from({length:21},(_,i)=>String(i)),{}])expect(()=>captureDecisionEvidence(data,'order',ids)).toThrow();
  expect(()=>captureDecisionEvidence(data,'task',['f'])).toThrow('this record');
  expect(captureDecisionEvidence(data,'order',undefined)).toEqual([]);
 });
});
