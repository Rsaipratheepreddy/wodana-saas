import {parseDelimitedCatalog,type ImportTable} from './catalog-import';
export async function readCatalogImportFile(file:File):Promise<ImportTable[]> {
 if(file.size>2_000_000)throw new Error('Use a file smaller than 2 MB.');
 if(/\.(csv|tsv|txt)$/i.test(file.name))return [{name:file.name,rows:parseDelimitedCatalog(await file.text())}];
 if(!/\.xlsx$/i.test(file.name))throw new Error('Choose an .xlsx, .csv or .tsv file. Save older .xls files as .xlsx first.');
 // Bound advertised expanded XML size before the workbook reader opens the archive.
 const buffer=await file.arrayBuffer(),view=new DataView(buffer);let end=-1;
 for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('This is not a valid Excel workbook.');
 const count=view.getUint16(end+10,true);let offset=view.getUint32(end+16,true),expanded=0;
 if(!count||count>5000)throw new Error('This workbook has too many archive entries.');
 for(let i=0;i<count;i++){
  if(offset+46>buffer.byteLength||view.getUint32(offset,true)!==0x02014b50)throw new Error('The workbook archive is damaged.');
  expanded+=view.getUint32(offset+24,true);
  if(expanded>20_000_000)throw new Error('The expanded workbook is too large. Remove unused sheets or export a smaller CSV.');
  offset+=46+view.getUint16(offset+28,true)+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
 }
 const {default:readWorkbook}=await import('read-excel-file/browser');
 const sheets=await readWorkbook(file);
 if(sheets.length>50)throw new Error('Use a workbook with at most 50 worksheets.');
 return sheets.filter(sheet=>sheet.data.length).map(sheet=>{
  if(sheet.data.length>5000||sheet.data.some(row=>row.length>100))throw new Error(`${sheet.sheet}: use at most 5,000 source rows and 100 columns.`);
  return {name:sheet.sheet,rows:sheet.data.map(row=>row.map(value=>value instanceof Date?value.toISOString().slice(0,10):value==null?'':String(value)))};
 });
}
