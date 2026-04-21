const vscode = require("vscode");

class WebviewProvider {
  constructor(extensionUri){
    this.extensionUri = extensionUri;
    this.panel = null;
  }

  isReady(){ return this.panel !== null; }

  setPanel(p){
    this.panel = p;
    this._listenForOpenFile();
  }

  // PRIMARY: scan happens BEFORE panel opens — files embedded in initial HTML load
  openPanelWithFiles(context, files){
    if(this.panel){
      // Panel already open — just replace HTML with new files
      this.panel.reveal(vscode.ViewColumn.Two);
      this.panel.webview.html = this._buildHtml(this.panel.webview, files);
      console.log(`Code City: refreshed HTML with ${files.length} files`);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "codeVisualizer.panel", "Code City 3D", vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots:[
          vscode.Uri.joinPath(this.extensionUri,"dist"),
          vscode.Uri.joinPath(this.extensionUri,"media"),
        ]
      }
    );

    // Embed files directly in the first HTML load — synchronous, no timing issues
    this.panel.webview.html = this._buildHtml(this.panel.webview, files);
    console.log(`Code City: opened panel with ${files.length} files embedded`);

    this.panel.onDidDispose(()=>{ this.panel = null; });
    this._listenForOpenFile();
  }

  // Fallback open with no files (shows "Press Ctrl+Shift+V")
  openPanel(context){
    if(this.panel){ this.panel.reveal(vscode.ViewColumn.Two); return; }
    this.panel = vscode.window.createWebviewPanel(
      "codeVisualizer.panel", "Code City 3D", vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots:[
          vscode.Uri.joinPath(this.extensionUri,"dist"),
          vscode.Uri.joinPath(this.extensionUri,"media"),
        ]
      }
    );
    this.panel.webview.html = this._buildHtml(this.panel.webview, []);
    this.panel.onDidDispose(()=>{ this.panel = null; });
    this._listenForOpenFile();
  }

  sendError(msg){
    try{ if(this.panel) this.panel.webview.postMessage({command:"error",error:msg}); }
    catch(e){}
  }

  // Only handle openFile messages — no more file delivery via postMessage
  _listenForOpenFile(){
    if(!this.panel) return;
    this.panel.webview.onDidReceiveMessage(msg=>{
      if(msg.command==="openFile" && msg.file){
        const line = Math.max(0,(msg.line||1)-1);
        vscode.workspace.openTextDocument(vscode.Uri.file(msg.file))
          .then(doc=>vscode.window.showTextDocument(doc,{
            viewColumn: vscode.ViewColumn.One,
            selection: new vscode.Selection(line,0,line,9999)
          }))
          .catch(e=>console.warn("Code City openFile:", e.message));
      }
      if(msg.command==="error"){
        vscode.window.showErrorMessage(`Code City: ${msg.error}`);
      }
    });
  }

  _buildHtml(webview, files){
    const nonce = this._nonce();
    const js  = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri,"dist","webview.js"));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri,"media","webview.css"));

    // Serialize files to JSON and embed as a global variable
    let fileScript = "";
    if(files && files.length > 0){
      try{
        const json = JSON.stringify(files);
        fileScript = `\n  <script nonce="${nonce}">window.__CITY_FILES__=${json};</script>`;
        console.log(`Code City: embedding ${files.length} files, JSON size: ${json.length} bytes`);
      }catch(e){
        console.error("Code City: JSON serialisation failed:", e.message);
      }
    }

    return `<!DOCTYPE html><html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'nonce-${nonce}';style-src 'unsafe-inline' ${webview.cspSource};img-src ${webview.cspSource} data:;font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${css}">
  <title>Code City 3D</title>
</head>
<body>
  <div id="container">
    <div id="canvas-container"></div>
    <div id="loading"><div class="spinner"></div><p id="loading-text">Starting…</p><div id="loading-sub"></div></div>
    <div id="error" class="hidden"></div>
    <div id="info"><p>Press Ctrl+Shift+V to visualize your workspace</p></div>
    <div id="stats" class="hidden"></div>
    <div id="hint">🖱 Drag to orbit · Scroll to zoom · Right-drag to pan · Double-click building to enter</div>
    <button id="exit-inside" class="hidden" onclick="exitBuilding()">← Exit Building (ESC)</button>
    <div id="tooltip" class="hidden"></div>
    <div id="inside-overlay" class="hidden"></div>
    <div id="detail-panel" class="hidden"></div>
    <div id="filter-panel"></div>
    <div id="legend"></div>
  </div>${fileScript}
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }

  _nonce(){
    const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let n=""; for(let i=0;i<32;i++) n+=c[Math.floor(Math.random()*c.length)]; return n;
  }
}

module.exports = { WebviewProvider };
