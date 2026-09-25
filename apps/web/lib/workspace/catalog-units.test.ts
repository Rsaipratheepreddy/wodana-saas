import { expect,it } from "vitest";
import {blankCatalogRecord} from "./catalog";
import {convertCatalogQuantity,unitMeaning} from "./catalog-units";
const foot={...blankCatalogRecord("unit"),name:"My custom foot",dimension:"length",baseFactor:0.3048};
const metre={...blankCatalogRecord("unit"),name:"Metre",dimension:"length",baseFactor:1};
it("uses dimensions and factors independently of names",()=>{
 expect(convertCatalogQuantity(8,foot,metre)).toBeCloseTo(2.4384);
 expect(convertCatalogQuantity(8,{...foot,name:"Tenant renamed this"},metre)).toBeCloseTo(2.4384);
 expect(convertCatalogQuantity(72,{...foot,dimension:"area",baseFactor:0.09290304},{...metre,dimension:"area"})).toBeCloseTo(6.68901888);
});
it("does not convert unlike dimensions, packs or invalid factors",()=>{
 expect(convertCatalogQuantity(1,foot,{...metre,dimension:"area"})).toBeNull();
 expect(convertCatalogQuantity(1,{...foot,dimension:"pack"},{...metre,dimension:"pack"})).toBeNull();
 expect(convertCatalogQuantity(1,foot,{...metre,baseFactor:0})).toBeNull();
 const watt={...foot,name:"Watt",dimension:"reference",baseFactor:undefined};
 expect(unitMeaning(watt)).toContain("no quantity conversion");
 expect(convertCatalogQuantity(1,watt,{...watt,name:"Lumen"})).toBeNull();
});
