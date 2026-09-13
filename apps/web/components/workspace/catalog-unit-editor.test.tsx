import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {DesignSystemProvider} from "@/design-system";
import {blankCatalogRecord} from "@/lib/workspace/catalog";
import {CatalogUnitEditor} from "./catalog-unit-editor";
it("shows the meaning and locks a used unit conversion including historical references",()=>{
 const unit={...blankCatalogRecord("unit"),version:1,id:"foot",name:"Foot",dimension:"length",baseFactor:0.3048};
 const material={...blankCatalogRecord("material"),archived:true,links:[{relation:"unit",targetId:unit.id}]};
 render(<DesignSystemProvider><CatalogUnitEditor draft={unit} items={[unit,material]} onChange={vi.fn()} disabled={false}/></DesignSystemProvider>);
 expect(screen.getByText("1 Foot = 0.3048 metres")).toBeVisible();
 expect(screen.getByRole("button",{name:/Measurement type/})).toBeDisabled();
 expect(screen.getByLabelText(/1 Foot equals/)).toBeDisabled();
});
