/**
 * The Google Picker: the person picks one spreadsheet, which grants Wodana (drive.file) that file only.
 * It runs with a short-lived drive.file token for the workspace's Google connection and Wodana's
 * browser key and Cloud project number (GOOGLE_PICKER_API_KEY, GOOGLE_PICKER_APP_ID).
 */

type PickerDoc = { id: string; name?: string };
type PickerData = { action: string; docs?: PickerDoc[] };
type PickerNamespace = {
  Action: { PICKED: string; CANCEL: string };
  ViewId: { SPREADSHEETS: string };
  DocsViewMode: { LIST: string };
  DocsView: new (viewId: string) => { setMode(mode: string): unknown; setIncludeFolders(value: boolean): unknown; setSelectFolderEnabled(value: boolean): unknown };
  PickerBuilder: new () => PickerBuilder;
};
type PickerBuilder = {
  setAppId(id: string): PickerBuilder; setOAuthToken(token: string): PickerBuilder; setDeveloperKey(key: string): PickerBuilder; addView(view: unknown): PickerBuilder;
  setLocale(locale: string): PickerBuilder; setTitle(title: string): PickerBuilder; setCallback(callback: (data: PickerData) => void): PickerBuilder; build(): { setVisible(visible: boolean): void };
};
type GoogleWindow = Window & { gapi?: { load(name: string, callback: () => void): void }; google?: { picker?: PickerNamespace } };

const SCRIPT = "https://apis.google.com/js/api.js";
let loading: Promise<PickerNamespace> | null = null;

function load(): Promise<PickerNamespace> {
  const scope = window as GoogleWindow;
  if (scope.google?.picker) return Promise.resolve(scope.google.picker);
  loading ??= new Promise<PickerNamespace>((resolve, reject) => {
    const ready = () => scope.gapi!.load("picker", () => (scope.google?.picker ? resolve(scope.google.picker) : reject(new Error("picker"))));
    if (scope.gapi) { ready(); return; }
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = ready;
    script.onerror = () => { loading = null; reject(new Error("picker")); };
    document.head.append(script);
  });
  return loading;
}

/** Opens the Picker on spreadsheets; resolves with the picked sheet, or null when the person cancels. */
export async function pickSpreadsheet(input: { token: string; apiKey: string; appId: string; locale: string; title: string }): Promise<{ id: string; name: string } | null> {
  const picker = await load();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
    view.setMode(picker.DocsViewMode.LIST);
    view.setIncludeFolders(false);
    view.setSelectFolderEnabled(false);
    new picker.PickerBuilder()
      .setAppId(input.appId).setOAuthToken(input.token).setDeveloperKey(input.apiKey).addView(view).setLocale(input.locale).setTitle(input.title)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED && data.docs?.[0]) resolve({ id: data.docs[0].id, name: data.docs[0].name ?? "" });
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build().setVisible(true);
  });
}
