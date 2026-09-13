import type { AttendanceAction } from "@wodana/contracts";
export type PendingCapture = {
  key: string;
  input: AttendanceAction;
  photo: Blob | null;
  createdAt: number;
};
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("wodana-attendance", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("pending", { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
async function operation<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending", mode);
    const request = action(tx.objectStore("pending"));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export const readPending = (key: string) =>
  operation("readonly", (s) => s.get(key)) as Promise<
    PendingCapture | undefined
  >;
export async function writePending(pending:PendingCapture):Promise<void>{
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),read=store.get(pending.key);let conflict=false;
  read.onsuccess=()=>{const prior=read.result as PendingCapture|undefined;if(prior&&prior.input.actionId!==pending.input.actionId){conflict=true;tx.abort();}else store.put(pending);};
  tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(new Error(conflict?'Another attendance capture is pending. Refresh and retry the saved capture.':'The capture could not be saved on this device.'));};
 });
}
export const clearPending = (key: string) =>
  operation("readwrite", (s) => s.delete(key));
