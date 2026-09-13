import assert from 'node:assert/strict';
import test from 'node:test';
import { syncCapture, type PendingCapture } from '../src/hrms/capture-queue';
const capture:PendingCapture={key:'workspace:member',photoUri:'file:///saved-camera.jpg',createdAt:1,input:{actionId:'same-action',captureId:'same-capture',kind:'check_out',expectedSessionId:'session',expectedVersion:2,mode:'site',deviceAt:'2026-09-07T09:00:00Z',position:null,note:'',exceptionReason:'GPS unavailable'}};
test('network loss stops a capture and retry reuses the original photo and action IDs',async()=>{
 const calls:unknown[]=[];let failed=true;
 const transport={request:async(path:string,method:string,body:unknown)=>{calls.push({path,method,body});if(path==='attendance/actions'&&failed){failed=false;throw new Error('network');}return {id:'receipt'};},photo:async(row:PendingCapture)=>{calls.push({photo:row.photoUri,captureId:row.input.captureId});}};
 await assert.rejects(syncCapture(capture,transport),/network/);await syncCapture(capture,transport);
 assert.deepEqual(calls.slice(0,3),calls.slice(3));assert.equal(capture.input.expectedVersion,2);
});
test('a failed photo upload cannot advance the attendance session',async()=>{
 const calls:string[]=[];await assert.rejects(syncCapture(capture,{request:async(path)=>{calls.push(path);},photo:async()=>{throw new Error('upload failed');}}),/upload failed/);assert.deepEqual(calls,['captures']);
});
