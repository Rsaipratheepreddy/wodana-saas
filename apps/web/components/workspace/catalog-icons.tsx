import { Archive, BedDouble, Box, Boxes, Folder, Ruler, Factory, Hammer, Layers, IndianRupee, Tag, Truck, Wrench, ClipboardList, type LucideIcon } from "lucide-react";
import type { CatalogKind, CatalogRecord } from "@/lib/workspace/catalog";
import styles from "./catalog-settings-page.module.css";

const icons: Record<string, LucideIcon> = { folder: Folder, rooms: BedDouble, items: Box, materials: Layers, measurements: Ruler, factory: Factory, site: Hammer, construction: Boxes, prices: IndianRupee, brands: Tag };
export const groupIconOptions = Object.keys(icons).map(id => ({id, label:id.charAt(0).toUpperCase()+id.slice(1)}));
const kinds: Partial<Record<CatalogKind, LucideIcon>> = {catalog_group:Archive,record_group:Folder,room:BedDouble,work:Box,material:Layers,sku:Boxes,brand:Tag,finish:Layers,unit:Ruler,measurement:Ruler,factory_process:Factory,site_process:Hammer,execution:Wrench,construction:Boxes,rate_card:IndianRupee,logistics_rule:Truck};
export function CatalogIcon({record,kind,icon}:{record?:CatalogRecord;kind?:CatalogKind;icon?:string}) {
 const resolvedKind=record?.kind??kind;
 const selected=icon??(record?.kind==="record_group"?String(record.configuration?.icon??""):"");
 const Component=icons[selected]??(resolvedKind==="record_group"?kinds[record?.configuration?.defaultKind as CatalogKind]??Folder:kinds[resolvedKind!])??ClipboardList;
 return <span className={styles.recordIcon} aria-hidden="true"><Component size={17} strokeWidth={1.7}/></span>;
}
export function GroupIconPicker({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}) {
 return <fieldset className={styles.iconPicker}><legend>Group icon</legend><div>{groupIconOptions.map(option=><button key={option.id} type="button" disabled={disabled} aria-label={`${option.label} icon`} aria-pressed={value===option.id} onClick={()=>onChange(option.id)}><CatalogIcon icon={option.id}/></button>)}</div></fieldset>;
}
