import {useEffect,useRef,useState} from 'react';
import {Image,Modal,Pressable,View,useWindowDimensions} from 'react-native';
import Svg,{Circle,Polyline} from 'react-native-svg';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {useAuth} from '../auth/provider';
import {Text,useTheme} from '../design-system';
import {Button,Notice} from './ui';
import {usePhoto} from './asset-preview';
import {errorText,uuid,usePreProjectApi,type CaseAsset} from './api';
export type Stroke={color:string;width:number;points:{x:number;y:number}[]};
const pens=[['#694f7a','Plum'],['#c83737','Red'],['#2063b6','Blue'],['#1b1b1b','Black'],['#ffffff','White']];
export function PhotoMarkup({workspaceId,caseId,asset,onClose,onSaved}:{workspaceId:string;caseId:string;asset:CaseAsset;onClose:()=>void;onSaved:(asset:CaseAsset)=>void}){
 const {client}=useAuth(),api=usePreProjectApi(workspaceId,caseId),{colors,reducedMotion}=useTheme(),window=useWindowDimensions();
 const [original,setOriginal]=useState<string>(),[strokes,setStrokes]=useState<Stroke[]>([]),[color,setColor]=useState(pens[0][0]),[width,setWidth]=useState(.004),[busy,setBusy]=useState(false),[error,setError]=useState(''),[discard,setDiscard]=useState(false),[ratio,setRatio]=useState(4/3),[imageReady,setImageReady]=useState(false);
 const [id]=useState(uuid),initial=useRef('[]');const photo=usePhoto(workspaceId,caseId,original);const size=useRef({width:1,height:1});
 useEffect(()=>{let live=true;client.api<{sourceAssetId:string;strokes:Stroke[]}>(`/workspaces/${workspaceId}/pre-projects/${caseId}/assets/${asset.id}/markup`).then(meta=>{if(live){setOriginal(meta.sourceAssetId);setStrokes(meta.strokes);initial.current=JSON.stringify(meta.strokes);}}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[client,workspaceId,caseId,asset.id]);
 const close=()=>{if(busy)return;if(initial.current!==JSON.stringify(strokes))setDiscard(true);else onClose();};
 const canvasWidth=Math.min(window.width-32,Math.max(120,window.height-300)*ratio,800);
 const point=(x:number,y:number)=>({x:Math.max(0,Math.min(1,x/size.current.width)),y:Math.max(0,Math.min(1,y/size.current.height))});
 async function save(){setBusy(true);setError('');try{onSaved(await api<CaseAsset>(`assets/${original}/markup`,'POST',{id,strokes}));}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <Modal presentationStyle="fullScreen" animationType={reducedMotion?'none':'slide'} onRequestClose={close}><SafeAreaProvider><SafeAreaView style={{flex:1,backgroundColor:colors.canvas,padding:16,gap:12}}>
  <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text weight="semibold" size="lg">Mark photo</Text><Button label="Close" variant="ghost" disabled={busy} onPress={close}/></View>
  {discard?<><Text>Discard your unsaved photo marks?</Text><Button label="Keep drawing" onPress={()=>setDiscard(false)}/><Button label="Discard marks" variant="secondary" onPress={onClose}/></>:<>
   <Text size="xs" tone="textSecondary">Draw dimensions or notes. Your original photo stays unchanged.</Text>
   {(error||photo.error)&&<Notice error>{error||photo.error}</Notice>}
   <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>{photo.uri?<View accessibilityLabel="Drawing canvas" testID="drawing-canvas" onLayout={e=>{size.current=e.nativeEvent.layout;}} style={{width:canvasWidth,height:canvasWidth/ratio,backgroundColor:'#fff'}}
    onStartShouldSetResponder={()=>!busy&&imageReady} onMoveShouldSetResponder={()=>!busy&&imageReady}
    onResponderGrant={e=>{if(strokes.length>=100)return;const p=point(e.nativeEvent.locationX,e.nativeEvent.locationY);setStrokes(s=>[...s,{color,width,points:[p]}]);}}
    onResponderMove={e=>{const p=point(e.nativeEvent.locationX,e.nativeEvent.locationY);setStrokes(s=>{const last=s.at(-1);if(!last||last.points.length>=1499||s.reduce((n,l)=>n+l.points.length,0)>=3900)return s;const previous=last.points.at(-1)!;if(Math.hypot(p.x-previous.x,p.y-previous.y)<.002)return s;return [...s.slice(0,-1),{...last,points:[...last.points,p]}];});}}>
    <View pointerEvents="none" style={{position:'absolute',width:'100%',height:'100%'}}><Image source={{uri:photo.uri}} onLoad={e=>{setRatio(e.nativeEvent.source.width/e.nativeEvent.source.height);setImageReady(true);}} onError={()=>{setImageReady(false);setError('Could not open the photo. Close and try again.');}} style={{width:'100%',height:'100%'}} resizeMode="contain"/></View>
    <Svg pointerEvents="none" width="100%" height="100%" viewBox={`0 0 1000 ${1000/ratio}`}>{strokes.map((s,i)=>s.points.length===1?<Circle key={i} cx={s.points[0].x*1000} cy={s.points[0].y*1000/ratio} r={s.width*500} fill={s.color}/>:<Polyline key={i} points={s.points.map(p=>`${p.x*1000},${p.y*1000/ratio}`).join(' ')} stroke={s.color} strokeWidth={s.width*1000} fill="none" strokeLinecap="round" strokeLinejoin="round"/>)}</Svg>
   </View>:<Text>Opening photo…</Text>}</View>
   <View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}>{pens.map(([hex,label])=><Pressable accessibilityRole="button" accessibilityLabel={`${label} pen`} accessibilityState={{selected:hex===color}} key={hex} disabled={busy} onPress={()=>setColor(hex)} style={{width:36,height:36,borderRadius:18,backgroundColor:hex,borderWidth:hex===color?3:1,borderColor:hex===color?colors.focus:colors.borderControl}}/>)}</View>
   <View style={{flexDirection:'row',gap:8}}><Button label={width===.004?'Thin pen':'Thick pen'} variant="secondary" disabled={busy} onPress={()=>setWidth(w=>w===.004?.009:.004)}/><Button label="Undo" variant="ghost" disabled={busy||!strokes.length} onPress={()=>setStrokes(s=>s.slice(0,-1))}/><Button label="Clear" variant="ghost" disabled={busy||!strokes.length} onPress={()=>setStrokes([])}/></View>
   <Text size="xs" tone="textSecondary">Enter measured values in the Measurements fields too.</Text><Button label="Save marked copy" disabled={!original||!imageReady||!strokes.length} loading={busy} onPress={()=>void save()}/>
  </>}
 </SafeAreaView></SafeAreaProvider></Modal>;
}
