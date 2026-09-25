import type {Material,Order,ProjectData} from './execution';
import type {StockTransfer} from '../../../../services/business-core/src/projects/project-stock.types';
import {materialInventory} from '../../../../services/business-core/src/projects/project-inventory';
export function quantityToSource(material:Material,orders:Order[],transfers:StockTransfer[]=[],supplierReturns:ProjectData['supplierReturns']=[]):number {
 return materialInventory(material,orders,transfers,supplierReturns).shortfall;
}
