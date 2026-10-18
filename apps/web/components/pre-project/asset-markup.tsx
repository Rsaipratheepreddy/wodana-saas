'use client';
import {useEffect,useRef,useState} from 'react';
import { Button, InlineNotice } from '@/design-system';
import {caseApi,caseRequest,type CaseAsset} from '@/lib/pre-project/content';
import {CaseModal} from './case-controls';
import styles from './case-content.module.css';
import view from './asset-markup.module.css';
import {useT} from '@/lib/i18n/i18n-provider';
import {tKey,type MessageKey} from '@/lib/i18n/keys';
type Stroke={color:string;width:number;points:{x:number;y:number}[]};
const pens:Array<[string,MessageKey]>=[['#46705a',tKey('Sage pen')],['#c83737',tKey('Red pen')],['#2063b6',tKey('Blue pen')],['#1b1b1b',tKey('Black pen')],['#ffffff',tKey('White pen')]];
export function AssetMarkup({workspaceId,caseId,asset,onClose,onSaved,assetUrl,uploadFile}:{workspaceId:string;caseId:string;asset:CaseAsset;onClose:()=>void;onSaved:(asset:CaseAsset)=>void;assetUrl?:(asset:CaseAsset,preview?:boolean)=>string;uploadFile?:(file:File,id:string)=>Promise<CaseAsset>}){
 const t=useT();
 const [strokes,setStrokes]=useState<Stroke[]>([]),[original,setOriginal]=useState(asset.id),[ready,setReady]=useState(false),[imageReady,setImageReady]=useState(false),[size,setSize]=useState({width:1000,height:750}),[color,setColor]=useState(pens[0][0]),[width,setWidth]=useState(.004),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [saveId]=useState(()=>crypto.randomUUID());const active=useRef(false);const imageRef=useRef<HTMLImageElement>(null);const [initial,setInitial]=useState('[]');
 useEffect(()=>{if(uploadFile){setReady(true);return;}let alive=true;caseRequest<{sourceAssetId:string;strokes:Stroke[]}>(workspaceId,caseId,`assets/${asset.id}/markup`).then(meta=>{if(alive){setOriginal(meta.sourceAssetId);setStrokes(meta.strokes);setInitial(JSON.stringify(meta.strokes));setReady(true);}}).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[workspaceId,caseId,asset.id,uploadFile]);
 const point=(e:React.PointerEvent<SVGSVGElement>)=>{const r=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
 return <CaseModal title={t('Mark photo')} size="lg" dirty={initial!==JSON.stringify(strokes)} busy={busy} onClose={onClose} footer={<Button variant="primary" isDisabled={!ready||!imageReady||!strokes.length} isLoading={busy} onPress={async()=>{setBusy(true);setError('');try{if(uploadFile){
 const photo=imageRef.current;if(!photo)throw new Error(t('Photo is not ready.'));
 const canvas=document.createElement('canvas');canvas.width=photo.naturalWidth;canvas.height=photo.naturalHeight;
 const context=canvas.getContext('2d');if(!context)throw new Error(t('Drawing is unavailable in this browser.'));context.drawImage(photo,0,0);
 for(const stroke of strokes){context.strokeStyle=stroke.color;context.fillStyle=stroke.color;context.lineWidth=stroke.width*canvas.width;context.lineCap='round';context.lineJoin='round';context.beginPath();if(stroke.points.length===1){context.arc(stroke.points[0].x*canvas.width,stroke.points[0].y*canvas.height,context.lineWidth/2,0,Math.PI*2);context.fill();}else{stroke.points.forEach((p,index)=>index?context.lineTo(p.x*canvas.width,p.y*canvas.height):context.moveTo(p.x*canvas.width,p.y*canvas.height));context.stroke();}}
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error(t('Could not create the marked copy.'))),'image/png'));
 onSaved(await uploadFile(new File([blob],`${asset.name.replace(/\.[^.]+$/,'')} marked.png`,{type:'image/png'}),saveId));
 }else onSaved(await caseRequest<CaseAsset>(workspaceId,caseId,`assets/${original}/markup`,'POST',{id:saveId,strokes}));}catch(e){setError(e instanceof Error?e.message:t('Could not save. Your drawing is still here.'));}finally{setBusy(false);}}}>{t('Save marked copy')}</Button>}>
 {error&&<InlineNotice tone="error" message={error}/>}
 <div className={view.tools}><div aria-label={t('Pen colour')} className={view.pens}>{pens.map(([hex,label])=><Button key={hex} className={view.penButton} size="compact" variant="quiet" aria-label={t(label)} aria-pressed={color===hex} isDisabled={busy} onPress={()=>setColor(hex)}><span className={view.pen} style={{backgroundColor:hex}}/></Button>)}</div><Button size="compact" isDisabled={busy} onPress={()=>setWidth(w=>w===.004?.009:.004)}>{t(width===.004?'Thin pen':'Thick pen')}</Button><Button size="compact" isDisabled={busy||!strokes.length} onPress={()=>setStrokes(s=>s.slice(0,-1))}>{t('Undo')}</Button><Button size="compact" isDisabled={busy||!strokes.length} onPress={()=>setStrokes([])}>{t('Clear')}</Button></div>
 {!ready?<p>{t('Opening photo…')}</p>:<div className={view.canvas} style={{maxWidth:`min(100%, ${58*size.width/size.height}vh)`}}>
 {/* Authenticated project preview, shared by both capture clients. */}
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img ref={imageRef} src={assetUrl ? assetUrl(asset) : caseApi(workspaceId,caseId,`assets/${original}?preview=1`)} alt={asset.name} onLoad={e=>{setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight});setImageReady(true);}} onError={()=>{setImageReady(false);setError(t('Could not open the photo. Close and try again.'));}}/>
 <svg aria-label={t('Drawing canvas')} role="img" viewBox={`0 0 ${size.width} ${size.height}`} onPointerDown={e=>{if(busy||!imageReady||strokes.length>=100)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);active.current=true;const p=point(e);setStrokes(s=>[...s,{color,width,points:[p]}]);}} onPointerMove={e=>{if(!active.current)return;const p=point(e);setStrokes(s=>{if(s.reduce((n,l)=>n+l.points.length,0)>=3900)return s;const last=s.at(-1);if(!last||last.points.length>=1499)return s;const previous=last.points.at(-1)!;if(Math.hypot(p.x-previous.x,p.y-previous.y)<.002)return s;return [...s.slice(0,-1),{...last,points:[...last.points,p]}];});}} onPointerUp={()=>{active.current=false;}} onPointerCancel={()=>{active.current=false;}}>
 {strokes.map((s,i)=>s.points.length===1?<circle key={i} cx={s.points[0].x*size.width} cy={s.points[0].y*size.height} r={s.width*size.width/2} fill={s.color}/>:<polyline key={i} points={s.points.map(p=>`${p.x*size.width},${p.y*size.height}`).join(' ')} stroke={s.color} strokeWidth={s.width*size.width} fill="none" strokeLinecap="round" strokeLinejoin="round"/>)}
 </svg></div>}
 <small className={styles.muted}>{t('Photo marks are reference notes. Enter measured values in the Measurements fields.')}</small>
 </CaseModal>;
}
