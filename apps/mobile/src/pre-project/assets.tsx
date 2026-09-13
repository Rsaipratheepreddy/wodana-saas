import {useState} from 'react';
import {Image,Platform,View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {usePhoto} from './asset-preview';
import {Text,useTheme} from '../design-system';
import {Button,Notice} from './ui';
import {errorText,uuid,usePreProjectApi,type CaseAsset} from './api';
import {PhotoMarkup} from './photo-markup';
export function Photo({workspaceId,caseId,asset}:{workspaceId:string;caseId:string;asset:CaseAsset}){const photo=usePhoto(workspaceId,caseId,asset.hasPreview?asset.id:undefined);if(!asset.hasPreview)return <Text size="xs">PDF</Text>;return photo.uri?<Image source={{uri:photo.uri}} accessibilityLabel={asset.name} resizeMode="contain" style={{width:'100%',height:150,borderRadius:8}}/>:<Text size="xs" tone="textSecondary">{photo.error||'Loading photo…'}</Text>;}
export function Attachments({workspaceId,caseId,assets,onChange,onBusy,disabled=false}:{workspaceId:string;caseId:string;assets:CaseAsset[];onChange?:(assets:CaseAsset[])=>void;onBusy?:(busy:boolean)=>void;disabled?:boolean}){
 const api=usePreProjectApi(workspaceId,caseId);const {colors}=useTheme();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[marking,setMarking]=useState<CaseAsset|null>(null);
 const [failed,setFailed]=useState<Array<{id:string;uri:string;name:string;mimeType:string;size?:number;file?:globalThis.File}>>([]);
 const working=busy||disabled;const writable=Boolean(onChange);
 async function upload(files:typeof failed){if(files.length>20-assets.length){setError(`Only ${20-assets.length} more files can be attached.`);return;}if(files.some(f=>(f.size??0)>20*1024*1024)){setError('Each file must be 20 MB or smaller.');return;}setBusy(true);onBusy?.(true);setError('');const added=[...assets];let index=0;try{for(const item of files){const form=new FormData();if(Platform.OS==='web'){const file=item.file??await (await fetch(item.uri)).blob();form.append('file',file,item.name);}else form.append('file',{uri:item.uri,name:item.name,type:item.mimeType} as unknown as Blob);const saved=await api<CaseAsset>(`assets/${item.id}`,'POST',form);added.push(saved);onChange?.([...added]);index++;}setFailed([]);}catch(e){setFailed(files.slice(index));setError(errorText(e));}finally{setBusy(false);onBusy?.(false);}}
 async function pick(source:'camera'|'photos'|'files'){setError('');try{
  if(source==='files'){const result=await DocumentPicker.getDocumentAsync({type:['image/*','application/pdf'],multiple:true,copyToCacheDirectory:true});if(!result.canceled)await upload(result.assets.map(a=>({id:uuid(),uri:a.uri,name:a.name,mimeType:a.mimeType??'application/octet-stream',size:a.size,file:a.file})));return;}
  if(source==='camera'){const permission=await ImagePicker.requestCameraPermissionsAsync();if(!permission.granted){setError('Camera access is off. You can choose photos or enable camera access in device settings.');return;}}
  const result=source==='camera'?await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:.9}):await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:Math.max(1,20-assets.length),quality:.9});
  if(!result.canceled)await upload(result.assets.map(a=>({id:uuid(),uri:a.uri,name:a.fileName??`Photo-${Date.now()}.jpg`,mimeType:a.mimeType??'image/jpeg',size:a.fileSize,file:a.file})));
 }catch(e){setError(errorText(e));}}
 async function open(asset:CaseAsset){setError('');try{const data=await api<ArrayBuffer>(`assets/${asset.id}`,'GET',undefined,true);if(Platform.OS==='web'){const url=URL.createObjectURL(new Blob([data],{type:asset.mimeType}));const link=document.createElement('a');link.href=url;link.download=asset.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}else{const file=new File(Paths.cache,`${asset.id}-${asset.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`);file.write(new Uint8Array(data));if(await Sharing.isAvailableAsync())await Sharing.shareAsync(file.uri,{mimeType:asset.mimeType,dialogTitle:asset.name});else setError('File sharing is not available on this device.');}}catch(e){setError(errorText(e));}}
 return <View style={{gap:12}}>
  {writable&&<><Text size="sm" weight="medium">Photos & files · {assets.length}/20</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}><Button label="Camera" variant="secondary" disabled={working||assets.length>=20} onPress={()=>void pick('camera')}/><Button label="Photos" variant="secondary" disabled={working||assets.length>=20} onPress={()=>void pick('photos')}/><Button label="Files" variant="secondary" disabled={working||assets.length>=20} onPress={()=>void pick('files')}/></View></>}
  {busy&&<Text size="sm">Uploading…</Text>}{error&&<Notice error>{error}</Notice>}{failed.length>0&&<Button label={`Retry ${failed.length} upload${failed.length===1?'':'s'}`} disabled={working} onPress={()=>void upload(failed)}/>}
  {assets.map(asset=><View key={asset.id} style={{gap:8,paddingBottom:12,borderBottomWidth:1,borderBottomColor:colors.border}}><Photo workspaceId={workspaceId} caseId={caseId} asset={asset}/><Text size="xs" numberOfLines={2}>{asset.name}</Text><View style={{flexDirection:'row',gap:4,flexWrap:'wrap'}}><Button label="Open / save" variant="ghost" onPress={()=>void open(asset)}/>{writable&&asset.hasPreview&&<Button label="Draw" accessibilityLabel={`Draw on ${asset.name}`} variant="secondary" disabled={working||assets.length>=20} onPress={()=>setMarking(asset)}/>}{writable&&<Button label="Remove" variant="ghost" disabled={working} onPress={()=>onChange?.(assets.filter(a=>a.id!==asset.id))}/>}</View></View>)}
  {marking&&<PhotoMarkup workspaceId={workspaceId} caseId={caseId} asset={marking} onClose={()=>setMarking(null)} onSaved={asset=>{onChange?.([...assets,asset]);setMarking(null);}}/>}
 </View>;
}
