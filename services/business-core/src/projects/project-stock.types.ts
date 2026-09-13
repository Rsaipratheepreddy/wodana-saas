export type StockEndpoint =
  | { kind: "warehouse"; id: string }
  | { kind: "project"; id: string; materialId: string };
export type StockTransfer = {
  id: string;
  title: string;
  source: StockEndpoint;
  destination: StockEndpoint;
  quantity: number;
  unit: string;
  catalogId: string;
  catalogVersion: number;
  status: "requested" | "approved" | "dispatched" | "received" | "cancelled";
  requestedBy: string;
  approvedBy?: string;
  accepted: number;
  rejected: number;
  rejectionResolved: boolean;
  reference: string;
  dueDate: string;
  history: { at: string; by: string; action: string; reference: string }[];
};
export type WarehouseStock = {
  id: string;
  location: string;
  catalogId: string;
  catalogVersion: number;
  title: string;
  unit: string;
  quantity: number;
  reserved: number;
};
export type StockState = {
  stock: WarehouseStock[];
  transfers: StockTransfer[];
  projectMaterials: {
    projectId: string;
    projectName: string;
    id: string;
    title: string;
    catalogId: string;
    catalogVersion: number;
    unit: string;
    available: number;
  }[];
};
