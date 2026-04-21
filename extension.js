const vscode = require("vscode");
const path   = require("path");
const fs     = require("fs");
const { WebviewProvider } = require("./webview-provider.js");

let webviewProvider = null;
let debounceTimer   = null;

const SUPPORTED = { ".py":"python", ".php":"php", ".cs":"csharp" };
const SKIP = new Set(["node_modules",".git","vendor","__pycache__","bin","obj",
  "dist","out","build",".vscode","migrations","venv",".venv","env","release","debug"]);

function readAsync(p){ return new Promise(r=>fs.readFile(p,"utf8",(e,d)=>r(e?null:d))); }
function skip(p){ return p.split(/[\\\/]/).some(s=>SKIP.has(s.toLowerCase())); }

async function scanWorkspace(){
  const uris = await vscode.workspace.findFiles(
    "**/*.{py,php,cs}",
    `{${[...SKIP].map(d=>`**/${d}/**`).join(",")}}`
  );
  const valid = uris.filter(u=>!skip(u.fsPath));
  const files = [];
  const BATCH = 40;
  for(let i=0;i<valid.length;i+=BATCH){
    const res = await Promise.all(valid.slice(i,i+BATCH).map(async u=>{
      const ext=path.extname(u.fsPath).toLowerCase();
      const lang=SUPPORTED[ext]; if(!lang) return null;
      const content=await readAsync(u.fsPath);
      if(!content?.trim()) return null;
      return { name:path.basename(u.fsPath), path:u.fsPath, language:lang,
               content: content.length>80000 ? content.slice(0,80000) : content };
    }));
    res.forEach(r=>r&&files.push(r));
  }
  return files;
}

// Open panel and scan BEFORE showing HTML — avoids the ready-signal loop
async function openAndVisualize(context){
  if(!webviewProvider) return;

  try {
    console.log("Code City: scanning workspace…");
    const t0 = Date.now();
    const files = await scanWorkspace();
    console.log(`Code City: scanned ${files.length} files in ${Date.now()-t0}ms`);

    // Now open/refresh panel with files already embedded in the HTML
    webviewProvider.openPanelWithFiles(context, files);

  } catch(e){
    console.error("Code City scan error:", e);
    // Open panel anyway to show the error
    webviewProvider.openPanel(context);
    webviewProvider.sendError(e.message);
  }
}

function debounce(context, ms=800){
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(()=> openAndVisualize(context), ms);
}

function activate(context){
  console.log("Code City activated");
  webviewProvider = new WebviewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("codeVisualizer.panel",{
      async deserializeWebviewPanel(panel){
        webviewProvider.setPanel(panel);
        // Rescan after deserialise
        setTimeout(()=> openAndVisualize(context), 800);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codeVisualizer.openPanel", ()=>{
      openAndVisualize(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codeVisualizer.refreshVisualization", ()=>{
      openAndVisualize(context);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc=>{
      const ext=path.extname(doc.fileName).toLowerCase();
      if(SUPPORTED[ext] && webviewProvider.isReady()) debounce(context, 600);
    })
  );

  const w = vscode.workspace.createFileSystemWatcher("**/*.{py,php,cs}");
  context.subscriptions.push(w);
  w.onDidCreate(()=>{ if(webviewProvider.isReady()) debounce(context, 1200); });
  w.onDidDelete(()=>{ if(webviewProvider.isReady()) debounce(context, 1200); });

  console.log("Code City ready — Ctrl+Shift+V");
}

function deactivate(){ clearTimeout(debounceTimer); }
module.exports = { activate, deactivate };
