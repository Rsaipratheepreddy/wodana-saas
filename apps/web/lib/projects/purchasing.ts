import type {Material,Order} from './execution';
export function quantityToSource(material:Material,orders:Order[]):number{
 const covered=material.movements.reduce((n,m)=>n+(m.kind==='receive'?m.quantity:['waste','supplier_return','transfer_out'].includes(m.kind)?-m.quantity:0),0);
 const incoming=orders.filter(o=>o.materialId===material.id&&['submitted','approved','acknowledged'].includes(o.status)).reduce((n,o)=>n+Math.max(0,o.quantity-o.receipts.reduce((sum,r)=>sum+r.accepted,0)),0);
 return Math.max(0,Math.round((material.required-covered-incoming)*1e6)/1e6);
}
