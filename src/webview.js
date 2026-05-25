/**
 * Code City 3D — Webview
 * Bundled by Vite → dist/webview.js
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Visualizer } from "./Visualizer.js";

// ─── Scene ────────────────────────────────────────────────────────────────────
const container = document.getElementById("canvas-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1e2e);
scene.fog = new THREE.Fog(0x1a1e2e, 120, 700);

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 2000);
camera.position.set(0, 60, 120);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
sun.position.set(60, 120, 60); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { near:1, far:800, left:-250, right:250, top:250, bottom:-250 });
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8ab4f8, 0.4);
fill.position.set(-60, 30, -60); scene.add(fill);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000,1000), new THREE.MeshLambertMaterial({ color:0x0d1117 }));
ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(1000, 200, 0x1f2937, 0x1f2937);
grid.position.y = 0.05; scene.add(grid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.screenSpacePanning = false; controls.minDistance = 3; controls.maxDistance = 1000;
controls.maxPolarAngle = Math.PI / 2.05;

// ─── Visualizer ───────────────────────────────────────────────────────────────
const visualizer = new Visualizer(scene);

// ─── Raycasting state ─────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(-9999, -9999);
let mouseX = 0, mouseY = 0, isDragging = false, mouseDownPos = { x:0, y:0 };
let hoverTick = 0;

// ─── Interactive mesh list (rebuilt after each visualize) ─────────────────────
// Only contains solid building/floor meshes — never BackSide outlines or sprites
let clickMeshes = [];

let lineMeshes = [];

function collectClickMeshes() {
  clickMeshes = []; lineMeshes = [];
  scene.traverse(obj => {
    const ud = obj.userData || {};
    // Collect connection lines for hover
    if ((obj.isLine || obj.isLineSegments) &&
        (ud.inheritanceLine || ud.compositionLine || ud.instantiationLine)) {
      lineMeshes.push(obj); return;
    }
    // Polymorphism arcs removed — too confusing visually
    if (!obj.isMesh) return;
    // New spatial elements
    if (ud.compositionModule || ud.compositionAnnex || ud.compositionBadge) { clickMeshes.push(obj); return; }
    if (ud.instantiationChimney) { clickMeshes.push(obj); return; }
    if (ud.inheritancePlinth || ud.inheritanceRidge) { clickMeshes.push(obj); return; }
    if (!ud.node && !ud.isMainFloorMesh && !ud.indicatorType && !ud.isConstructorIndicator && !ud.oopConcept) return;
    if (ud.isOutlineMesh) return;
    if (ud.compositionIndicator) return;
    if (ud.instantiationIndicator) return;
    const mat = obj.material;
    if (mat && !Array.isArray(mat) && mat.side === THREE.BackSide) return;
    clickMeshes.push(obj);
  });
}

// ─── Glow system — uses a separate overlay mesh, never mutates originals ──────
const HOVER_COLOR  = 0x00e5ff;
const SELECT_COLOR = 0xff9f00;

// Pool of glow meshes added to scene when needed
let hoverGlowMeshes  = [];
let selectGlowMeshes = [];

function removeGlowMeshes(arr) {
  arr.forEach(m => {
    if (m.parent) m.parent.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  });
  arr.length = 0;
}

function addGlowOverlay(targetMesh, color, scene) {
  if (!targetMesh.geometry) return null;
  // Create a slightly scaled-up copy with emissive color, rendered on back face
  const geo = targetMesh.geometry.clone();
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    transparent: false,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(geo, mat);
  // Copy world transform
  targetMesh.updateWorldMatrix(true, false);
  glow.applyMatrix4(targetMesh.matrixWorld);
  glow.scale.multiplyScalar(1.08);
  glow.userData.isGlowOverlay = true;
  scene.add(glow);
  return glow;
}

function getBuildingMeshes(mesh) {
  // Walk up to the building group
  let cur = mesh;
  while (cur.parent && !cur.userData?.isBuilding) cur = cur.parent;
  const result = [];
  cur.traverse(o => {
    if (!o.isMesh) return;
    const ud = o.userData || {};
    if (ud.isOutlineMesh || ud.isGlowOverlay) return;
    if (ud.inheritanceFamilyRoof || ud.inheritanceFamilyStripe) return;
    const mat = o.material;
    if (mat && !Array.isArray(mat) && mat.side === THREE.BackSide) return;
    result.push(o);
  });
  return result;
}

let hoveredMesh  = null;
let selectedMesh = null;

function applyHover(mesh) {
  if (mesh === hoveredMesh) return;
  clearHover();
  hoveredMesh = mesh;
  if (mesh === selectedMesh) return; // already selected, don't double-glow
  getBuildingMeshes(mesh).forEach(m => {
    const g = addGlowOverlay(m, HOVER_COLOR, scene);
    if (g) hoverGlowMeshes.push(g);
  });
}

function clearHover() {
  removeGlowMeshes(hoverGlowMeshes);
  hoveredMesh = null;
}

function applySelection(mesh) {
  clearHover();
  if (selectedMesh && selectedMesh !== mesh) {
    removeGlowMeshes(selectGlowMeshes);
  }
  selectedMesh = mesh;
  if (!mesh) return;
  getBuildingMeshes(mesh).forEach(m => {
    const g = addGlowOverlay(m, SELECT_COLOR, scene);
    if (g) selectGlowMeshes.push(g);
  });
}

function clearSelection() {
  removeGlowMeshes(selectGlowMeshes);
  removeGlowMeshes(hoverGlowMeshes);
  selectedMesh = null;
  hoveredMesh  = null;
  closeDetailPanel();
}

// ─── UI refs ──────────────────────────────────────────────────────────────────
const loadingEl   = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const errorEl     = document.getElementById("error");
const infoEl      = document.getElementById("info");
const statsEl     = document.getElementById("stats");
const tooltipEl   = document.getElementById("tooltip");
const detailPanel = document.getElementById("detail-panel");
const filterPanel = document.getElementById("filter-panel");
const legendEl    = document.getElementById("legend");

const showLoading = (msg) => { loadingText.textContent=msg||"Building city…"; loadingEl.classList.remove("hidden"); infoEl.classList.add("hidden"); statsEl.classList.add("hidden"); };
const hideLoading = () => loadingEl.classList.add("hidden");
const showError   = (msg) => { errorEl.textContent="⚠ "+msg; errorEl.classList.remove("hidden"); setTimeout(()=>errorEl.classList.add("hidden"),9000); };
const showInfo    = (msg) => { infoEl.querySelector("p").textContent=msg; infoEl.classList.remove("hidden"); };
const updateStats = (metrics,fc) => {
  if (!metrics) return;
  statsEl.innerHTML=`<span>📁 Files: <b>${fc}</b></span><span>🏛 Classes: <b>${metrics.classCount}</b></span><span>⚙ Methods: <b>${metrics.methodCount}</b></span><span>🔥 Max Cx: <b>${metrics.maxComplexity}</b></span>`;
  statsEl.classList.remove("hidden");
};

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function showTooltip(x, y, node, ownerName, indicatorType, extra) {
  if (!node && !extra?.isCompositionModule) { hideTooltip(); return; }
  tooltipEl.innerHTML = buildTooltipHTML(node, ownerName, indicatorType, extra);
  tooltipEl.classList.remove("hidden");
  positionTooltip(x, y);
}
function positionTooltip(x, y) {
  const tw=tooltipEl.offsetWidth||240, th=tooltipEl.offsetHeight||80;
  tooltipEl.style.left=Math.min(x+16,window.innerWidth-tw-8)+"px";
  tooltipEl.style.top=Math.min(y+16,window.innerHeight-th-8)+"px";
}
function hideTooltip() { tooltipEl.classList.add("hidden"); }

function buildTooltipHTML(node, ownerName, indicatorType, extra) {
  // Composition annex
  if (extra?.isCompositionModule) {
    const src = extra.ownerName || ownerName || "?";
    const tgt = extra.compositionTarget || "?";
    return `
      <div class="tt-header">◆ <b>Composition Annex</b> <span class="type-badge" style="background:#38bdf822;color:#38bdf8;border-color:#38bdf844">HAS-A</span></div>
      <div class="tt-owner"><b>${src}</b> CONTAINS a <b>${tgt}</b></div>
      <div class="tt-body">This annex building physically attached to <b>${src}</b> represents a stored <b>${tgt}</b> object — part of the building, not a subtype.</div>
      <div class="tt-hint">Click for full explanation</div>`.trim();
  }

  // Instantiation chimney
  if (extra?.isInstantiationChimney) {
    const src = extra.sourceClass || "?";
    const tgt = extra.targetClass || "?";
    return `
      <div class="tt-header">🏭 <b>Factory Chimney</b> <span class="type-badge" style="background:#ff660022;color:#ff6600;border-color:#ff660044">new ${tgt}</span></div>
      <div class="tt-owner"><b>${src}</b> manufactures <b>${tgt}</b> objects</div>
      <div class="tt-body">This chimney shows <b>${src}</b> calls <code>new ${tgt}()</code> somewhere inside it — it creates objects of that type. The glowing ring = active factory. Smoke = objects being produced.</div>
      <div class="tt-hint">Click for full explanation</div>`.trim();
  }

  // Inheritance plinth
  if (extra?.isInheritancePlinth) {
    const root = extra.familyRoot || "?";
    const child = extra.childClass;
    const parent = extra.parentClass;
    const rel = child && parent ? `${child} extends ${parent}` : `${root} family`;
    return `
      <div class="tt-header">🔗 <b>Inheritance Platform</b> <span class="type-badge" style="background:#a78bfa22;color:#a78bfa;border-color:#a78bfa44">IS-A</span></div>
      <div class="tt-owner">${rel}</div>
      <div class="tt-body">All buildings on this shared platform belong to the <b>${root}</b> family. The ridge path shows the direct parent→child link.</div>
      <div class="tt-hint">Click for full explanation</div>`.trim();
  }

  if (!node) return "";

  // Indicator-specific tooltip
  if (indicatorType) {
    const lesson = getLesson(node, indicatorType);
    const iname = node.name || "?";
    if (indicatorType === "inheritance-stripe" || indicatorType === "inheritance-roof") {
      const familyRoot = extra?.familyRoot;
      const familyLine = familyRoot
        ? `<div class="tt-owner">🔗 Inheritance family: <b style="color:#a78bfa">${familyRoot}</b></div>`
        : `<div class="tt-owner">🔗 Inheritance family: <b style="color:#a78bfa">unknown</b></div>`;
      const memberLine = familyRoot && iname !== familyRoot
        ? `<div class="tt-owner">↳ <b>${iname}</b> extends from <b>${familyRoot}</b></div>`
        : `<div class="tt-owner">↳ <b>${iname}</b> is the root of this family</div>`;
      return `
        ${indicatorStrip(indicatorType, lesson, extra)}
        <div class="tt-header">🏛 <b>${iname}</b></div>
        ${familyLine}
        ${memberLine}
        <div class="tt-hint">Click for full lesson · Ctrl+Click to open file</div>`.trim();
    }
    return `
      ${indicatorStrip(indicatorType, lesson, extra)}
      <div class="tt-header">⚙ <b>${iname}</b></div>
      ${ownerName?`<div class="tt-owner">↳ in <b>${ownerName}</b></div>`:""}
      ${node.lineStart?`<div class="tt-line">L${node.lineStart}–${node.lineEnd||node.lineStart}</div>`:""}
      ${lesson ? `<div class="tt-body">${lesson.what.substring(0,110)}…</div>` : ""}
      <div class="tt-hint">Click for full lesson · Ctrl+Click to open file</div>`.trim();
  }

  const concepts = detectOOPConcepts(node, ownerName);
  const badges = concepts.slice(0,3).map(d=>`<span class="oop-badge" style="background:${d.color}22;color:${d.color};border-color:${d.color}44">${d.icon} ${d.label}</span>`).join("");
  const params = (node.parameters||[]).length ? `<div class="tt-params">📥 (${node.parameters.join(", ")||"void"})</div>` : "";
  const cxVal = node.complexity||1;
  const cxLabel = cxVal>10?"very high — many nested branches, hard to test":cxVal>5?"high — consider splitting this method":cxVal>2?"moderate — some branching":"low — simple, linear code";
  const cx = cxVal>1 ? `<div class="tt-cx">Complexity <b style="color:${cxVal>5?"#ef4444":"#f59e0b"}">${cxVal}</b> — ${cxLabel}</div>` : "";
  const lines = node.lineStart ? `<div class="tt-line">L${node.lineStart}–${node.lineEnd||node.lineStart}</div>` : "";
  const owner = ownerName ? `<div class="tt-owner">↳ in <b>${ownerName}</b></div>` : "";
  const inh   = (node.inherits||[]).length ? `<div class="tt-inh">extends <b>${node.inherits.join(", ")}</b></div>` : "";
  const mcount = (node.children||[]).filter(d=>d.type==="method"||d.type==="function").length;
  const methods = mcount>0 ? `<div class="tt-methods">⚙ ${mcount} method${mcount!==1?"s":""}</div>` : "";
  const lesson = getLesson(node, null);
  const snippet = lesson ? `<div class="tt-body">${lesson.what.substring(0,100)}…</div>` : "";
  return `
    ${typeStrip(node)}
    <div class="tt-header"><b>${node.name||"?"}</b></div>
    ${owner}${lines}${inh}${params}${methods}${cx}
    ${snippet}
    ${badges ? `<div class="tt-concepts">${badges}</div>` : ""}
    <div class="tt-hint">Click for full lesson · Ctrl+Click to open file</div>
  `.trim();
}

// ─── OOP Concept Detection ────────────────────────────────────────────────────
function detectOOPConcepts(node) {
  const c = [], t = node.type;
  if ((node.inherits||[]).length>0) c.push({icon:"🔗",label:"Inheritance",color:"#a78bfa",desc:`Extends ${node.inherits.join(", ")}`});
  if ((node.implements||[]).length>0) c.push({icon:"📋",label:"Interface",color:"#22d3ee",desc:`Implements ${node.implements.join(", ")}`});
  if (t==="abstractClass"||node.isAbstract) c.push({icon:"🔷",label:"Abstract",color:"#818cf8",desc:"Cannot be instantiated directly"});
  if (t==="interface") c.push({icon:"📋",label:"Interface",color:"#22d3ee",desc:"Defines a contract"});
  if (node.overrides) c.push({icon:"🔀",label:"Polymorphism",color:"#34d399",desc:`Overrides ${node.overrides} from parent`});
  if (node.isVirtual||(node.modifiers||[]).includes("virtual")) c.push({icon:"◈",label:"Virtual",color:"#f59e0b",desc:"Can be overridden by subclasses"});
  if (node.isConstructor||t==="constructor") c.push({icon:"🔧",label:"Constructor",color:"#fb923c",desc:"Initialises the object"});
  if (node.access==="private"||(node.modifiers||[]).includes("private")) c.push({icon:"🔒",label:"Encapsulated",color:"#f87171",desc:"Private"});
  else if (node.access==="protected"||(node.modifiers||[]).includes("protected")) c.push({icon:"🛡",label:"Protected",color:"#fb923c",desc:"Subclasses only"});
  if ((node.modifiers||[]).includes("static")) c.push({icon:"⊞",label:"Static",color:"#94a3b8",desc:"Belongs to class, not instances"});
  if ((node.compositions||[]).length>0) c.push({icon:"◆",label:"Composition",color:"#f472b6",desc:`Uses ${node.compositions.map(x=>x.target).join(", ")}`});
  if ((node.complexity||0)>5) c.push({icon:"🔥",label:"High Complexity",color:"#ef4444",desc:`Complexity ${node.complexity}`});
  return c;
}

// ─── Built-in Educational Engine (no API needed) ─────────────────────────────
const EDU = {
  class:{icon:"🏛",color:"#3b82f6",
    what:"A CLASS is a blueprint for creating objects. It defines what properties (data) and methods (behaviours) objects of this type will have.",
    city:"In the city, this is a BUILDING. Its HEIGHT shows how many methods it has. Its WIDTH reflects how many properties it stores.",
    analogy:"Like a cookie cutter — the class is the cutter, and every object you create is a cookie made from it."},
  abstractClass:{icon:"🔷",color:"#8b5cf6",
    what:"An ABSTRACT CLASS cannot be used directly — it must be extended by a subclass. It defines some behaviour and leaves the rest for subclasses to implement.",
    city:"This PURPLE TOWER is under construction — its frame is visible but you cannot move in yet. Subclasses must complete the interior.",
    analogy:"A house blueprint with some rooms left blank. Someone must fill them in before the house can be lived in."},
  interface:{icon:"📋",color:"#06b6d4",
    what:"An INTERFACE defines a contract. Any class that implements it MUST provide all the listed methods — but decides how to implement them.",
    city:"A CYAN ZONING LAW BOARD. It does not build anything itself — it states the rules every building in this zone must follow.",
    analogy:"A job description — it lists required skills but does not tell you how to do the job."},
  method:{icon:"⚙",color:"#10b981",
    what:"A METHOD is a behaviour of a class — a named block of code that objects of this class can execute.",
    city:"Each method is one FLOOR of the building. Taller floors mean more complex methods. More floors means more behaviours.",
    analogy:"If a class is a restaurant, methods are its actions: takeOrder(), cookFood(), serveGuest()."},
  constructor:{icon:"🔧",color:"#fb923c",
    what:"A CONSTRUCTOR is a special method that runs automatically when an object is created. It sets up the object's initial state.",
    city:"The MAGENTA CUBE marks the constructor floor — the setup crew that activates the moment the building opens its doors.",
    analogy:"The opening ceremony of a new shop — runs once, sets everything up, then normal operations begin."},
  override:{icon:"🔀",color:"#34d399",
    what:"OVERRIDING happens when a child class replaces a method inherited from its parent with its own version. This is POLYMORPHISM — same method name, different behaviour.",
    city:"The BLUE CONE marks an overridden floor. This floor was redesigned from the parent building's original blueprint.",
    analogy:"A parent recipe says bake at 180C. A VeganBakery subclass overrides the recipe using plant-based ingredients — same method name, different result."},
  virtual:{icon:"◈",color:"#f59e0b",
    what:"A VIRTUAL method has a default implementation in the parent class but explicitly allows subclasses to replace it.",
    city:"The ORANGE DIAMOND marks a virtual floor — designed to be freely renovated by future building owners.",
    analogy:"A template clause in a contract: use our standard version, or write your own here."},
  abstract_method:{icon:"◇",color:"#818cf8",
    what:"An ABSTRACT METHOD has no body at all — just a declaration. Any concrete subclass MUST implement it.",
    city:"The YELLOW FRAME marks an abstract floor — scaffolding only. Subclasses must build the real floor.",
    analogy:"A blank required field on a form. You MUST fill it in — there is no default value."},
  encapsulation_public:{icon:"🌐",color:"#10b981",
    what:"PUBLIC means any code anywhere can call this method. It is part of the class public interface.",
    city:"The GREEN SPHERE means this floor is open to all visitors. Walk right in.",
    analogy:"The front door of a shop — open to everyone."},
  encapsulation_private:{icon:"🔒",color:"#f87171",
    what:"PRIVATE means only code inside the same class can use this method. It is completely hidden from outside — this is ENCAPSULATION.",
    city:"The RED OCTAHEDRON means this floor is staff-only. Visitors cannot enter.",
    analogy:"The back office — customers see the counter, only staff enter the stockroom."},
  encapsulation_protected:{icon:"🛡",color:"#fb923c",
    what:"PROTECTED means the method is hidden from outsiders, but accessible to subclasses. It shares internals with children while hiding them from unrelated code.",
    city:"The ORANGE PYRAMID means family members (subclasses) may use this floor, but strangers cannot.",
    analogy:"A family home — relatives are welcome in the living room, strangers are not."},
  composition:{icon:"◆",color:"#f472b6",
    what:"COMPOSITION means this class CONTAINS objects of another class as properties. It models a HAS-A relationship.",
    city:"The PINK SIDE MODULE attached to the building shows composition. This building contains a smaller structure as part of itself.",
    analogy:"A Car HAS-A Engine. The engine is part of the car, not a type of car."},
  static:{icon:"⊞",color:"#94a3b8",
    what:"A STATIC member belongs to the CLASS itself, not to individual objects. All instances share the same static member.",
    city:"A static floor is the SHARED ROOF — all residents use it together. It belongs to the building, not any single flat.",
    analogy:"A shared laundry room in an apartment block — it belongs to the building, not any one tenant."},
};

function getLesson(node, indicatorType) {
  const t=node?.type;
  let key=null;
  if(indicatorType){
    const m={constructor:"constructor",override:"override",virtual:"virtual",abstract:"abstract_method",
      "access-public":"encapsulation_public","access-private":"encapsulation_private","access-protected":"encapsulation_protected",
      "polymorphism-override":"override","polymorphism-virtual":"virtual","polymorphism-abstract":"abstract_method",
      "composition-module":"composition"};
    key = m[indicatorType] || (indicatorType==="encapsulation"?"encapsulation_"+(node?.access||"public"):null);
  } else if(t==="class") key="class";
  else if(t==="abstractClass") key="abstractClass";
  else if(t==="interface") key="interface";
  else if(t==="method"||t==="function"){
    if(node.isConstructor) key="constructor";
    else if(node.overrides) key="override";
    else if(node.isVirtual) key="virtual";
    else if(node.isAbstract) key="abstract_method";
    else key="method";
  }
  return key?EDU[key]:null;
}

function findClassNode(name) {
  for (const m of clickMeshes) {
    const n = m.userData?.node;
    if (n && (n.type==="class"||n.type==="abstractClass"||n.type==="interface") && n.name===name) return n;
  }
  return null;
}

function buildInheritedMethodsHTML(parentNode, childNode) {
  if (!parentNode) return "";
  const parentMethods = (parentNode.children||[]).filter(c=>c.type==="method"||c.type==="function"||c.type==="constructor");
  if (!parentMethods.length) return "";
  const childOverrides = new Set((childNode?.children||[]).filter(c=>c.overrides||(c.modifiers||[]).includes("override")).map(c=>c.name));
  const rows = parentMethods.map(m=>{
    const isOverridden = childOverrides.has(m.name);
    const icon = methodIcon(m);
    const accessIcon = m.access==="private"?"🔒":m.access==="protected"?"🛡":"🌐";
    const status = isOverridden
      ? `<span style="color:#00e5c8;font-size:11px">↑ overridden by ${childNode?.name||"child"}</span>`
      : `<span style="color:#6b7280;font-size:11px">✓ inherited</span>`;
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1e293b">
      <span style="font-size:13px">${icon}</span>
      <span style="flex:1;color:#e2e8f0;font-size:13px">${m.name}</span>
      <span style="font-size:11px">${accessIcon}</span>
      ${status}
    </div>`;
  }).join("");
  const label = childNode
    ? `What <b>${childNode.name}</b> gets from <b>${parentNode.name}</b>`
    : `Methods from <b>${parentNode.name}</b>`;
  return `<div class="edu-section"><div class="edu-label">📋 Inherited methods — ${label}</div><div class="edu-body" style="padding:0">${rows}</div></div>`;
}

function getLineLessonHTML(lineType, source, target) {
  const L={
    inheritance:{icon:"🔗",color:"#00ff00",label:"Inheritance",
      what:`<b>${source}</b> inherits from <b>${target}</b>. The child class (${source}) automatically gets all properties and methods of the parent (${target}).`,
      city:`The GREEN LINE connects the child building (${source}) to its parent (${target}). They share the same DISTRICT and ROOF STYLE — the same family.`,
      analogy:`${source} IS-A more specific type of ${target}. Like SportsCar being a specific type of Car.`},
    composition:{icon:"◆",color:"#f472b6",label:"Composition (HAS-A)",
      what:`<b>${source}</b> contains an object of type <b>${target}</b> as one of its properties. This is a HAS-A relationship — not IS-A.`,
      city:`The PINK LINE shows the ${source} building has a side module representing a ${target} object attached to it.`,
      analogy:`${source} HAS-A ${target}. Like a Car having an Engine — the engine is part of the car, not a kind of car.`},
    instantiation:{icon:"✦",color:"#fbbf24",label:"Instantiation (new object)",
      what:`A method in <b>${source}</b> creates a new object of type <b>${target}</b> using the 'new' keyword. This is called instantiation.`,
      city:`The ORANGE ARROW shows a factory line — a method in ${source} manufactures new ${target} objects at runtime.`,
      analogy:`A factory worker (${source}) using a mould (the ${target} class) to produce products (the objects).`},
    polymorphism:{icon:"🔀",color:"#34d399",label:"Polymorphism (Override)",
      what:`<b>POLYMORPHISM</b> means "many forms." The method <b>${source?.split(".")[1]||source}</b> exists in BOTH the parent and child class — but each has different code inside. When you call the method on any object in this family, the correct version runs automatically based on the actual type of the object.`,
      city:`In the city, both buildings have a FLOOR at the same name. The child's floor has the TEAL UPWARD ARROW — it is the redesigned version. The parent's floor is the original. Same floor name, different room interior.`,
      analogy:`A speak() method in Animal prints "...". Dog overrides it to print "Woof!". Cat overrides it to print "Meow!". You can call speak() on any Animal and get the right sound — without knowing which animal it is. That is polymorphism.`},
  };
  const l=L[lineType]; if(!l) return null;
  const inheritedSection = lineType==="inheritance"
    ? buildInheritedMethodsHTML(findClassNode(target), findClassNode(source))
    : "";
  return `<div class="edu-header" style="border-color:${l.color}44;background:${l.color}11">
    <span class="edu-icon">${l.icon}</span>
    <div><div class="edu-concept" style="color:${l.color}">${l.label}</div>
    <div class="edu-name">${source} ➜ ${target}</div></div></div>
    <div class="edu-section"><div class="edu-label">📖 What is it?</div><div class="edu-body">${l.what}</div></div>
    <div class="edu-section"><div class="edu-label">🏙 In this city</div><div class="edu-body">${l.city}</div></div>
    <div class="edu-section"><div class="edu-label">💡 Analogy</div><div class="edu-body">${l.analogy}</div></div>
    ${inheritedSection}`;
}

function buildEduHTML(node, ownerName, indicatorType) {
  const lesson = getLesson(node, indicatorType);
  if (!lesson) return '<div class="edu-na">Select a building or floor for its lesson.</div>';

  // ── Generate SPECIFIC explanation from actual node data ──────────────────
  const specific = buildSpecificExplanation(node, ownerName, indicatorType, lesson);

  return `
    <div class="edu-header" style="border-color:${lesson.color}44;background:${lesson.color}11">
      <span class="edu-icon">${lesson.icon}</span>
      <div>
        <div class="edu-concept" style="color:${lesson.color}">${lesson.what.split(".")[0]}.</div>
        <div class="edu-name">${node?.name||""}</div>
      </div>
    </div>
    <div class="edu-section">
      <div class="edu-label">🔍 This specific ${node?.type==="method"||node?.type==="function"?"method":"element"}</div>
      <div class="edu-body">${specific.thisElement}</div>
    </div>
    ${specific.whySection}
    <div class="edu-section">
      <div class="edu-label">🏙 In this city</div>
      <div class="edu-body">${specific.cityDesc}</div>
    </div>
    <div class="edu-section">
      <div class="edu-label">💡 Concept reminder</div>
      <div class="edu-body">${lesson.analogy}</div>
    </div>
    ${specific.codeDetails}
  `;
}

function buildSpecificExplanation(node, ownerName, indicatorType, lesson) {
  if (!node) return { thisElement:"Unknown element.", whySection:"", cityDesc:lesson.city, codeDetails:"" };

  const name      = node.name || "?";
  const t         = node.type;
  const mc        = (node.children||[]).filter(c=>c.type==="method"||c.type==="function").length;
  const pc        = (node.members||[]).length;
  const cx        = node.complexity || 1;
  const params    = (node.parameters||[]);
  const inherits  = (node.inherits||[]);
  const impls     = (node.implements||[]);
  const overrides = node.overrides;
  const access    = node.access || "public";
  const lines     = node.lineStart ? `lines ${node.lineStart}–${node.lineEnd||node.lineStart}` : "";
  const inClass   = ownerName ? ` in <b>${ownerName}</b>` : "";
  const inFile    = node.fileName ? ` (${node.fileName})` : "";

  let thisElement = "", whySection = "", cityDesc = "", codeDetails = "";

  // ── CLASS ──────────────────────────────────────────────────────────────────
  if (t === "class") {
    thisElement = `<b>${name}</b> is a class${inClass} that defines a reusable blueprint. It has <b>${mc} method${mc!==1?"s":""}</b> (what it can do) and <b>${pc} propert${pc!==1?"ies":"y"}</b> (what it stores).`;
    if (inherits.length) {
      thisElement += ` It extends <b>${inherits.join(", ")}</b>, which means it inherits all of that class's behaviour and can add its own.`;
      const parentNode = findClassNode(inherits[0]);
      const inheritedHTML = buildInheritedMethodsHTML(parentNode, node);
      whySection = `<div class="edu-section"><div class="edu-label">🔗 Why it inherits</div><div class="edu-body"><b>${name}</b> is a more specialised version of <b>${inherits[0]}</b>. Any code that can use a <b>${inherits[0]}</b> can also use a <b>${name}</b> — this is the Liskov Substitution Principle in action.</div></div>${inheritedHTML}`;
    }
    if (impls.length) {
      thisElement += ` It implements <b>${impls.join(", ")}</b>, committing to provide all the methods those interfaces require.`;
    }
    if (cx > 5) {
      thisElement += ` Its high combined complexity (${cx}) makes it a large, wide building in the city — a refactoring candidate.`;
    }
    cityDesc = `<b>${name}</b> appears as a building with <b>${mc} floor${mc!==1?"s":""}</b>. ${inherits.length ? `It stands in the same DISTRICT as <b>${inherits[0]}</b> and shares its roof style — marking it as part of the same family.` : "It stands alone — it is a root class with no parent in this codebase."} ${cx>5?"The tall, wide structure signals high complexity.":""}`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Defined at ${lines}${inFile}.</div></div>` : "";
  }

  // ── ABSTRACT CLASS ─────────────────────────────────────────────────────────
  else if (t === "abstractClass") {
    const abstractMethods = (node.children||[]).filter(c=>c.isAbstract||c.type==="abstractMethod");
    thisElement = `<b>${name}</b> is an abstract class${inClass}. It cannot be instantiated directly — you cannot write <code>new ${name}()</code>. It has <b>${mc} method${mc!==1?"s":""}</b> total, of which <b>${abstractMethods.length}</b> are abstract (must be implemented by subclasses).`;
    if (inherits.length) thisElement += ` It extends <b>${inherits[0]}</b>.`;
    whySection = `<div class="edu-section"><div class="edu-label">🤔 Why make it abstract?</div><div class="edu-body"><b>${name}</b> defines the shared structure for a group of related classes, but some behaviour is intentionally left incomplete. Subclasses are forced to provide those missing implementations — ensuring every subclass is a complete, working version.</div></div>`;
    cityDesc = `<b>${name}</b> appears as a PURPLE TOWER — dark, under construction. Its ${abstractMethods.length} abstract floor${abstractMethods.length!==1?"s":""} are marked with yellow scaffolding. No objects can be created from it directly.`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Defined at ${lines}${inFile}.</div></div>` : "";
  }

  // ── INTERFACE ──────────────────────────────────────────────────────────────
  else if (t === "interface") {
    thisElement = `<b>${name}</b> is an interface${inClass} — a pure contract with <b>${mc} method signature${mc!==1?"s":""}</b>. Every class that implements <b>${name}</b> is legally required to provide all ${mc} of these methods, but each class can implement them differently.`;
    whySection = `<div class="edu-section"><div class="edu-label">🤔 Why use an interface?</div><div class="edu-body">By programming to the <b>${name}</b> interface rather than a specific class, code becomes flexible — you can swap out any implementing class without changing the calling code. This is called "coding to an abstraction".</div></div>`;
    cityDesc = `<b>${name}</b> appears as a CYAN BLUEPRINT BOARD. It has no solid walls — only a frame. The ${mc} floor${mc!==1?"s":""} represent the method signatures every implementing building must include.`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Defined at ${lines}${inFile}.</div></div>` : "";
  }

  // ── CONSTRUCTOR ────────────────────────────────────────────────────────────
  else if (node.isConstructor || indicatorType === "constructor") {
    const paramStr = params.length ? params.join(", ") : "no parameters";
    thisElement = `<b>${name}</b> is the constructor of <b>${ownerName||"this class"}</b>. It runs automatically when someone writes <code>new ${ownerName||name}(${paramStr})</code> and sets up the initial state of the new object.`;
    if (params.length) {
      thisElement += ` It takes <b>${params.length} parameter${params.length!==1?"s":""}</b>: <i>${params.join(", ")}</i> — these become the object's starting values.`;
    } else {
      thisElement += ` It takes no parameters, so every new ${ownerName||name} object starts with the same default state.`;
    }
    whySection = `<div class="edu-section"><div class="edu-label">🤔 Why it exists</div><div class="edu-body">Without a constructor, objects of <b>${ownerName||name}</b> would have undefined or null fields. The constructor guarantees every new object is in a valid, ready-to-use state the moment it is created.</div></div>`;
    cityDesc = `The MAGENTA CUBE on this floor marks it as the constructor — the opening crew. Every time a new <b>${ownerName||name}</b> object is born, this floor activates first.`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Defined at ${lines}${inClass}${inFile}.</div></div>` : "";
  }

  // ── OVERRIDE (POLYMORPHISM) ────────────────────────────────────────────────
  else if (overrides || indicatorType === "override" || indicatorType === "polymorphism-override") {
    const parentMethod = overrides || "the parent method";
    thisElement = `<b>${name}</b> is a method in <b>${ownerName||"this class"}</b> that OVERRIDES <b>${parentMethod}</b> from its parent class. This is POLYMORPHISM — the method name is the same, but the behaviour in <b>${ownerName||"this class"}</b> is different from the parent's version.`;
    if (params.length) thisElement += ` Signature: <code>${name}(${params.join(", ")})</code>.`;
    whySection = `<div class="edu-section"><div class="edu-label">🤔 Why override <b>${parentMethod}</b>?</div><div class="edu-body">The parent's version of <b>${parentMethod}</b> is too generic for what <b>${ownerName}</b> needs. By overriding it, <b>${ownerName}</b> provides its own specialised version. When code calls <code>${parentMethod}()</code> on ANY object in this family — parent or child — the right version runs automatically. That is POLYMORPHISM: same method name, different behaviour per class.</div></div>`;
    cityDesc = `<b>Why a floor?</b> A floor represents a METHOD — something this class can DO. When a child class overrides a parent method, it still has the SAME FLOOR (same method name, same position in the building) but the INTERIOR is completely different code. The TEAL UPWARD ARROW on the left edge means: "this floor was redesigned from the parent's original — look up to the parent building to see where it came from." The horizontal stripe across the front marks it as polymorphic from any angle.`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Overrides <b>${parentMethod}</b> · Defined at ${lines}${inClass}${inFile}.</div></div>` : "";
  }

  // ── VIRTUAL ────────────────────────────────────────────────────────────────
  else if (node.isVirtual || indicatorType === "virtual" || indicatorType === "polymorphism-virtual") {
    thisElement = `<b>${name}</b> is a VIRTUAL method in <b>${ownerName||"this class"}</b>. It provides a default implementation that subclasses are allowed (but not required) to replace with their own version.`;
    if (params.length) thisElement += ` It takes: <i>${params.join(", ")}</i>.`;
    whySection = `<div class="edu-section"><div class="edu-label">🤔 Why mark it virtual?</div><div class="edu-body">Making <b>${name}</b> virtual signals to subclasses: "this behaviour is intentionally overridable". It is the parent's way of designing for extension — offering a sensible default while leaving the door open for specialisation.</div></div>`;
    cityDesc = `The ORANGE DIAMOND on this floor marks it as virtual — a floor the architect designed to be freely renovated by subclasses. The default implementation is usable as-is, but can be replaced.`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Defined at ${lines}${inClass}${inFile}.</div></div>` : "";
  }

  // ── ABSTRACT METHOD ────────────────────────────────────────────────────────
  else if (node.isAbstract || indicatorType === "abstract" || indicatorType === "polymorphism-abstract") {
    thisElement = `<b>${name}</b> is an ABSTRACT METHOD in <b>${ownerName||"this class"}</b>. It has no body — no code inside. Every non-abstract subclass of <b>${ownerName||"this class"}</b> is forced to provide its own implementation.`;
    if (params.length) thisElement += ` Signature: <code>${name}(${params.join(", ")})</code>.`;
    whySection = `<div class="edu-section"><div class="edu-label">🤔 Why leave it empty?</div><div class="edu-body"><b>${ownerName}</b> knows that every subclass MUST have a <b>${name}</b> method, but it cannot predict what each subclass should do. Making it abstract enforces the contract without dictating the implementation.</div></div>`;
    cityDesc = `The YELLOW SCAFFOLDING FRAME on this floor shows it is abstract — a floor that exists only as a structural requirement. Subclasses must build the real floor.`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Defined at ${lines}${inClass}${inFile}. No body — subclasses must implement.</div></div>` : "";
  }

  // ── ACCESS INDICATORS ──────────────────────────────────────────────────────
  else if (indicatorType && indicatorType.startsWith("access-")) {
    const lvl = indicatorType.replace("access-","");
    const shapes = {public:"GREEN SPHERE",private:"RED OCTAHEDRON",protected:"ORANGE PYRAMID"};
    const meanings = {
      public:`<b>${name}</b> is PUBLIC${inClass}. Any code anywhere can call it. It is part of the visible interface of <b>${ownerName||"this class"}</b>.`,
      private:`<b>${name}</b> is PRIVATE${inClass}. Only code inside <b>${ownerName||"this class"}</b> itself can call it. It is a hidden internal detail — this is ENCAPSULATION.`,
      protected:`<b>${name}</b> is PROTECTED${inClass}. Only code inside <b>${ownerName||"this class"}</b> and its subclasses can call it. Hidden from unrelated code.`
    };
    const whys = {
      public:`Making <b>${name}</b> public means it is intentionally part of the class's contract with the outside world.`,
      private:`Hiding <b>${name}</b> as private protects its implementation — callers cannot depend on it, so it can be freely changed or refactored without breaking anything outside the class.`,
      protected:`Marking <b>${name}</b> as protected shares an implementation detail with subclasses that may need it, while still hiding it from unrelated code.`
    };
    thisElement = meanings[lvl] || meanings.public;
    whySection = `<div class="edu-section"><div class="edu-label">🤔 Why this access level?</div><div class="edu-body">${whys[lvl]||whys.public}</div></div>`;
    cityDesc = `The ${shapes[lvl]||"INDICATOR"} on this floor shows its access level. ${lvl==="public"?"Open to all visitors.":lvl==="private"?"Staff-only — no entry for outsiders.":"Family-only — subclasses welcome, strangers not."}`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Method <b>${name}</b> at ${lines}${inClass}${inFile}.</div></div>` : "";
  }

  // ── REGULAR METHOD ─────────────────────────────────────────────────────────
  else if (t === "method" || t === "function") {
    const paramStr = params.length ? `(<i>${params.join(", ")}</i>)` : "()";
    const cxNote = cx > 5 ? ` It has a high cyclomatic complexity of <b>${cx}</b> — many conditional branches, a refactoring candidate.`
                 : cx > 2 ? ` It has moderate complexity (${cx}) — some branching logic inside.`
                 : " It is straightforward with low complexity.";
    const accessIcon2 = access==="private"?"🔒 private":access==="protected"?"🛡 protected":"🌐 public";
    const accessNote = ` Access level: <b>${accessIcon2}</b> — ${access==="private"?"only <b>"+ownerName+"</b> can call it":access==="protected"?"<b>"+ownerName+"</b> and its subclasses can call it":"any code anywhere can call it"}.`;
    thisElement = `<b>${name}${paramStr}</b> is a method${inClass}.${cxNote}${accessNote}`;
    const mods = (node.modifiers||[]).filter(m=>m!==access);
    if (mods.length) thisElement += ` Modifiers: <i>${mods.join(", ")}</i>.`;
    whySection = params.length ? `<div class="edu-section"><div class="edu-label">📥 Parameters</div><div class="edu-body">${name} receives: <b>${params.join(", ")}</b>. These are the inputs it needs to do its work.</div></div>` : "";
    cityDesc = `This is one FLOOR of the <b>${ownerName||"building"}</b>. ${cx>5?"Its tall height reflects high complexity — many code paths inside.":cx>2?"Its moderate height reflects some branching logic.":"Its compact height reflects simple, focused logic."}`;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 In your code</div><div class="edu-body">Defined at ${lines}${inClass}${inFile}.</div></div>` : "";
  }

  // ── FALLBACK ───────────────────────────────────────────────────────────────
  else {
    thisElement = `<b>${name}</b> — ${lesson.what}`;
    cityDesc = lesson.city;
    codeDetails = lines ? `<div class="edu-section"><div class="edu-label">📄 Location</div><div class="edu-body">${lines}${inClass}${inFile}</div></div>` : "";
  }

  return { thisElement, whySection, cityDesc, codeDetails };
}


// ─── Detail Panel ─────────────────────────────────────────────────────────────
function openDetailPanel(nodeOrLine, ownerName, lineInfo, ninfo) {
  // Line explanation — only shown when a line is directly clicked
  if (lineInfo) {
    const icon = lineInfo.lineType==="inheritance"?"🔗":lineInfo.lineType==="composition"?"◆":"✦";
    const html = getLineLessonHTML(lineInfo.lineType, lineInfo.source, lineInfo.target);
    detailPanel.innerHTML = `
      <div class="panel-header">
        <span class="panel-icon">${icon}</span>
        <span class="panel-title">${lineInfo.source} → ${lineInfo.target}</span>
        <button class="panel-close">✕</button>
      </div>
      <div class="edu-wrap">${html || "No lesson available."}</div>`;
    detailPanel.classList.remove("hidden");
    detailPanel.querySelector(".panel-close").addEventListener("click", ()=>{ closeDetailPanel(); clearSelection(); });
    return;
  }

  // Composition annex / module
  if (ninfo?.isCompositionModule) {
    const src = ninfo.ownerName || "this class";
    const tgt = ninfo.compositionTarget || "another class";
    const html = getLineLessonHTML("composition", src, tgt);
    detailPanel.innerHTML = `
      <div class="panel-header"><span class="panel-icon">◆</span><span class="panel-title">${src} HAS-A ${tgt}</span><button class="panel-close">✕</button></div>
      <div class="edu-section" style="padding:10px 14px 0">
        <div class="edu-label">🏗 What this annex building means</div>
        <div class="edu-body">This smaller building physically attached to <b>${src}</b>'s side is its <b>composition annex</b>. It represents that <b>${src}</b> stores a <b>${tgt}</b> object as one of its own properties — it literally CONTAINS one. The covered walkway connecting them shows they work closely together. This is a HAS-A relationship, not IS-A (inheritance).</div>
      </div>
      <div class="edu-wrap">${html||""}</div>`;
    detailPanel.classList.remove("hidden");
    detailPanel.querySelector(".panel-close").addEventListener("click",()=>{closeDetailPanel();clearSelection();});
    return;
  }

  // Instantiation chimney
  if (ninfo?.isInstantiationChimney) {
    const src = ninfo.sourceClass || "this class";
    const tgt = ninfo.targetClass || "another class";
    const html = getLineLessonHTML("instantiation", src, tgt);
    detailPanel.innerHTML = `
      <div class="panel-header"><span class="panel-icon">🏭</span><span class="panel-title">${src} manufactures ${tgt}</span><button class="panel-close">✕</button></div>
      <div class="edu-section" style="padding:10px 14px 0">
        <div class="edu-label">🏭 What this chimney means</div>
        <div class="edu-body">The <b>orange chimney stack</b> rising from the roof of <b>${src}</b> means: somewhere inside this class, a method calls <code>new ${tgt}()</code>. Each time that runs, a brand-new <b>${tgt}</b> object is born in memory.<br><br>
      <b>Why a chimney?</b> A factory chimney is the universal symbol of production. The class is a <em>factory</em> — it manufactures objects. The glowing ring at the top is the furnace mouth. The orange smoke puffs are the objects being produced, drifting up into memory. One chimney per class being created — so if a class instantiates 3 different types, it has 3 chimneys.</div>
      </div>
      <div class="edu-wrap">${html||""}</div>`;
    detailPanel.classList.remove("hidden");
    detailPanel.querySelector(".panel-close").addEventListener("click",()=>{closeDetailPanel();clearSelection();});
    return;
  }

  // Inheritance plinth
  if (ninfo?.isInheritancePlinth) {
    const root = ninfo.familyRoot || "a base class";
    const child = ninfo.childClass;
    const parent = ninfo.parentClass;
    const html = getLineLessonHTML("inheritance", child||root, parent||root);
    detailPanel.innerHTML = `
      <div class="panel-header"><span class="panel-icon">🔗</span><span class="panel-title">${root} inheritance family</span><button class="panel-close">✕</button></div>
      <div class="edu-section" style="padding:10px 14px 0">
        <div class="edu-label">🏛 What this shared platform means</div>
        <div class="edu-body">All buildings standing on this <b>raised platform</b> belong to the same inheritance family — they all extend <b>${root}</b> directly or indirectly. The shared ground shows they share a common ancestor. The accent-coloured <b>ridge path</b> connecting each child to its parent shows the direct IS-A link. Buildings deeper in the hierarchy stand on slightly lower ground, showing distance from the root.</div>
      </div>
      ${html?`<div class="edu-wrap">${html}</div>`:""}`;
    detailPanel.classList.remove("hidden");
    detailPanel.querySelector(".panel-close").addEventListener("click",()=>{closeDetailPanel();clearSelection();});
    return;
  }

  const node = nodeOrLine;
  if (!node) { closeDetailPanel(); return; }

  // Resolve indicatorType from ninfo if available
  const indicatorType = ninfo?.indicatorType || null;
  detailPanel.innerHTML = buildDetailHTML(node, ownerName, indicatorType);
  detailPanel.classList.remove("hidden");

  detailPanel.querySelectorAll(".method-row[data-name]").forEach(row => {
    row.addEventListener("click", () => focusMeshByName(row.dataset.name, node.name));
  });

  detailPanel.querySelector(".btn-open-file")?.addEventListener("click", () => {
    if (node && !node.filePath && ownerName) {
      scene.traverse(obj => {
        if (obj.userData?.isBuilding && obj.userData.node?.name === ownerName) {
          if (obj.userData.node?.filePath) node.filePath = obj.userData.node.filePath;
          if (obj.userData.node?.fileName) node.fileName = obj.userData.node.fileName;
        }
      });
    }
    openInEditor(node);
  });

  detailPanel.querySelector(".panel-close").addEventListener("click", () => { closeDetailPanel(); clearSelection(); });
}
function closeDetailPanel() { detailPanel.classList.add("hidden"); }

function buildDetailHTML(node, ownerName, indicatorType) {
  const concepts = detectOOPConcepts(node, ownerName);
  const methods  = (node.children||[]).filter(c=>c.type==="method"||c.type==="function");
  const props    = (node.members||[]).filter(m=>["property","attribute","field"].includes(m.type));

  const conceptsHTML = concepts.length ? `
    <div class="section-title">🧬 OOP Concepts</div>
    <div class="concept-grid">
      ${concepts.map(c=>`<div class="concept-card" style="border-color:${c.color}44;background:${c.color}11">
        <span class="concept-icon">${c.icon}</span>
        <div><div class="concept-label" style="color:${c.color}">${c.label}</div>
        <div class="concept-desc">${c.desc}</div></div></div>`).join("")}
    </div>` : "";

  const methodsHTML = methods.length ? `
    <div class="section-title">⚙ Methods (${methods.length})</div>
    <div class="method-list">
      ${methods.map(m=>{
        const mc=detectOOPConcepts(m,node.name);
        const badges=mc.map(c=>`<span class="mini-badge" title="${c.desc}" style="color:${c.color}">${c.icon}</span>`).join("");
        return `<div class="method-row" data-name="${m.name}" title="Fly to this floor">
          <span class="method-icon">${methodIcon(m)}</span>
          <span class="method-name">${m.name}</span>
          <span class="method-badges">${badges}</span>
          ${m.complexity>1?`<span class="cx-badge">cx:${m.complexity}</span>`:""}
          ${m.lineStart?`<span class="line-ref">L${m.lineStart}</span>`:""}
        </div>`;
      }).join("")}
    </div>` : "";

  const propsHTML = props.length ? `
    <div class="section-title">📦 Properties (${props.length})</div>
    <div class="prop-list">
      ${props.map(p=>`<div class="prop-row">
        <span class="prop-access">${accessIcon(p.access)}</span>
        <span class="prop-name">${p.name}</span>
        ${p.dataType?`<span class="prop-type">${p.dataType}</span>`:""}
      </div>`).join("")}
    </div>` : "";

  const inhHTML = (node.inherits||[]).length ? `
    <div class="section-title">🔗 Inheritance</div>
    <div class="inherit-list">${node.inherits.map(i=>`<div class="inherit-row">extends <b>${i}</b></div>`).join("")}</div>` : "";

  const implHTML = (node.implements||[]).length ? `
    <div class="section-title">📋 Implements</div>
    <div class="inherit-list">${node.implements.map(i=>`<div class="inherit-row"><b>${i}</b></div>`).join("")}</div>` : "";

  return `
    <div class="panel-header">
      <span class="panel-icon">${nodeIcon(node.type)}</span>
      <span class="panel-title">${node.name||"?"}</span>
      ${typeBadge(node.type)}
      <button class="panel-close" title="Close">✕</button>
    </div>
    ${ownerName?`<div class="detail-owner">↳ in <b>${ownerName}</b></div>`:""}
    <div class="detail-stats">
      ${node.lineStart?`<span class="detail-stat">L${node.lineStart}–${node.lineEnd||node.lineStart}</span>`:""}
      ${node.complexity>1?`<span class="detail-stat" style="color:#f87171">Complexity ${node.complexity}</span>`:""}
      ${node.fileName?`<span class="detail-stat">📁 ${node.fileName}</span>`:""}
    </div>
    ${node.fileName?`<button class="btn-open-file">📂 Open in Editor — L${node.lineStart||1}</button>`:""}
    <div class="edu-wrap">${buildEduHTML(node, ownerName, indicatorType||null)}</div>
    ${conceptsHTML}${inhHTML}${implHTML}${methodsHTML}${propsHTML}
  `;
}


// ─── Filter Panel ─────────────────────────────────────────────────────────────
const FILTERS = {
  classes:{label:"Classes",icon:"🏛",active:true}, abstractClass:{label:"Abstract",icon:"🔷",active:true},
  interfaces:{label:"Interfaces",icon:"📋",active:true}, methods:{label:"Methods",icon:"⚙",active:true},
  inheritance:{label:"Inheritance",icon:"🔗",active:true}, composition:{label:"Composition",icon:"◆",active:true},
  instantiation:{label:"Instantiation",icon:"✦",active:true}, polymorphism:{label:"Polymorphism",icon:"🔀",active:true},
  highComplexity:{label:"High Cx",icon:"🔥",active:false},
};
function buildFilterPanel() {
  filterPanel.innerHTML=`<div class="fp-title">Filter OOP Concepts</div><div class="fp-grid">
    ${Object.entries(FILTERS).map(([k,f])=>`<button class="fp-btn ${f.active?"active":""}" data-filter="${k}">${f.icon} ${f.label}</button>`).join("")}
  </div><div class="fp-actions"><button class="fp-all">All On</button><button class="fp-none">All Off</button></div>`;
  filterPanel.querySelectorAll(".fp-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{const k=btn.dataset.filter;FILTERS[k].active=!FILTERS[k].active;btn.classList.toggle("active",FILTERS[k].active);applyFilters();});
  });
  filterPanel.querySelector(".fp-all").addEventListener("click",()=>{Object.keys(FILTERS).forEach(k=>FILTERS[k].active=true);filterPanel.querySelectorAll(".fp-btn").forEach(b=>b.classList.add("active"));applyFilters();});
  filterPanel.querySelector(".fp-none").addEventListener("click",()=>{Object.keys(FILTERS).forEach(k=>FILTERS[k].active=false);filterPanel.querySelectorAll(".fp-btn").forEach(b=>b.classList.remove("active"));applyFilters();});
}
function applyFilters() {
  scene.traverse(obj=>{
    if (!obj.userData) return;
    const ud=obj.userData; let vis=true;
    if (ud.isBuilding&&ud.node){const t=ud.node.type;if(t==="abstractClass"&&!FILTERS.abstractClass.active)vis=false;else if(t==="interface"&&!FILTERS.interfaces.active)vis=false;else if(t==="class"&&!FILTERS.classes.active)vis=false;}
    if (ud.isFloorGroup&&!FILTERS.methods.active) vis=false;
    if ((ud.compositionModule||ud.compositionAnnex||ud.compositionWalkway)&&!FILTERS.composition.active) vis=false;
    if ((ud.instantiationChimney||ud.instantiationPuff)&&!FILTERS.instantiation.active) vis=false;
    if ((ud.inheritancePlinth||ud.inheritanceRidge||ud.inheritanceFamilyStripe||ud.inheritanceFamilyRoof)&&!FILTERS.inheritance.active) vis=false;
    if ((ud.inheritanceMethodMarker||ud.indicatorType==='override'||ud.indicatorType==='polymorphism-virtual'||ud.indicatorType==='polymorphism-abstract')&&!FILTERS.polymorphism.active) vis=false;
    if (obj.visible!==vis) obj.visible=vis;
  });
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function buildLegend() {
  legendEl.innerHTML=`
    <div class="legend-title">🗺 Legend <button class="legend-toggle-btn" id="legend-toggle">Hide</button></div>
    <div class="legend-items" id="legend-items">

      <div class="legend-section">① BUILDING BASE — what type is it?</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#3b82f6"></span> Blue base = Regular Class</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#8b5cf6"></span> Purple base = Abstract Class</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#06b6d4"></span> Cyan base = Interface</div>
      <div class="legend-row legend-note">Taller building = more methods · Wider = more properties</div>

      <div class="legend-section">② ROOF + STRIPES — who does it inherit from?</div>
      <div class="legend-row"><span class="legend-swatch" style="background:linear-gradient(135deg,#f59e0b,#10b981,#a78bfa)"></span> Roof &amp; stripe colour = inheritance group</div>
      <div class="legend-row legend-note">Classes with the <b style="color:#94a3b8">same colour roof</b> all inherit</div>
      <div class="legend-row legend-note">from the same base class (e.g. all extend Animal)</div>
      <div class="legend-row legend-note">Roof <b style="color:#94a3b8">shape</b> also groups them — same shape,</div>
      <div class="legend-row legend-note">same parent (flat/pyramid/spire/dome per group)</div>
      <div class="legend-row legend-note">No roof = does not inherit from anything</div>

      <div class="legend-section">③ FLOORS — one per method</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e5c000"></span> Yellow floor = Public method</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#374151;border:1px solid #555"></span> Dark floor = Private method</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#b45309"></span> Amber floor = Protected method</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#4338ca"></span> Indigo floor = Abstract method</div>

      <div class="legend-section">④ SHAPES ON FLOORS — access + OOP markers</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#22c55e;border-radius:50%"></span> Green sphere = Public access</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#f59e0b;clip-path:polygon(50% 0%,0% 100%,100% 100%)"></span> Yellow triangle = Protected access</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ef4444;transform:rotate(45deg)"></span> Red diamond = Private access</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff00ff"></span> Magenta cube = Constructor</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#00e5c8"></span> Teal arrow pole = Override (replaces parent)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff8800"></span> Orange strip = Virtual method (can be overridden)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffff00"></span> Yellow frame = Abstract method (must be implemented)</div>

      <div class="legend-section">⑤ SMALL CUBES AROUND BASE — properties</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#00ff88"></span> Green cube = Property / Field</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff6600"></span> Orange cube = Constant</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#9932cc"></span> Purple cube = Static member</div>

      <div class="legend-section">⑥ RELATIONSHIPS</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#1e3a1e;border:1px solid #4ade80"></span> Shared platform = Inheritance family</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#1a6fbf"></span> Side annex = Composition (has-a)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff4400;border-radius:50%"></span> Chimney = Instantiation (new X())</div>

      <div class="legend-section">⑦ PANEL &amp; TOOLTIP SYMBOLS</div>
      <div class="legend-row"><span class="legend-sym">🏛</span> Class</div>
      <div class="legend-row"><span class="legend-sym">🔷</span> Abstract Class</div>
      <div class="legend-row"><span class="legend-sym">📋</span> Interface</div>
      <div class="legend-row"><span class="legend-sym">⚙</span> Method / Function</div>
      <div class="legend-row"><span class="legend-sym">🔧</span> Constructor</div>
      <div class="legend-row"><span class="legend-sym">◇</span> Abstract Method (no body)</div>
      <div class="legend-row"><span class="legend-sym">◈</span> Virtual Method (can be overridden)</div>
      <div class="legend-row"><span class="legend-sym">🔀</span> Override / Polymorphism</div>
      <div class="legend-row"><span class="legend-sym">⊞</span> Static Member</div>
      <div class="legend-row"><span class="legend-sym">🌐</span> Public Access</div>
      <div class="legend-row"><span class="legend-sym">🛡</span> Protected Access</div>
      <div class="legend-row"><span class="legend-sym">🔒</span> Private Access</div>
      <div class="legend-row"><span class="legend-sym">◆</span> Composition (has-a)</div>
      <div class="legend-row"><span class="legend-sym">🔗</span> Inheritance Link</div>
      <div class="legend-row"><span class="legend-sym">✦</span> Instantiation (new object)</div>
      <div class="legend-row"><span class="legend-sym">🔥</span> High Complexity</div>

      <div class="legend-section">⑧ HOW TO USE</div>
      <div class="legend-row">Hover any shape → tooltip explains it</div>
      <div class="legend-row">Click → full OOP lesson</div>
      <div class="legend-row">Double-click building → enter it</div>
      <div class="legend-row">Ctrl+Click → open file in editor</div>
    </div>`;
  document.getElementById("legend-toggle").addEventListener("click",e=>{
    const el=document.getElementById("legend-items");
    el.classList.toggle("hidden");
    e.target.textContent=el.classList.contains("hidden")?"Show":"Hide";
  });
}
// ─── Open in editor ───────────────────────────────────────────────────────────
function openInEditor(node) {
  if (!node) return;
  // Prefer absolute path (filePath) over basename (fileName)
  const file = node.filePath || node.fileName || node.path || null;
  if (!file) {
    console.warn("Code City: no file path on node", node.name, "— cannot open editor");
    return;
  }
  const line = node.lineStart || 1;
  console.log("Code City: opening", file, "line", line);
  try {
    if (_vscodeApi) _vscodeApi.postMessage({ command:"openFile", file, line });
  } catch(e) { console.warn("Code City openFile:", e); }
}

// ─── Focus mesh by name ───────────────────────────────────────────────────────
function focusMeshByName(methodName, className) {
  let target=null;
  scene.traverse(obj=>{
    if(target||!obj.isMesh) return;
    const ud=obj.userData;
    if(ud.node?.name===methodName&&ud.ownerClassName===className) target=obj;
  });
  if (!target) return;
  applySelection(target);
  flyTo(target);
}

// ─── Camera ───────────────────────────────────────────────────────────────────
function flyTo(mesh) {
  const box=new THREE.Box3().setFromObject(mesh);
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  const dist=Math.max(size.length()*3.5,14);
  animateCam(camera.position.clone(),controls.target.clone(),
    new THREE.Vector3(center.x+dist*.55,center.y+dist*.45,center.z+dist*.55),center);
}
function fitCamera() {
  const viz=visualizer.getCurrentVisualization(); if(!viz) return;
  const box=new THREE.Box3().setFromObject(viz); if(box.isEmpty()) return;
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  const dist=Math.max(size.x,size.y,size.z)*2.0;
  animateCam(camera.position.clone(),controls.target.clone(),
    new THREE.Vector3(center.x+dist*.65,center.y+dist*.55,center.z+dist*.65),center);
}
function animateCam(sp,st,ep,et) {
  let t=0; const N=50;
  const tick=()=>{t++;const k=t<N?(t/N<.5?2*(t/N)**2:-1+(4-2*(t/N))*(t/N)):1;
    camera.position.lerpVectors(sp,ep,k);controls.target.lerpVectors(st,et,k);controls.update();
    if(t<N) requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
}

// ─── Node info from mesh ──────────────────────────────────────────────────────
function getNodeInfo(mesh) {
  const ud = mesh.userData || {};

  // Composition annex / module / badge / walkway
  if (ud.compositionModule || ud.compositionAnnex || ud.compositionBadge || ud.compositionWalkway) {
    return {
      node: ud.node || null,
      ownerName: ud.sourceClass || ud.ownerClassName || null,
      indicatorType: "composition-module",
      compositionTarget: ud.targetClass || null,
      isCompositionModule: true,
    };
  }

  // Instantiation chimney
  if (ud.instantiationChimney) {
    return {
      node: ud.node || null,
      ownerName: ud.sourceClass || ud.ownerClassName || null,
      indicatorType: "instantiation-chimney",
      isInstantiationChimney: true,
      sourceClass: ud.sourceClass || null,
      targetClass: ud.targetClass || null,
    };
  }

  // Inheritance plinth / ridge
  if (ud.inheritancePlinth || ud.inheritanceRidge) {
    return {
      node: null,
      ownerName: null,
      indicatorType: "inheritance-plinth",
      isInheritancePlinth: true,
      familyRoot: ud.familyRoot || null,
      childClass: ud.childClass || null,
      parentClass: ud.parentClass || null,
    };
  }

  // Roof / stripe — show family membership tooltip
  if (ud.inheritanceFamilyRoof || ud.inheritanceFamilyStripe || ud.indicatorType === "inheritance-roof" || ud.indicatorType === "inheritance-stripe") {
    return {
      node: ud.node || null,
      ownerName: null,
      indicatorType: ud.inheritanceFamilyRoof || ud.indicatorType === "inheritance-roof" ? "inheritance-roof" : "inheritance-stripe",
      familyRoot: ud.familyRoot || null,
      roofShape: ud.roofShape || null,
    };
  }

  // Floor indicator meshes (access sphere, override arrow, virtual octahedron, abstract frame, constructor cube)
  if (ud.indicatorType || ud.isConstructorIndicator || ud.oopConcept) {
    return {
      node: ud.node || null,
      ownerName: ud.ownerClassName || null,
      indicatorType: ud.indicatorType || (ud.isConstructorIndicator ? "constructor" : null) || (ud.oopConcept || null),
    };
  }

  // Method floor
  if (ud.node && (ud.node.type === "method" || ud.node.type === "function"))
    return { node: ud.node, ownerName: ud.ownerClassName || null };

  // Property / field / constant / static member cube around the base
  if (ud.node && (ud.node.type === "property" || ud.node.type === "attribute" || ud.node.type === "field" || ud.node.type === "constant" || ud.node.type === "static")) {
    let ownerName = ud.ownerClassName || null;
    if (!ownerName) {
      let cur = mesh.parent;
      while (cur) { if (cur.userData?.isBuilding && cur.userData.node) { ownerName = cur.userData.node.name; break; } cur = cur.parent; }
    }
    return { node: ud.node, ownerName };
  }

  // Walk up to building (base block or unknown mesh)
  let cur = mesh;
  while (cur) {
    if (cur.userData?.isBuilding && cur.userData.node)
      return { node: cur.userData.node, ownerName: null };
    cur = cur.parent;
  }

  if (ud.node) return { node: ud.node, ownerName: ud.ownerClassName || null };
  return { node: null, ownerName: null };
}

// ─── Mouse events ─────────────────────────────────────────────────────────────
renderer.domElement.addEventListener("mousemove",e=>{
  mouseX=e.clientX; mouseY=e.clientY;
  const r=renderer.domElement.getBoundingClientRect();
  mouse.x=((e.clientX-r.left)/r.width)*2-1;
  mouse.y=-((e.clientY-r.top)/r.height)*2+1;
  if(Math.abs(mouseX-mouseDownPos.x)>4||Math.abs(mouseY-mouseDownPos.y)>4) isDragging=true;
});
renderer.domElement.addEventListener("mousedown",e=>{mouseDownPos={x:e.clientX,y:e.clientY};isDragging=false;});

renderer.domElement.addEventListener("click",e=>{
  if(isDragging) return;
  // Inside view: click a room to show method explanation
  if (insideViewActive && insideRooms.length) {
    raycaster.setFromCamera(mouse, camera);
    const rhits = raycaster.intersectObjects(insideRooms, false);
    if (rhits.length) {
      const rm = rhits[0].object;
      if (rm.userData.node) {
        openDetailPanel(rm.userData.node, rm.userData.ownerName, null, { indicatorType: null });
      }
      return;
    }
    return; // inside view but no room hit — do nothing
  }
  raycaster.setFromCamera(mouse,camera);
  // Check lines first
  if(lineMeshes.length){
    raycaster.params.Line={threshold:1.2};
    const lhits=raycaster.intersectObjects(lineMeshes,false);
    if(lhits.length){
      const ud=lhits[0].object.userData;
      const li=ud.inheritanceLine?{lineType:"inheritance",source:ud.childClass,target:ud.parentClass}
              :ud.compositionLine?{lineType:"composition",source:ud.sourceClass,target:ud.targetClass}
              :ud.instantiationLine?{lineType:"instantiation",source:ud.sourceMethod,target:ud.targetClass}:null;
      if(li){openDetailPanel(null,null,li);return;}
    }
  }
  const hits=raycaster.intersectObjects(clickMeshes,false);
  if(!hits.length){clearSelection();hideTooltip();return;}
  const mesh=hits[0].object;
  const ninfo=getNodeInfo(mesh);
  const {node,ownerName}=ninfo;
  if(e.ctrlKey||e.metaKey){
    if (node && (!node.filePath && !node.fileName)) {
      let cur = mesh;
      while (cur) {
        if (cur.userData?.isBuilding && cur.userData.node?.filePath) {
          node.filePath = cur.userData.node.filePath;
          node.fileName = cur.userData.node.fileName;
          break;
        }
        cur = cur.parent;
      }
    }
    openInEditor(node);
    return;
  }
  applySelection(mesh);
  openDetailPanel(node, ownerName, null, ninfo);
  flyTo(mesh);
});

// Double-click a building → enter inside view
renderer.domElement.addEventListener("dblclick", () => {
  if (insideViewActive) return;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(clickMeshes, false);
  if (!hits.length) return;
  const mesh = hits[0].object;
  // Walk up to building group
  let cur = mesh;
  while (cur) {
    if (cur.userData?.isBuilding) { enterBuilding(cur); return; }
    cur = cur.parent;
  }
});

function doHoverRaycast() {
  if(insideViewActive){ hideTooltip(); return; }  // inside building — no city hover
  if(!clickMeshes.length) return;
  raycaster.setFromCamera(mouse,camera);
  // Check lines
  if(lineMeshes.length){
    raycaster.params.Line={threshold:1.0};
    const lhits=raycaster.intersectObjects(lineMeshes,false);
    if(lhits.length){
      const ud=lhits[0].object.userData;
      const li=ud.inheritanceLine?{lineType:"inheritance",source:ud.childClass,target:ud.parentClass}
              :ud.compositionLine?{lineType:"composition",source:ud.sourceClass,target:ud.targetClass}
              :ud.instantiationLine?{lineType:"instantiation",source:ud.sourceMethod,target:ud.targetClass}:null;
      if(li){
        clearHover();
        const lineIcon=li.lineType==="inheritance"?"🔗":li.lineType==="composition"?"◆":li.lineType==="polymorphism"?"🔀":"✦";
        const lineName=li.lineType==="inheritance"?"Inheritance":li.lineType==="composition"?"Composition (HAS-A)":li.lineType==="polymorphism"?"Polymorphism Override":"Instantiation (new object)";
        tooltipEl.innerHTML=`<div class="tt-header">${lineIcon} <b>${lineName}</b></div><div class="tt-body">${li.source||"?"} ➜ ${li.target||"?"}</div><div class="tt-hint">Click for full explanation</div>`;
        tooltipEl.classList.remove("hidden"); positionTooltip(mouseX,mouseY);
        renderer.domElement.style.cursor="pointer"; return;
      }
    }
  }
  const hits=raycaster.intersectObjects(clickMeshes,false);
  if(hits.length){
    const mesh=hits[0].object;
    if(mesh!==hoveredMesh){
      applyHover(mesh);
      const ninfo=getNodeInfo(mesh);
      showTooltip(mouseX,mouseY,ninfo.node,ninfo.ownerName,ninfo.indicatorType,ninfo);
      renderer.domElement.style.cursor="pointer";
      renderer.domElement.style.cursor="pointer";
    } else { positionTooltip(mouseX,mouseY); }
  } else {
    if(hoveredMesh){clearHover();hideTooltip();renderer.domElement.style.cursor="default";}
    else{tooltipEl.classList.add("hidden");}
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function runViz(files){
  showLoading(`Building city… (${files.length} files)`);
  setTimeout(()=>{
    try{
      visualizer.clear(); clickMeshes=[];
      removeGlowMeshes(hoverGlowMeshes); removeGlowMeshes(selectGlowMeshes);
      hoveredMesh=null; selectedMesh=null;
      const result=visualizer.visualizeFiles(files,{viewMode:"city",layoutMode:"grouped"});
      if(result.success){
        showInfo(`🌆 ${files.length} file${files.length!==1?"s":""} — entire workspace`);
        updateStats(result.metrics,result.filesProcessed);
        collectClickMeshes(); applyFilters(); fitCamera();
      } else { showError(result.error||"Visualization failed"); showInfo("No OOP structures found."); }
    } catch(err){ console.error("Code City viz error:",err); showError(err.message); }
    finally{ hideLoading(); }
  },50);
}

// Message handler removed — files now embedded in HTML directly

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener("resize",()=>{
  camera.aspect=container.clientWidth/container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth,container.clientHeight);
});

// ─── Render loop ──────────────────────────────────────────────────────────────
function animate(){
  requestAnimationFrame(animate);
  if(!insideViewActive){
    controls.update();
    if(++hoverTick%3===0) doHoverRaycast();
    renderer.render(scene,camera);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function nodeIcon(t){return{class:"🏛",abstractClass:"🔷",interface:"📋",method:"⚙",function:"⚙",property:"▪",attribute:"▪",field:"▪",constructor:"🔧",module:"📦"}[t]||"◆";}
function typeBadge(t){const m={class:["CLASS","#3b82f6"],abstractClass:["ABSTRACT","#8b5cf6"],interface:["INTERFACE","#06b6d4"],method:["METHOD","#10b981"],function:["FUNC","#10b981"],constructor:["CTOR","#f59e0b"],property:["PROP","#6b7280"],attribute:["ATTR","#6b7280"],field:["FIELD","#6b7280"]};const[l,c]=m[t]||["NODE","#6b7280"];return `<span class="type-badge" style="background:${c}22;color:${c};border-color:${c}44">${l}</span>`;}

function typeStrip(node) {
  const MAP = {
    class:         {label:"CLASS",         desc:"A blueprint — objects are created from this",           icon:"🏛", color:"#3b82f6"},
    abstractClass: {label:"ABSTRACT CLASS",desc:"Cannot be created directly — must be extended first",   icon:"🔷", color:"#8b5cf6"},
    interface:     {label:"INTERFACE",     desc:"A contract — any class that implements it must follow these rules", icon:"📋", color:"#06b6d4"},
    method:        {label:"METHOD",        desc:"A function that belongs to a class",                    icon:"⚙",  color:"#10b981"},
    function:      {label:"FUNCTION",      desc:"A standalone block of reusable logic",                  icon:"⚙",  color:"#10b981"},
    constructor:   {label:"CONSTRUCTOR",   desc:"Runs automatically when a new object is created",       icon:"🔧", color:"#f59e0b"},
    property:      {label:"PROPERTY",      desc:"Data stored inside this class",                        icon:"▪",  color:"#64748b"},
    attribute:     {label:"PROPERTY",      desc:"Data stored inside this class",                        icon:"▪",  color:"#64748b"},
    field:         {label:"FIELD",         desc:"Data stored inside this class",                        icon:"▪",  color:"#64748b"},
  };
  const resolvedType = (node.isAbstract && node.type === "class") ? "abstractClass" : node.type;
  const info = MAP[resolvedType] || {label:(node.type||"NODE").toUpperCase(), desc:"", icon:"◆", color:"#6b7280"};
  let accessBadge = "";
  if ((node.type==="method"||node.type==="function"||node.type==="constructor") && node.access) {
    const ac = {public:"#10b981",protected:"#f59e0b",private:"#ef4444"}[node.access]||"#6b7280";
    const ai = {public:"🌐",protected:"🛡",private:"🔒"}[node.access]||"◆";
    accessBadge = `<span class="ts-access" style="background:${ac}22;color:${ac};border:1px solid ${ac}44">${ai} ${node.access.toUpperCase()}</span>`;
  }
  return `<div class="type-strip" style="border-left:3px solid ${info.color};background:${info.color}18">
    <div class="ts-label" style="color:${info.color}">${info.icon} ${info.label}${accessBadge}</div>
    <div class="ts-desc">${info.desc}</div>
  </div>`;
}

function indicatorStrip(indicatorType, lesson, extra) {
  const MAP = {
    constructor:            {label:"CONSTRUCTOR MARKER",    desc:"This method initialises a new object when created",                icon:"🔧",color:"#f59e0b"},
    override:               {label:"OVERRIDE MARKER",       desc:"This method replaces a version inherited from a parent class",     icon:"🔀",color:"#00e5c8"},
    "polymorphism-override":{label:"OVERRIDE MARKER",       desc:"This method replaces a version inherited from a parent class",     icon:"🔀",color:"#00e5c8"},
    virtual:                {label:"VIRTUAL METHOD MARKER", desc:"Parent class says: subclasses are allowed to replace this method", icon:"◈", color:"#f59e0b"},
    "polymorphism-virtual": {label:"VIRTUAL METHOD MARKER", desc:"Parent class says: subclasses are allowed to replace this method", icon:"◈", color:"#f59e0b"},
    abstract:               {label:"ABSTRACT METHOD MARKER",desc:"No body here — subclasses MUST implement this method themselves",  icon:"◇", color:"#8b5cf6"},
    "polymorphism-abstract":{label:"ABSTRACT METHOD MARKER",desc:"No body here — subclasses MUST implement this method themselves",  icon:"◇", color:"#8b5cf6"},
    "access-public":        {label:"PUBLIC ACCESS",         desc:"Anyone can call this — fully open",                               icon:"🌐",color:"#10b981"},
    "access-protected":     {label:"PROTECTED ACCESS",      desc:"Only this class and its subclasses can call this",                icon:"🛡", color:"#f59e0b"},
    "access-private":       {label:"PRIVATE ACCESS",        desc:"Only this class itself can use this — hidden from outside",       icon:"🔒",color:"#ef4444"},
    "inheritance-roof":     {label:"INHERITANCE ROOF",      desc:"",                                                               icon:"🏠",color:"#a78bfa"},
    "inheritance-stripe":   {label:"INHERITANCE STRIPE",    desc:"",                                                               icon:"▬", color:"#a78bfa"},
  };
  let info = MAP[indicatorType] || {label:indicatorType.toUpperCase(), desc:"", icon:"◆", color:lesson?.color||"#6b7280"};
  // Dynamic description for roof/stripe based on family info
  if (indicatorType === "inheritance-roof" || indicatorType === "inheritance-stripe") {
    const family = extra?.familyRoot ? `the <b>${extra.familyRoot}</b>` : "an";
    const shape  = extra?.roofShape  ? ` (${extra.roofShape} style)` : "";
    info = { ...info, desc:`This building is part of ${family} inheritance family${shape}. All buildings with this same colour roof and stripes inherit from the same base class.` };
  }
  return `<div class="ts-indicator-strip" style="border-left:3px solid ${info.color};background:${info.color}18">
    <div class="ts-indicator-label" style="color:${info.color}">${info.icon} ${info.label}</div>
    <div class="ts-indicator-sub" style="color:#94a3b8">${info.desc}</div>
  </div>`;
}
function methodIcon(m){if(m.isConstructor||m.type==="constructor")return"🔧";if((m.modifiers||[]).includes("abstract")||m.isAbstract)return"◇";if((m.modifiers||[]).includes("override")||m.overrides)return"↑";if((m.modifiers||[]).includes("virtual")||m.isVirtual)return"◈";if((m.modifiers||[]).includes("static"))return"⊞";if(m.access==="private"||(m.modifiers||[]).includes("private"))return"🔒";return"⚙";}
function accessIcon(a){return{private:"🔒",protected:"🛡",public:"🌐"}[a]||"🌐";}

// ─── Inside View — HTML Overlay (Encapsulation Room View) ───────────────────
// ─── Inside View — Bright Isometric Room Layout ──────────────────────────────
// Clean, well-lit, easy to navigate. Camera positioned overhead at an angle
// so you can see ALL rooms at once. Each room is a coloured card on the floor.

let insideViewActive = false;
let insideScene      = null;
let insideRenderer   = null;
let insideCamera     = null;
let insideControls   = null;
let insideRooms      = [];
let insideAnimId     = null;
let outsideCamera    = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

const ACC = {
  public:    { bg: 0x0a4d1f, border: 0x22c55e, glow: 0x4ade80, label: '#4ade80', name: 'Public' },
  protected: { bg: 0x4a2e00, border: 0xf59e0b, glow: 0xfbbf24, label: '#fbbf24', name: 'Protected' },
  private:   { bg: 0x4d0a0a, border: 0xef4444, glow: 0xf87171, label: '#f87171', name: 'Private' },
};

function makeLabel(text, color, size) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 64);
  ctx.font = `${size}px Arial`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Truncate if too long
  let txt = text;
  while (ctx.measureText(txt).width > 490 && txt.length > 4) txt = txt.slice(0, -2) + '…';
  ctx.fillText(txt, 256, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true });
  const spr = new THREE.Sprite(mat);
  return spr;
}

function buildInsideScene(node) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0d1526);

  // Bright global lighting — no darkness
  s.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 20, 10);
  s.add(sun);
  const fill = new THREE.DirectionalLight(0xadd8ff, 0.5);
  fill.position.set(-10, 5, -5);
  s.add(fill);

  const methods = (node.children || []).filter(m => m.type === 'method' || m.type === 'function');
  const props   = (node.members  || []).filter(p => ['property','attribute','field'].includes(p.type));

  const CARD_W = 7, CARD_D = 5, CARD_H = 0.15;
  const GAP_X  = 2.5, GAP_Z = 2.5;
  const COLS   = 3;

  const rows  = Math.ceil(methods.length / COLS);
  const totalW = COLS * CARD_W + (COLS - 1) * GAP_X;
  const totalD = rows * CARD_D + (rows - 1) * GAP_Z;

  // Floor base — light grey
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(totalW + 8, 0.12, totalD + 10),
    new THREE.MeshLambertMaterial({ color: 0x151f30 })
  );
  floor.position.set(totalW / 2 - CARD_W / 2, -0.06, totalD / 2 - CARD_D / 2);
  s.add(floor);

  // Class title panel at the top
  const hdr = new THREE.Mesh(
    new THREE.BoxGeometry(totalW + 4, 0.15, 3.5),
    new THREE.MeshLambertMaterial({ color: 0x1e2d45 })
  );
  hdr.position.set(totalW / 2 - CARD_W / 2, 0, -CARD_D - 2);
  s.add(hdr);

  const typeIcon = node.type === 'abstractClass' ? '🔷' : node.type === 'interface' ? '📋' : '🏛';
  const titleSpr = makeLabel(`${typeIcon}  ${node.name}`, '#f1f5f9', 42);
  titleSpr.position.set(totalW / 2 - CARD_W / 2, 1.8, -CARD_D - 2);
  titleSpr.scale.set(9, 1.8, 1);
  s.add(titleSpr);

  const typeText = node.type === 'abstractClass'
    ? 'ABSTRACT CLASS — cannot be instantiated directly'
    : node.type === 'interface'
    ? `INTERFACE — all ${methods.length} methods must be implemented`
    : `CLASS — ${methods.length} method${methods.length !== 1 ? 's' : ''}  ·  ${props.length} propert${props.length !== 1 ? 'ies' : 'y'}`;
  const typeSpr = makeLabel(typeText, '#64748b', 26);
  typeSpr.position.set(totalW / 2 - CARD_W / 2, 1.0, -CARD_D - 2);
  typeSpr.scale.set(9, 1.1, 1);
  s.add(typeSpr);

  if ((node.inherits || []).length) {
    const inhSpr = makeLabel(`extends ${node.inherits.join(', ')}`, '#a78bfa', 24);
    inhSpr.position.set(totalW / 2 - CARD_W / 2, 0.3, -CARD_D - 2);
    inhSpr.scale.set(8, 1.0, 1);
    s.add(inhSpr);
  }

  // Legend row
  [['🌐 Public — open door', '#4ade80', -2],
   ['🛡 Protected — half open', '#fbbf24', 0],
   ['🔒 Private — locked', '#f87171', 2]].forEach(([txt, col, ox]) => {
    const lg = makeLabel(txt, col, 22);
    lg.position.set(ox * 3.5, 0.5, totalD + 3);
    lg.scale.set(6.5, 1.0, 1);
    s.add(lg);
  });

  const roomMeshes = [];

  methods.forEach((method, idx) => {
    const col  = idx % COLS;
    const row  = Math.floor(idx / COLS);
    const cx   = col * (CARD_W + GAP_X);
    const cz   = row * (CARD_D + GAP_Z);

    const access = method.access || 'public';
    const pal    = ACC[access] || ACC.public;
    const isConst = method.isConstructor;
    const isOver  = !!method.overrides;
    const isAbs   = !!method.isAbstract;
    const isVirt  = !!method.isVirtual;

    // ── Card base (the "floor" of the room) ──────────────────────────────
    const cardMat = new THREE.MeshLambertMaterial({ color: pal.bg });
    const card = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D), cardMat);
    card.position.set(cx, 0, cz);
    s.add(card);

    // Glowing border (4 thin bars around the card edge)
    const borderMat = new THREE.MeshBasicMaterial({ color: pal.border });
    [[CARD_W, 0.22, 0.18, cx, 0.16, cz - CARD_D/2],        // front
     [CARD_W, 0.22, 0.18, cx, 0.16, cz + CARD_D/2],        // back
     [0.18, 0.22, CARD_D, cx - CARD_W/2, 0.16, cz],        // left
     [0.18, 0.22, CARD_D, cx + CARD_W/2, 0.16, cz]].forEach(([w,h,d,x,y,z]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), borderMat);
      bar.position.set(x, y, z);
      s.add(bar);
    });

    // ── Door indicator (left side of card) ───────────────────────────────
    const doorH = 1.2, doorW = 0.5;
    const doorMat  = new THREE.MeshLambertMaterial({ color: pal.border });
    const doorBody = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.12), doorMat);
    // Open angle: public fully open, protected half, private closed
    const angle = access === 'private' ? 0 : access === 'protected' ? Math.PI*0.3 : Math.PI*0.55;
    const pivot = new THREE.Group();
    pivot.position.set(cx - CARD_W/2 + 0.25, doorH/2 + 0.15, cz - CARD_D/2 + 0.06);
    doorBody.position.set(doorW/2, 0, 0);
    pivot.add(doorBody);
    pivot.rotation.y = -angle;
    s.add(pivot);

    // Door frame
    const frameMat = new THREE.MeshBasicMaterial({ color: pal.glow });
    const topFrame = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.2, 0.12, 0.14), frameMat);
    topFrame.position.set(cx - CARD_W/2 + 0.5, doorH + 0.15, cz - CARD_D/2 + 0.06);
    s.add(topFrame);

    // Glow light above each card
    const glow = new THREE.PointLight(pal.glow, 0.6, 6);
    glow.position.set(cx, 1.5, cz);
    s.add(glow);

    // ── Clickable hitbox ──────────────────────────────────────────────────
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(CARD_W, 1.5, CARD_D),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitbox.position.set(cx, 0.75, cz);
    hitbox.userData.isRoom    = true;
    hitbox.userData.node      = method;
    hitbox.userData.ownerName = node.name;
    hitbox.userData.access    = access;
    s.add(hitbox);
    roomMeshes.push(hitbox);

    // ── Method name label ─────────────────────────────────────────────────
    const icon = isConst ? '🔧' : isAbs ? '◇' : isOver ? '🔀' : isVirt ? '◈' : '';
    const nameSpr = makeLabel(`${icon} ${method.name}()`, '#f1f5f9', 34);
    nameSpr.position.set(cx, 1.6, cz - 0.5);
    nameSpr.scale.set(7, 1.3, 1);
    s.add(nameSpr);

    // Access badge
    const accSpr = makeLabel(`${access === 'private' ? '🔒' : access === 'protected' ? '🛡' : '🌐'} ${pal.name}`, pal.label, 26);
    accSpr.position.set(cx, 1.05, cz - 0.5);
    accSpr.scale.set(5.5, 1.0, 1);
    s.add(accSpr);

    // Parameters
    const params = (method.parameters || []).join(', ');
    if (params) {
      const paramSpr = makeLabel(`(${params})`, '#64748b', 22);
      paramSpr.position.set(cx, 0.6, cz - 0.5);
      paramSpr.scale.set(6.5, 0.9, 1);
      s.add(paramSpr);
    }

    // Override / abstract note
    if (isOver) {
      const ovSpr = makeLabel(`↑ overrides ${method.overrides}`, '#34d399', 22);
      ovSpr.position.set(cx, 0.18, cz - 0.5);
      ovSpr.scale.set(6.5, 0.9, 1);
      s.add(ovSpr);
    }
    if (isAbs) {
      const abSpr = makeLabel('must be implemented by subclass', '#818cf8', 22);
      abSpr.position.set(cx, 0.18, cz - 0.5);
      abSpr.scale.set(6.5, 0.9, 1);
      s.add(abSpr);
    }

    // Complexity block (on the card surface)
    const cx2 = method.complexity || 1;
    const cxColor = cx2 > 5 ? 0xef4444 : cx2 > 2 ? 0xf59e0b : 0x22c55e;
    const cxBlock = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, cx2 * 0.22 + 0.1, 0.45),
      new THREE.MeshLambertMaterial({ color: cxColor, emissive: cxColor, emissiveIntensity: 0.6 })
    );
    cxBlock.position.set(cx + CARD_W/2 - 0.5, cx2 * 0.11 + 0.13, cz + CARD_D/2 - 0.5);
    s.add(cxBlock);
    if (cx2 > 1) {
      const cxSpr = makeLabel(`cx ${cx2}`, cx2 > 5 ? '#ef4444' : '#f59e0b', 20);
      cxSpr.position.set(cx + CARD_W/2 - 0.5, cx2 * 0.22 + 0.5, cz + CARD_D/2 - 0.5);
      cxSpr.scale.set(2.5, 0.8, 1);
      s.add(cxSpr);
    }
  });

  // ── Properties shelf at the bottom ───────────────────────────────────────
  if (props.length) {
    const shelfZ = rows * (CARD_D + GAP_Z) + 2;
    const shelfW = totalW + 4;
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(shelfW, 0.15, 3),
      new THREE.MeshLambertMaterial({ color: 0x1e2d45 })
    );
    shelf.position.set(totalW / 2 - CARD_W / 2, 0, shelfZ);
    s.add(shelf);

    const propTitle = makeLabel(`📦 Properties (${props.length})`, '#94a3b8', 28);
    propTitle.position.set(totalW / 2 - CARD_W / 2, 1.5, shelfZ);
    propTitle.scale.set(8, 1.1, 1);
    s.add(propTitle);

    const perRow = 4;
    const shown  = Math.min(props.length, 8);
    props.slice(0, shown).forEach((p, i) => {
      const pc = i % perRow, pr = Math.floor(i / perRow);
      const pAccess = p.access || 'private';
      const pIcon   = pAccess === 'private' ? '🔒' : pAccess === 'protected' ? '🛡' : '📦';
      const pSpr    = makeLabel(`${pIcon} ${p.name}${p.dataType ? ' : ' + p.dataType : ''}`, '#64748b', 22);
      const px      = (pc - (perRow - 1) / 2) * 5;
      pSpr.position.set(totalW / 2 - CARD_W / 2 + px, 0.8 - pr * 0.7, shelfZ);
      pSpr.scale.set(6.5, 0.9, 1);
      s.add(pSpr);
    });
    if (props.length > shown) {
      const moreSpr = makeLabel(`…and ${props.length - shown} more`, '#374151', 20);
      moreSpr.position.set(totalW / 2 - CARD_W / 2, 0.15, shelfZ);
      moreSpr.scale.set(5, 0.8, 1);
      s.add(moreSpr);
    }
  }

  return { scene: s, rooms: roomMeshes, totalW, totalD, rows };
}

function enterBuilding(buildingGroup) {
  if (insideViewActive) return;
  const node = buildingGroup.userData.node;
  if (!node) return;

  insideViewActive = true;
  hideTooltip(); closeDetailPanel(); clearSelection(); clearHover();

  outsideCamera.pos.copy(camera.position);
  outsideCamera.target.copy(controls.target);

  renderer.domElement.style.display = 'none';

  const { scene: iScene, rooms } = buildInsideScene(node);
  insideScene = iScene;
  insideRooms = rooms;

  // New canvas
  const iCanvas = document.createElement('canvas');
  iCanvas.id = 'inside-canvas';
  iCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:10;';
  container.appendChild(iCanvas);

  insideRenderer = new THREE.WebGLRenderer({ canvas: iCanvas, antialias: true });
  insideRenderer.setSize(container.clientWidth, container.clientHeight);
  insideRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const methods = (node.children || []).filter(m => m.type === 'method' || m.type === 'function');
  const COLS = 3, CARD_W = 7, CARD_D = 5, GAP_X = 2.5, GAP_Z = 2.5;
  const rows = Math.ceil(methods.length / COLS);
  const gridW = COLS * CARD_W + (COLS - 1) * GAP_X;
  const gridD = rows * CARD_D + (rows - 1) * GAP_Z;
  const cx = gridW / 2 - CARD_W / 2;
  const cz = gridD / 2 - CARD_D / 2;

  insideCamera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 300);
  // Position camera at 45° angle above, looking at center of grid
  const dist = Math.max(gridW, gridD) * 0.85 + 8;
  insideCamera.position.set(cx, dist * 0.8, cz + dist * 0.75);
  insideCamera.lookAt(cx, 0, cz);

  insideControls = new OrbitControls(insideCamera, iCanvas);
  insideControls.target.set(cx, 0, cz);
  insideControls.enableDamping  = true;
  insideControls.dampingFactor  = 0.08;
  insideControls.minDistance    = 5;
  insideControls.maxDistance    = dist * 2;
  insideControls.maxPolarAngle  = Math.PI * 0.78;
  insideControls.update();

  // Exit button
  document.getElementById('exit-inside').classList.remove('hidden');

  // HUD
  const existHud = document.getElementById('inside-hud');
  if (existHud) existHud.remove();
  const hudEl = document.createElement('div');
  hudEl.id = 'inside-hud';
  const tIcon = node.type === 'abstractClass' ? '🔷' : node.type === 'interface' ? '📋' : '🏛';
  hudEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
    <span>${tIcon}</span>
    <b style="color:#f1f5f9;font-size:14px">${node.name}</b>
    <span style="font-size:10px;color:#818cf8;background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.3);padding:1px 8px;border-radius:4px">${node.type.toUpperCase()}</span>
  </div>
  <div style="font-size:11px;color:#475569;margin-top:4px">Drag to rotate · Scroll to zoom · Click any room card for lesson · ESC to exit</div>`;
  hudEl.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(5,10,20,.92);border:1px solid rgba(99,102,241,.3);border-radius:9px;padding:9px 18px;z-index:60;backdrop-filter:blur(8px);text-align:center;pointer-events:none;white-space:nowrap;';
  container.appendChild(hudEl);

  // Raycaster for hover + click
  const iRay = new THREE.Raycaster();
  const iMouse = new THREE.Vector2();

  iCanvas.addEventListener('mousemove', e => {
    const r = iCanvas.getBoundingClientRect();
    iMouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    iMouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
    iRay.setFromCamera(iMouse, insideCamera);
    const hits = iRay.intersectObjects(insideRooms, false);
    if (hits.length) {
      const ud = hits[0].object.userData;
      if (ud.isRoom && ud.node) {
        const m = ud.node;
        const acc = ud.access || m.access || 'public';
        const aIcon = acc === 'private' ? '🔒' : acc === 'protected' ? '🛡' : '🌐';
        tooltipEl.innerHTML = `<div class="tt-header">⚙ <b>${m.name}()</b></div>
          <div class="tt-owner">↳ in <b>${ud.ownerName || ''}</b></div>
          <div class="tt-body">${aIcon} <b>${acc}</b>${m.overrides ? ' · overrides <b>' + m.overrides + '</b>' : ''}${m.isConstructor ? ' · constructor' : ''}</div>
          <div class="tt-hint">Click for full OOP lesson</div>`;
        tooltipEl.classList.remove('hidden');
        tooltipEl.style.left = Math.min(e.clientX + 16, window.innerWidth - 270) + 'px';
        tooltipEl.style.top  = Math.min(e.clientY + 16, window.innerHeight - 130) + 'px';
        iCanvas.style.cursor = 'pointer';
      }
    } else {
      tooltipEl.classList.add('hidden');
      iCanvas.style.cursor = 'default';
    }
  });

  iCanvas.addEventListener('click', e => {
    const r = iCanvas.getBoundingClientRect();
    iMouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    iMouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
    iRay.setFromCamera(iMouse, insideCamera);
    const hits = iRay.intersectObjects(insideRooms, false);
    if (hits.length) {
      const ud = hits[0].object.userData;
      if (ud.isRoom && ud.node) {
        tooltipEl.classList.add('hidden');
        openDetailPanel(ud.node, ud.ownerName, null, { indicatorType: null });
      }
    }
  });

  // Animate
  function animateInside() {
    insideAnimId = requestAnimationFrame(animateInside);
    insideControls.update();
    insideRenderer.render(insideScene, insideCamera);
  }
  animateInside();
}

function exitBuilding() {
  if (!insideViewActive) return;
  if (insideAnimId) { cancelAnimationFrame(insideAnimId); insideAnimId = null; }
  if (insideRenderer) { insideRenderer.dispose(); insideRenderer = null; }
  const iCanvas = document.getElementById('inside-canvas');
  if (iCanvas) iCanvas.remove();
  const hud = document.getElementById('inside-hud');
  if (hud) hud.remove();
  renderer.domElement.style.display = 'block';
  insideViewActive = false;
  insideRooms      = [];
  insideScene      = null;
  document.getElementById('exit-inside').classList.add('hidden');
  hideTooltip();
}

window.exitBuilding = exitBuilding;

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && insideViewActive) exitBuilding();
});

window.addEventListener('resize', () => {
  if (insideCamera && insideRenderer) {
    insideCamera.aspect = container.clientWidth / container.clientHeight;
    insideCamera.updateProjectionMatrix();
    insideRenderer.setSize(container.clientWidth, container.clientHeight);
  }
});


// ─── Boot ─────────────────────────────────────────────────────────────────────
buildFilterPanel();
buildLegend();

// Acquire VS Code API once — used only for openFile messages
let _vscodeApi = null;
try { _vscodeApi = acquireVsCodeApi(); } catch(e) {}

animate();

// Files are embedded in the HTML as window.__CITY_FILES__ before this script runs.
// Read them synchronously — no postMessage timing issues.
if (window.__CITY_FILES__ && window.__CITY_FILES__.length > 0) {
  const n = window.__CITY_FILES__.length;
  console.log('Code City: ' + n + ' files embedded, building city');
  showLoading('Building city… (' + n + ' file' + (n !== 1 ? 's' : '') + ')');
  setTimeout(function() {
    try { runViz(window.__CITY_FILES__); }
    catch(e) { hideLoading(); showError('Render error: ' + e.message); console.error(e); }
  }, 80);
} else {
  hideLoading();
  showInfo('Press Ctrl+Shift+V to visualize your workspace');
}

// Listen only for error messages
window.addEventListener('message', function(event) {
  var msg = event.data;
  if (msg && msg.command === 'error') { hideLoading(); showError(msg.error || 'Error'); }
});
