import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect,it,vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { blankCatalogRecord } from "@/lib/workspace/catalog";
import { CatalogPriceDialog } from "./catalog-price-dialog";
import { CatalogRecordPicker } from "./catalog-picker";
import { importedPrices } from "@/lib/workspace/catalog-prices";

it('shows source prices for review without creating or guessing a price-book entry',()=>{
 const target={...blankCatalogRecord('material'),name:'Imported plywood',attributes:[
  {name:'base_price_inr',value:'780'},{name:'selling_price_inr',value:'897'},
  {name:'price',value:'999'},{name:'markup_percent',value:'15'},
 ]};
 const onSave=vi.fn();
 render(<DesignSystemProvider><CatalogPriceDialog target={target} items={[target]} canManage={false} canViewCosts={false} onClose={vi.fn()} onSave={onSave} onSaved={vi.fn()} onArchive={vi.fn()}/></DesignSystemProvider>);
 expect(screen.getByRole('heading',{name:'Imported prices · needs review'})).toBeVisible();
 expect(screen.queryByText('₹780.00')).not.toBeInTheDocument();expect(screen.getByText('₹897.00')).toBeVisible();
 expect(importedPrices(target)).toHaveLength(2);expect(onSave).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:'Save price'})).not.toBeInTheDocument();
});

it("saves a dated selling price against the material without changing its identity or unit",async()=>{
 const user=userEvent.setup();
 const unit={...blankCatalogRecord("unit"),id:"unit",catalogId:"catalog",name:"Square foot",code:"SQFT",version:1};
 const material={...blankCatalogRecord("material"),id:"material",catalogId:"catalog",name:"Plywood",code:"PLY",version:1,links:[{relation:"unit",targetId:unit.id}]};
 const onSave=vi.fn(async r=>({...r,version:1})),onSaved=vi.fn();
 render(<DesignSystemProvider><CatalogPriceDialog target={material} items={[material,unit]} canManage canViewCosts onClose={vi.fn()} onSave={onSave} onSaved={onSaved} onArchive={vi.fn()}/></DesignSystemProvider>);
 await user.type(screen.getByLabelText("Price per unit",{exact:false}),"150");
 await user.click(screen.getByRole("button",{name:/Internal cost Price type/}));
 await user.click(screen.getByRole("option",{name:"Selling price"}));
 await user.click(screen.getByRole("button",{name:/Price includes/}));
 await user.click(screen.getByRole("option",{name:"supply only"}));
 await user.click(screen.getByRole("button",{name:/Tax included/}));
 await user.click(screen.getByRole("option",{name:"No"}));
 await user.click(screen.getByRole("button",{name:"Save price"}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalled());
 expect(onSave.mock.calls[0][0]).toMatchObject({kind:"rate_card",catalogId:"catalog",configuration:{amount:150,currency:"INR",priceType:"selling",costIncludes:"supply_only",taxIncluded:"no"},links:[{relation:"material",targetId:"material"},{relation:"unit",targetId:"unit"}]});
 expect(material.version).toBe(1);
});

it("filters linked records by the typed search",async()=>{
 const user=userEvent.setup(),onChange=vi.fn();
 render(<DesignSystemProvider><CatalogRecordPicker label="Brand" items={[{id:"c",label:"Century"},{id:"m",label:"Merino"}]} selectedKey="m" onChange={onChange}/></DesignSystemProvider>);
 await user.clear(screen.getByRole("combobox",{name:"Brand"}));
 await user.type(screen.getByRole("combobox",{name:"Brand"}),"Cen");
 expect(screen.getByRole("option",{name:"Century"})).toBeVisible();
 expect(screen.getByRole("combobox",{name:"Brand"})).toHaveValue("Cen");
 expect(onChange).not.toHaveBeenCalled();
 await user.click(screen.getByRole("option",{name:"Century"}));
 expect(onChange).toHaveBeenCalledWith("c");
});
