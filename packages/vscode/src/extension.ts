import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { missingAppHtml, renderAppHtml } from './html';

// ---- Bridge messages (see README "App bridge") ----

/** Webview -> extension */
type FromApp =
  | { type: 'hearth.ready' }
  | { type: 'hearth.getKey'; serverId: string }
  | { type: 'hearth.setKey'; serverId: string; key: string }
  | { type: 'hearth.deleteKey'; serverId: string };

/** Extension -> webview */
type ToApp =
  | { type: 'hearth.key'; serverId: string; key: string | null }
  | { type: 'hearth.insert'; text: string }
  | { type: 'hearth.openThread'; sessionId: string };

const secretName = (serverId: string) => `hearth.key.${serverId}`;
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** One webview running the app (the editor panel or the sidebar view), with an outbox held until the app says it is ready. */
class AppHost {
  private ready = false;
  private outbox: ToApp[] = [];
  constructor(readonly webview: vscode.Webview, private readonly ctx: vscode.ExtensionContext, disposables: vscode.Disposable[]) {
    const appRoot = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'app');
    webview.options = { enableScripts: true, localResourceRoots: [appRoot] };
    webview.html = buildHtml(webview, appRoot);
    disposables.push(webview.onDidReceiveMessage((m) => void this.onMessage(m)));
  }

  post(msg: ToApp) {
    if (this.ready) void this.webview.postMessage(msg);
    else this.outbox.push(msg);
  }

  private async onMessage(m: FromApp) {
    if (!m || typeof m !== 'object') return;
    const secrets = this.ctx.secrets;
    switch (m.type) {
      case 'hearth.ready': {
        this.ready = true;
        const queued = this.outbox.splice(0);
        for (const q of queued) void this.webview.postMessage(q);
        return;
      }
      case 'hearth.getKey': {
        if (!validId(m.serverId)) return;
        const key = (await secrets.get(secretName(m.serverId))) ?? null;
        void this.webview.postMessage({ type: 'hearth.key', serverId: m.serverId, key } satisfies ToApp);
        return;
      }
      case 'hearth.setKey': {
        if (!validId(m.serverId)) return;
        if (typeof m.key === 'string' && m.key.trim()) await secrets.store(secretName(m.serverId), m.key.trim());
        else await secrets.delete(secretName(m.serverId));
        return;
      }
      case 'hearth.deleteKey': {
        if (!validId(m.serverId)) return;
        await secrets.delete(secretName(m.serverId));
        return;
      }
    }
  }
}

function buildHtml(webview: vscode.Webview, appRoot: vscode.Uri): string {
  const nonce = crypto.randomBytes(18).toString('base64');
  const indexPath = vscode.Uri.joinPath(appRoot, 'index.html').fsPath;
  let index: string;
  try {
    index = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return missingAppHtml(webview.cspSource, nonce);
  }
  return renderAppHtml(index, { assetBase: webview.asWebviewUri(appRoot).toString(), cspSource: webview.cspSource, nonce });
}

// ---- Editor panel ----

class HearthPanel {
  static current: HearthPanel | undefined;
  readonly host: AppHost;
  private readonly disposables: vscode.Disposable[] = [];

  static show(ctx: vscode.ExtensionContext): HearthPanel {
    if (HearthPanel.current) {
      HearthPanel.current.panel.reveal(undefined, true);
      return HearthPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('hearth.panel', 'Hearth', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media', 'app')],
    });
    panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');
    HearthPanel.current = new HearthPanel(panel, ctx);
    return HearthPanel.current;
  }

  private constructor(readonly panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext) {
    this.host = new AppHost(panel.webview, ctx, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private dispose() {
    HearthPanel.current = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}

// ---- Sidebar view ----

class HearthViewProvider implements vscode.WebviewViewProvider {
  static readonly id = 'hearth.view';
  host: AppHost | undefined;
  view: vscode.WebviewView | undefined;
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const disposables: vscode.Disposable[] = [];
    this.view = view;
    this.host = new AppHost(view.webview, this.ctx, disposables);
    view.onDidDispose(() => {
      this.view = undefined;
      this.host = undefined;
      for (const d of disposables.splice(0)) d.dispose();
    });
  }
}

// ---- Selection -> fenced block ----

const FENCE_LANG: Record<string, string> = {
  typescript: 'ts',
  typescriptreact: 'tsx',
  javascript: 'js',
  javascriptreact: 'jsx',
  python: 'py',
  shellscript: 'sh',
  plaintext: 'text',
};

export function fenceSelection(text: string, languageId: string, relPath: string, startLine: number, endLine: number): string {
  const lang = FENCE_LANG[languageId] ?? languageId;
  const range = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const body = text.endsWith('\n') ? text : `${text}\n`;
  return `${fence}${lang} ${relPath}:${range}\n${body}${fence}\n`;
}

function selectionAsBlock(editor: vscode.TextEditor): string | undefined {
  const sel = editor.selection;
  if (sel.isEmpty) return undefined;
  const doc = editor.document;
  const text = doc.getText(sel);
  if (!text.trim()) return undefined;
  // A selection ending at column 0 of the next line does not include that line.
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  const relPath = doc.isUntitled ? doc.fileName : vscode.workspace.asRelativePath(doc.uri, false).replace(/\\/g, '/');
  return fenceSelection(text, doc.languageId, relPath, sel.start.line + 1, endLine + 1);
}

// ---- Activation ----

export function activate(ctx: vscode.ExtensionContext) {
  const viewProvider = new HearthViewProvider(ctx);

  /** The app instance to talk to: the panel if open, else the visible sidebar view, else a newly opened panel. */
  const target = (): AppHost => {
    if (HearthPanel.current) {
      HearthPanel.current.panel.reveal(undefined, true);
      return HearthPanel.current.host;
    }
    if (viewProvider.host && viewProvider.view?.visible) return viewProvider.host;
    return HearthPanel.show(ctx).host;
  };

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HearthViewProvider.id, viewProvider, { webviewOptions: { retainContextWhenHidden: true } }),

    vscode.commands.registerCommand('hearth.open', () => { HearthPanel.show(ctx); }),

    vscode.commands.registerCommand('hearth.openProjectThread', () => { HearthPanel.show(ctx); }),

    vscode.commands.registerCommand('hearth.sendSelection', () => {
      const editor = vscode.window.activeTextEditor;
      const block = editor && selectionAsBlock(editor);
      if (!block) {
        void vscode.window.showInformationMessage('Hearth: select some text first.');
        return;
      }
      target().post({ type: 'hearth.insert', text: block });
    }),

    vscode.commands.registerCommand('hearth.openThread', async (sessionId?: unknown) => {
      let id = typeof sessionId === 'string' ? sessionId.trim() : undefined;
      if (!id) id = (await vscode.window.showInputBox({ title: 'Hearth: open thread', prompt: 'Session id', ignoreFocusOut: true }))?.trim();
      if (!id) return;
      target().post({ type: 'hearth.openThread', sessionId: id });
    }),

    vscode.commands.registerCommand('hearth.setKey', async () => {
      const serverId = (await vscode.window.showInputBox({
        title: 'Hearth: server id',
        prompt: 'The id of the server this key is for (as the app knows it)',
        ignoreFocusOut: true,
        validateInput: (v) => (validId(v.trim()) ? undefined : 'Enter a server id'),
      }))?.trim();
      if (!serverId) return;
      const key = await vscode.window.showInputBox({
        title: `Hearth: device key for ${serverId}`,
        prompt: 'Stored in VS Code secret storage. Leave empty to remove the stored key.',
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return;
      if (key.trim()) {
        await ctx.secrets.store(secretName(serverId), key.trim());
        void vscode.window.showInformationMessage(`Hearth: key saved for ${serverId}.`);
      } else {
        await ctx.secrets.delete(secretName(serverId));
        void vscode.window.showInformationMessage(`Hearth: key removed for ${serverId}.`);
      }
    }),
  );
}

export function deactivate() {}
