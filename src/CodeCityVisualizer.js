/**
 * Code City Visualization
 * Represents code as buildings in a city
 */
import * as THREE from "three";

export class CodeCityVisualizer {
  constructor(scene) {
    this.scene = scene;
    this.cityGroup = new THREE.Group();
    this.scene.add(this.cityGroup);
    this.currentAst = null;
    this.classNodeMap = new Map();
    this.inheritanceFamilies = [];
    this.classFamilyMeta = new Map();
    this.familyStyles = new Map();
  }

  getClassNodes(ast) {
    if (!ast || !Array.isArray(ast.children)) return [];
    return ast.children.filter(
      (node) =>
        node.type === "class" ||
        node.type === "abstractClass" ||
        node.type === "interface",
    );
  }

  getParentNames(classNode) {
    if (!classNode) return [];
    const parents = classNode.inherits || classNode.extends || [];
    return Array.isArray(parents) ? parents.filter(Boolean) : [];
  }

  detectInheritanceFamilies(classNodes) {
    this.inheritanceFamilies = [];
    this.classFamilyMeta.clear();
    if (!Array.isArray(classNodes) || classNodes.length === 0) return [];

    const childrenMap = new Map();
    const parentMap = new Map();

    classNodes.forEach((node) => {
      if (!node.name) return;
      if (!childrenMap.has(node.name)) childrenMap.set(node.name, []);
      const directParent = this.getParentNames(node)[0] || null;
      parentMap.set(node.name, directParent);
      if (directParent) {
        if (!childrenMap.has(directParent)) childrenMap.set(directParent, []);
        childrenMap.get(directParent).push(node.name);
      }
    });

    const classNames = classNodes.map((n) => n.name).filter(Boolean);
    const roots = classNames.filter((name) => {
      const parent = parentMap.get(name);
      return !parent || !this.classNodeMap.has(parent);
    });

    const visited = new Set();
    roots.forEach((rootName, familyIndex) => {
      const queue = [{ name: rootName, depth: 0 }];
      const members = [];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current.name)) continue;
        visited.add(current.name);

        const children = childrenMap.get(current.name) || [];
        members.push({
          className: current.name,
          depth: current.depth,
          parent: parentMap.get(current.name) || null,
          children,
        });

        children.forEach((childName) => {
          queue.push({ name: childName, depth: current.depth + 1 });
        });
      }

      if (members.length > 0) {
        const family = {
          root: rootName,
          familyId: `${rootName}#${familyIndex}`,
          members,
          maxDepth: Math.max(...members.map((m) => m.depth)),
          familyIndex,
        };
        this.inheritanceFamilies.push(family);
        members.forEach((member) => {
          this.classFamilyMeta.set(member.className, {
            familyId: family.familyId,
            root: family.root,
            depth: member.depth,
            parent: member.parent,
          });
        });
      }
    });

    return this.inheritanceFamilies;
  }

  calculateFamilyDistrictPositions(family, center, orientationAngle = 0) {
    const positions = new Map();
    const byDepth = new Map();
    family.members.forEach((member) => {
      if (!byDepth.has(member.depth)) byDepth.set(member.depth, []);
      byDepth.get(member.depth).push(member);
    });

    const forwardDepthSpacing = 16;
    const branchSpacing = 12;
    const rightX = Math.cos(orientationAngle);
    const rightZ = -Math.sin(orientationAngle);
    const forwardX = Math.sin(orientationAngle);
    const forwardZ = Math.cos(orientationAngle);

    const rootMember = family.members.find((m) => m.depth === 0);
    if (rootMember) {
      // Parent at front/center of district.
      positions.set(
        rootMember.className,
        new THREE.Vector3(center.x - forwardX * 10, 0, center.z - forwardZ * 10),
      );
    }

    for (let depth = 1; depth <= family.maxDepth; depth++) {
      const level = byDepth.get(depth) || [];
      level.forEach((member, idx) => {
        const siblings = level.filter((m) => m.parent === member.parent);
        const siblingIdx = siblings.findIndex((m) => m.className === member.className);
        const spread = siblings.length > 1 ? siblingIdx - (siblings.length - 1) / 2 : 0;
        // For single-child chains, introduce a small zig-zag offset to avoid a rigid straight line.
        const chainOffset =
          siblings.length === 1 ? ((depth % 2 === 0 ? -1 : 1) * 6) : 0;
        const parentPos =
          positions.get(member.parent) ||
          new THREE.Vector3(center.x - forwardX * 10, 0, center.z - forwardZ * 10);
        const sideOffset = spread * branchSpacing + chainOffset;

        positions.set(
          member.className,
          new THREE.Vector3(
            parentPos.x + rightX * sideOffset + forwardX * forwardDepthSpacing,
            0,
            parentPos.z + rightZ * sideOffset + forwardZ * forwardDepthSpacing,
          ),
        );
      });
    }

    return positions;
  }

  getFamilyStyle(familyMeta) {
    if (!familyMeta) return null;
    if (this.familyStyles.has(familyMeta.root)) {
      return this.familyStyles.get(familyMeta.root);
    }

    const hue = ((this.familyStyles.size * 71) + 25) % 360;
    const style = {
      roofType: ["flat", "pyramid", "spire", "dome"][this.familyStyles.size % 4],
      primaryColor: new THREE.Color().setHSL(hue / 360, 0.65, 0.52),
      accentColor: new THREE.Color().setHSL(((hue + 22) % 360) / 360, 0.78, 0.56),
      stripeColor: new THREE.Color().setHSL(((hue + 12) % 360) / 360, 0.62, 0.42),
    };

    this.familyStyles.set(familyMeta.root, style);
    return style;
  }

  getDirectParentClassNode(classNode) {
    const directParentName = this.getParentNames(classNode)[0];
    if (!directParentName) return null;
    return this.classNodeMap.get(directParentName) || null;
  }

  getMethodNames(classNode) {
    if (!classNode || !Array.isArray(classNode.children)) return [];
    return classNode.children
      .filter((child) => child.type === "method" && child.name)
      .map((child) => child.name);
  }

  classifyMethodByInheritance(classNode, methodNode) {
    const parentNode = this.getDirectParentClassNode(classNode);
    if (!parentNode) {
      return {
        markerType: "child",
        parentName: null,
      };
    }

    const parentMethodNames = new Set(this.getMethodNames(parentNode));
    const explicitInheritedFlag =
      methodNode.isInherited === true ||
      methodNode.inheritedFrom === true ||
      methodNode.inheritedFromClass;
    const isOverride =
      parentMethodNames.has(methodNode.name) ||
      methodNode.overrides === true ||
      (Array.isArray(methodNode.modifiers) &&
        methodNode.modifiers.includes("override"));

    if (explicitInheritedFlag && !isOverride) {
      return {
        markerType: "inherited",
        parentName: parentNode.name,
        parentHasMethod: parentMethodNames.has(methodNode.name),
      };
    }

    return {
      markerType: isOverride ? "override" : "child",
      parentName: parentNode.name,
      parentHasMethod: parentMethodNames.has(methodNode.name),
    };
  }

  addFamilyRoof(buildingGroup, width, depth, totalHeight, familyStyle, depthLevel) {
    if (!familyStyle) return;

    const roofColor = familyStyle.accentColor
      .clone()
      .offsetHSL(0, 0, Math.min(0.12, depthLevel * 0.03));
    let roofMesh;

    if (familyStyle.roofType === "pyramid") {
      roofMesh = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(width, depth) * 0.35, 2.4, 4),
        new THREE.MeshPhongMaterial({
          color: roofColor,
          emissive: roofColor,
          emissiveIntensity: 0.25,
        }),
      );
      roofMesh.rotation.y = Math.PI / 4;
    } else if (familyStyle.roofType === "spire") {
      roofMesh = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(width, depth) * 0.22, 3.2, 8),
        new THREE.MeshPhongMaterial({
          color: roofColor,
          emissive: roofColor,
          emissiveIntensity: 0.25,
        }),
      );
    } else if (familyStyle.roofType === "dome") {
      roofMesh = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(width, depth) * 0.25, 16, 10),
        new THREE.MeshPhongMaterial({
          color: roofColor,
          emissive: roofColor,
          emissiveIntensity: 0.2,
        }),
      );
      roofMesh.scale.y = 0.65;
    } else {
      roofMesh = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.92, 0.7, depth * 0.92),
        new THREE.MeshPhongMaterial({
          color: roofColor,
          emissive: roofColor,
          emissiveIntensity: 0.2,
        }),
      );
    }

    roofMesh.position.y = totalHeight + 1.1;
    roofMesh.userData.inheritanceFamilyRoof = true;
    buildingGroup.add(roofMesh);
  }

  createCity(ast, options) {
    // Clear previous city
    this.clear();
    this.currentAst = ast;
    this.classNodeMap.clear();
    this.familyStyles.clear();

    const { colorScheme = "default", layoutMode = "grouped" } = options;
    this.colorScheme = this.getColorScheme(colorScheme);

    const classNodes = this.getClassNodes(ast);
    classNodes.forEach((node) => {
      if (node.name) this.classNodeMap.set(node.name, node);
    });
    const families = this.detectInheritanceFamilies(classNodes);

    const estimatedGridSize = this.estimateGridSize(classNodes.length);

    // Create city grid sized to current project footprint.
    this.createGrid(estimatedGridSize);

    if (layoutMode === "compact") {
      this.createCompactUngroupedLayout(ast);
    } else {
      // Place inheritance families first as coherent districts.
      const placedClasses = new Set();
      const familyCount = families.length;
      const familyCols = Math.max(1, Math.ceil(Math.sqrt(Math.max(familyCount, 1))));
      const familyDistrictSpacing =
        familyCount <= 2
          ? 38
          : familyCount <= 4
            ? 48
            : 58;

      families.forEach((family, index) => {
        let centerX;
        let centerZ;

        if (familyCount <= 4) {
          const radius = familyCount === 1 ? 0 : familyCount === 2 ? 24 : 32;
          const angle = (index / familyCount) * Math.PI * 2 - Math.PI / 2;
          centerX = Math.cos(angle) * radius;
          centerZ = Math.sin(angle) * radius;
        } else {
          const row = Math.floor(index / familyCols);
          const col = index % familyCols;
          const totalRows = Math.ceil(familyCount / familyCols);
          centerX = (col - (familyCols - 1) / 2) * familyDistrictSpacing;
          centerZ = (row - (totalRows - 1) / 2) * familyDistrictSpacing;
        }

        const districtSize = Math.max(48, 36 + family.members.length * 8);
        this.createDistrict(
          `Family: ${family.root}`,
          districtSize,
          districtSize,
          centerX,
          centerZ,
        );

        const orientationAngle = (index * 137.5 * Math.PI) / 180;
        const familyPositions = this.calculateFamilyDistrictPositions(
          family,
          new THREE.Vector3(centerX, 0, centerZ),
          orientationAngle,
        );

        family.members.forEach((member) => {
          const classNode = this.classNodeMap.get(member.className);
          const position = familyPositions.get(member.className);
          if (classNode && position) {
            this.createBuilding(classNode, position);
            placedClasses.add(member.className);
          }
        });
      });

      // Organize code into districts (packages/namespaces)
      const remainingAst = {
        ...ast,
        children: (ast.children || []).filter((node) => {
          if (node.type === "function") return true;
          if (
            (node.type === "class" ||
              node.type === "abstractClass" ||
              node.type === "interface") &&
            node.name
          ) {
            return !placedClasses.has(node.name);
          }
          return false;
        }),
      };

      const districts = this.organizeIntoDistricts(remainingAst);

      // Calculate total buildings and arrange in a 2D grid (X and Z axes)
      let totalBuildings = 0;
      districts.forEach((district) => {
        totalBuildings += district.buildings.length;
      });

      const gridSize = 4;
      const buildingSpacing = 16;
      const cols = Math.ceil(Math.sqrt(totalBuildings));
      const rows = Math.ceil(totalBuildings / cols);

      const totalWidth = (cols - 1) * buildingSpacing;
      const totalDepth = (rows - 1) * buildingSpacing;
      const startX = -totalWidth / 2;
      const startZ = -totalDepth / 2;

      let buildingIndex = 0;

      districts.forEach((district) => {
        const districtStartIndex = buildingIndex;
        const districtEndIndex = buildingIndex + district.buildings.length;

        let minRow = Math.floor(districtStartIndex / cols);
        let maxRow = Math.floor((districtEndIndex - 1) / cols);
        let minCol = districtStartIndex % cols;
        let maxCol = (districtEndIndex - 1) % cols;

        if (maxRow > minRow) {
          minCol = 0;
          maxCol = cols - 1;
        }

        const districtWidth =
          (maxCol - minCol + 1) * buildingSpacing + buildingSpacing;
        const districtDepth =
          (maxRow - minRow + 1) * buildingSpacing + buildingSpacing;
        const districtCenterX =
          startX + ((minCol + maxCol) * buildingSpacing) / 2;
        const districtCenterZ =
          startZ + ((minRow + maxRow) * buildingSpacing) / 2;

        this.createDistrict(
          district.name,
          districtWidth,
          districtDepth,
          districtCenterX,
          districtCenterZ,
        );

        district.buildings.forEach((buildingNode) => {
          const row = Math.floor(buildingIndex / cols);
          const col = buildingIndex % cols;

          const x = startX + col * buildingSpacing;
          const z = startZ + row * buildingSpacing;

          const gridAlignedX = Math.round(x / gridSize) * gridSize;
          const gridAlignedZ = Math.round(z / gridSize) * gridSize;

          if (
            buildingNode.type === "class" ||
            buildingNode.type === "abstractClass" ||
            buildingNode.type === "interface"
          ) {
            this.createBuilding(
              buildingNode,
              new THREE.Vector3(gridAlignedX, 0, gridAlignedZ),
            );
          } else if (buildingNode.type === "function") {
            this.createFunctionBuilding(
              buildingNode,
              new THREE.Vector3(gridAlignedX, 0, gridAlignedZ),
            );
          }

          buildingIndex++;
        });
      });
    }

    // Center the city on canvas (both X and Z axes) and align to grid
    const boundingBox = new THREE.Box3().setFromObject(this.cityGroup);
    const centerX = (boundingBox.min.x + boundingBox.max.x) / 2;
    const centerZ = (boundingBox.min.z + boundingBox.max.z) / 2;

    // Target: center around X = 0 and Z = 0 to balance the canvas
    const gridSizeSnap = 4;
    if (Math.abs(centerX) > 0.5) {
      const gridAlignedShiftX =
        Math.round(centerX / gridSizeSnap) * gridSizeSnap;
      this.cityGroup.position.x -= gridAlignedShiftX;
    }

    if (Math.abs(centerZ) > 0.5) {
      const gridAlignedShiftZ =
        Math.round(centerZ / gridSizeSnap) * gridSizeSnap;
      this.cityGroup.position.z -= gridAlignedShiftZ;
    }

    // Add dependency streets/roads
    this.createDependencyStreets(ast);

    // Add inheritance connections
    this.createInheritanceConnections(ast);

    // Add composition connections
    this.createCompositionConnections(ast);

    // Add object instantiation connections
    this.createInstantiationConnections(ast);

    // Add polymorphism connections (method-level relationships)
    this.createPolymorphismConnections(ast);

    return this.cityGroup;
  }

  createCompactUngroupedLayout(ast) {
    const nodes = (ast.children || []).filter(
      (node) =>
        node.type === "class" ||
        node.type === "abstractClass" ||
        node.type === "interface" ||
        node.type === "function",
    );

    if (nodes.length === 0) return;

    const gridSize = 4;
    const buildingSpacing = 12;
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const rows = Math.ceil(nodes.length / cols);

    const totalWidth = (cols - 1) * buildingSpacing;
    const totalDepth = (rows - 1) * buildingSpacing;
    const startX = -totalWidth / 2;
    const startZ = -totalDepth / 2;

    nodes.forEach((node, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = startX + col * buildingSpacing;
      const z = startZ + row * buildingSpacing;

      const gridAlignedX = Math.round(x / gridSize) * gridSize;
      const gridAlignedZ = Math.round(z / gridSize) * gridSize;
      const pos = new THREE.Vector3(gridAlignedX, 0, gridAlignedZ);

      if (
        node.type === "class" ||
        node.type === "abstractClass" ||
        node.type === "interface"
      ) {
        this.createBuilding(node, pos);
      } else if (node.type === "function") {
        this.createFunctionBuilding(node, pos);
      }
    });
  }

  estimateGridSize(totalClasses) {
    const classCount = Math.max(1, totalClasses || 1);
    const base = 55;
    const growth = Math.sqrt(classCount) * 16;
    return Math.max(60, Math.min(180, Math.round(base + growth)));
  }

  createCompositionConnections(ast) {
    const buildings = [];
    this.cityGroup.children.forEach(child => {
      if (child.userData?.node && ['class','abstractClass'].includes(child.userData.node.type)) {
        buildings.push(child);
      }
    });
    buildings.forEach(building => {
      const classNode = building.userData.node;
      if (!classNode.compositions?.length) return;
      const bw = building.userData._width || 5;
      const bh = building.userData._totalHeight || 10;
      classNode.compositions.forEach((comp, idx) => {
        const tgt = typeof comp === 'string' ? comp : comp.target || 'Part';
        const targetNode = this.classNodeMap.get(tgt);
        const tMethods = targetNode?.children?.filter(c=>c.type==='method').length || 2;
        const aw = Math.max(1.8, Math.min(2.8, 1.2 + tMethods * 0.25));
        const ah = Math.max(2.5, Math.min(bh * 0.55, 2 + tMethods * 0.7));
        const ad = Math.max(1.8, Math.min(2.8, 1.2 + tMethods * 0.25));
        const side = idx % 2 === 0 ? 1 : -1;
        const annexX = building.position.x + side * (bw / 2 + aw / 2 + 0.4);
        const annexZ = building.position.z + (Math.floor(idx / 2) * 2.8);
        const annexColor = 0x1a6fbf;
        const annexMesh = new THREE.Mesh(
          new THREE.BoxGeometry(aw, ah, ad),
          new THREE.MeshPhongMaterial({ color: annexColor, emissive: annexColor, emissiveIntensity: 0.12, shininess: 40, transparent: false, opacity: 1.0 })
        );
        annexMesh.position.set(annexX, ah / 2, annexZ);
        annexMesh.castShadow = true;
        annexMesh.userData.compositionModule = true;
        annexMesh.userData.compositionAnnex = true;
        annexMesh.userData.sourceClass = classNode.name;
        annexMesh.userData.targetClass = tgt;
        annexMesh.userData.ownerClassName = classNode.name;
        annexMesh.userData.node = classNode;
        this.cityGroup.add(annexMesh);
        const walkLen = Math.max(0.3, Math.abs(annexX - building.position.x) - bw / 2 - aw / 2);
        const walkX = building.position.x + side * (bw / 2 + walkLen / 2);
        const walkMesh = new THREE.Mesh(
          new THREE.BoxGeometry(walkLen, 0.22, 0.9),
          new THREE.MeshPhongMaterial({ color: 0x2563a8, emissive: 0x2563a8, emissiveIntensity: 0.1 })
        );
        walkMesh.position.set(walkX, Math.min(ah, bh) * 0.3, annexZ);
        walkMesh.userData.compositionWalkway = true;
        walkMesh.userData.sourceClass = classNode.name;
        walkMesh.userData.targetClass = tgt;
        this.cityGroup.add(walkMesh);
        const badge = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.42),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.0 })
        );
        badge.position.set(annexX, ah + 0.75, annexZ);
        badge.userData.compositionModule = true;
        badge.userData.sourceClass = classNode.name;
        badge.userData.targetClass = tgt;
        badge.userData.node = classNode;
        badge.userData.ownerClassName = classNode.name;
        this.cityGroup.add(badge);
        const lbl = this.createLabel(tgt, 0x38bdf8);
        lbl.position.set(annexX, ah + 1.7, annexZ);
        lbl.scale.set(4, 1, 1);
        this.cityGroup.add(lbl);
      });
    });
  }

  createInstantiationConnections(ast) {
    // INSTANTIATION: glowing FACTORY CHIMNEYS on the roof.
    // Each class a building creates gets its own chimney with a glowing ring + smoke puffs.
    const buildings = [];
    this.cityGroup.traverse(child => {
      if (child.userData?.isBuilding && child.userData.node) buildings.push(child);
    });

    buildings.forEach(building => {
      const classNode = building.userData.node;
      const bw = building.userData._width  || 5;
      const bh = building.userData._totalHeight || 10;
      const bd = building.userData._depth  || 5;

      const instantiated = new Map();
      (classNode.children || []).forEach(method => {
        (method.instantiates || []).forEach(cls => {
          if (cls !== classNode.name) instantiated.set(cls, (instantiated.get(cls)||0)+1);
        });
      });
      if (!instantiated.size) return;

      const entries = Array.from(instantiated.entries());
      entries.forEach(([targetName, count], idx) => {
        const total  = entries.length;
        const spread = Math.min(bw * 0.7, total * 1.8);
        const offset = total === 1 ? 0 : (idx/(total-1)-0.5)*spread;
        const chimH  = 8.0 + idx * 0.6;
        const cx = building.position.x + offset;
        const cy = building.position.y + bh; // world Y of roof
        const cz = building.position.z;

        const chimMat = new THREE.MeshPhongMaterial({
          color: 0xaa3300, emissive: 0xff4400, emissiveIntensity: 1.0, shininess: 50
        });
        const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, chimH, 10), chimMat);
        chimney.position.set(cx, cy + chimH/2, cz);
        chimney.userData.instantiationChimney = true;
        chimney.userData.sourceClass   = classNode.name;
        chimney.userData.targetClass   = targetName;
        chimney.userData.node          = classNode;
        chimney.userData.ownerClassName = classNode.name;
        this.cityGroup.add(chimney);

        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.1, 0.22, 8, 20),
          new THREE.MeshBasicMaterial({ color: 0xff6600, emissive: 0xff8800, emissiveIntensity: 4.0 })
        );
        ring.position.set(cx, cy + chimH + 0.1, cz);
        ring.rotation.x = Math.PI/2;
        ring.userData.instantiationChimney = true;
        ring.userData.sourceClass   = classNode.name;
        ring.userData.targetClass   = targetName;
        ring.userData.node          = classNode;
        ring.userData.ownerClassName = classNode.name;
        this.cityGroup.add(ring);

        for (let s = 0; s < 3; s++) {
          const puff = new THREE.Mesh(
            new THREE.SphereGeometry(0.35 - s*0.08, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.5 - s*0.14 })
          );
          puff.position.set(cx + (s-1)*0.6, cy + chimH + 1.2 + s*1.8, cz);
          puff.userData.instantiationPuff = true;
          this.cityGroup.add(puff);
        }

        const lbl = this.createLabel('new '+targetName+'()', 0xff6600);
        lbl.position.set(cx, cy + chimH + 9.0, cz);
        lbl.scale.set(7, 1.3, 1);
        this.cityGroup.add(lbl);
      });
    });
  }


  getAccessModifierColor(access) {
    const colors = {
      public: 0x00ff00, // Green - Public
      protected: 0xffff00, // Yellow - Protected
      private: 0xff0000, // Red - Private
      internal: 0x00ffff, // Cyan - Internal
    };
    return colors[access] || 0xffffff;
  }

  organizeIntoDistricts(ast) {
    // Group code elements into districts (packages/namespaces/files)
    // Priority order:
    // 1. Namespace (for C#) - most logical grouping
    // 2. File name (if multiple files uploaded)
    // 3. Common name prefixes (e.g., "User", "UserManager" -> "User" district)
    // 4. Single "Main" district if no clear grouping

    const districts = new Map();

    ast.children.forEach((node) => {
      if (
        node.type === "class" ||
        node.type === "function" ||
        node.type === "abstractClass" ||
        node.type === "interface"
      ) {
        let districtName = "Main";

        // Priority 1: Use namespace if available (C#)
        if (node.namespace) {
          // Use namespace as district name
          districtName = node.namespace;
        }
        // Priority 2: Use file name if multiple files (and no namespace)
        else if (
          node.fileName &&
          ast.children.some((n) => n.fileName && n.fileName !== node.fileName)
        ) {
          // Multiple files detected - use file name as district
          const fileName = node.fileName.replace(/\.[^.]+$/, ""); // Remove extension
          districtName = fileName;
        }
        // Priority 3: Use name prefix (fallback)
        else if (node.name) {
          // Extract prefix from camelCase (e.g., "UserManager" -> "User")
          const camelMatch = node.name.match(/^([A-Z][a-z]+)/);
          if (camelMatch) {
            districtName = camelMatch[1];
          } else {
            // Extract prefix from underscore naming (e.g., "user_service" -> "user")
            const underscoreMatch = node.name.match(/^([a-z]+)_/);
            if (underscoreMatch) {
              districtName =
                underscoreMatch[1].charAt(0).toUpperCase() +
                underscoreMatch[1].slice(1);
            } else {
              // Use first letter as district
              districtName = node.name.charAt(0).toUpperCase() + " Classes";
            }
          }
        }

        if (!districts.has(districtName)) {
          districts.set(districtName, {
            name: districtName,
            buildings: [],
          });
        }

        districts.get(districtName).buildings.push(node);
      }
    });

    // If we have too many small districts, merge some
    const districtArray = Array.from(districts.values());
    if (districtArray.length > 5) {
      // Merge smaller districts into "Other"
      const sorted = districtArray.sort(
        (a, b) => b.buildings.length - a.buildings.length,
      );
      const mainDistricts = sorted.slice(0, 4);
      const otherBuildings = sorted.slice(4).flatMap((d) => d.buildings);

      if (otherBuildings.length > 0) {
        mainDistricts.push({
          name: "Other",
          buildings: otherBuildings,
        });
      }

      return mainDistricts;
    }

    return districtArray;
  }

  createDistrict(name, width, depth, centerX, centerZ) {
    // Create district boundary/area for 2D grid layout
    const districtGroup = new THREE.Group();

    // District boundary (road around district)
    const roadWidth = 0.8;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    // Create roads around district
    const roadMaterial = new THREE.MeshPhongMaterial({
      color: 0x444444,
      emissive: 0x222222,
      emissiveIntensity: 0.2,
    });

    // Top road (front)
    const topRoad = new THREE.Mesh(
      new THREE.BoxGeometry(width + roadWidth * 2, 0.1, roadWidth),
      roadMaterial,
    );
    topRoad.position.set(centerX, 0.05, centerZ + halfDepth + roadWidth / 2);
    districtGroup.add(topRoad);

    // Bottom road (back)
    const bottomRoad = new THREE.Mesh(
      new THREE.BoxGeometry(width + roadWidth * 2, 0.1, roadWidth),
      roadMaterial,
    );
    bottomRoad.position.set(centerX, 0.05, centerZ - halfDepth - roadWidth / 2);
    districtGroup.add(bottomRoad);

    // Left road
    const leftRoad = new THREE.Mesh(
      new THREE.BoxGeometry(roadWidth, 0.1, depth),
      roadMaterial,
    );
    leftRoad.position.set(centerX - halfWidth - roadWidth / 2, 0.05, centerZ);
    districtGroup.add(leftRoad);

    // Right road
    const rightRoad = new THREE.Mesh(
      new THREE.BoxGeometry(roadWidth, 0.1, depth),
      roadMaterial,
    );
    rightRoad.position.set(centerX + halfWidth + roadWidth / 2, 0.05, centerZ);
    districtGroup.add(rightRoad);

    // District label (positioned above)
    const label = this.createLabel(name, 0x888888);
    label.position.set(centerX, 3, centerZ + halfDepth + 1);
    label.scale.set(3, 0.8, 1);
    districtGroup.add(label);

    this.cityGroup.add(districtGroup);
  }

  createDependencyStreets(ast) {
    // Create streets/roads showing dependencies between classes
    const buildings = [];
    const nodeToBuilding = new Map();

    // Collect all buildings and their positions
    this.cityGroup.children.forEach((child) => {
      if (
        child.userData &&
        child.userData.node &&
        (child.userData.node.type === "class" ||
          child.userData.node.type === "function")
      ) {
        const node = child.userData.node;
        const buildingInfo = {
          mesh: child,
          node: node,
          position: child.position.clone(),
        };
        buildings.push(buildingInfo);
        nodeToBuilding.set(node.name, buildingInfo);
      }
    });

    // Find dependencies (classes that use other classes)
    const dependencies = new Set();

    buildings.forEach((building) => {
      const node = building.node;

      // Check for dependencies in methods
      if (node.children) {
        node.children.forEach((method) => {
          if (method.children) {
            method.children.forEach((child) => {
              // Check if control structure references another class
              // This is simplified - in a full implementation, would parse method bodies
            });
          }
        });
      }

      // Check inheritance relationships (these are dependencies)
      if (node.inherits && node.inherits.length > 0) {
        node.inherits.forEach((parentName) => {
          const parentBuilding = nodeToBuilding.get(parentName);
          if (parentBuilding && parentBuilding !== building) {
            const key = `${parentName}->${node.name}`;
            if (!dependencies.has(key)) {
              dependencies.add(key);
              this.createStreet(
                parentBuilding.position,
                building.position,
                "inheritance",
              );
            }
          }
        });
      }
    });

    // Create streets connecting buildings in 2D grid (both X and Z axes)
    if (buildings.length > 1) {
      // Sort buildings by position (Z first, then X)
      buildings.sort((a, b) => {
        if (Math.abs(a.position.z - b.position.z) < 1) {
          return a.position.x - b.position.x;
        }
        return a.position.z - b.position.z;
      });

      // Connect adjacent buildings in grid with streets
      for (let i = 0; i < buildings.length - 1; i++) {
        const from = buildings[i];
        const to = buildings[i + 1];

        // Check if buildings are adjacent (same row or same column)
        const deltaX = Math.abs(to.position.x - from.position.x);
        const deltaZ = Math.abs(to.position.z - from.position.z);
        const distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);

        // Connect if adjacent (within spacing + tolerance for 25 unit spacing)
        if (distance < 30) {
          this.createStreet(from.position, to.position, "district");
        }
      }
    }
  }

  getDistrictForBuilding(node) {
    // Determine which district a building belongs to (same logic as organizeIntoDistricts)
    if (node.name) {
      const camelMatch = node.name.match(/^([A-Z][a-z]+)/);
      if (camelMatch) {
        return camelMatch[1];
      }
      const underscoreMatch = node.name.match(/^([a-z]+)_/);
      if (underscoreMatch) {
        return (
          underscoreMatch[1].charAt(0).toUpperCase() +
          underscoreMatch[1].slice(1)
        );
      }
      return node.name.charAt(0).toUpperCase() + " Classes";
    }
    return "Main";
  }

  createStreet(from, to, type = "district") {
    // Create a street/road between two points
    // Types: 'inheritance' (green), 'district' (gray), 'main' (wider, darker)
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = direction.length();
    direction.normalize();

    // Different street widths based on type
    let streetWidth, streetColor, markingColor;
    if (type === "inheritance") {
      streetWidth = 0.3;
      streetColor = 0x00ff00; // Green for inheritance
      markingColor = 0x00cc00;
    } else if (type === "main") {
      streetWidth = 1.0; // Wider main roads
      streetColor = 0x333333; // Darker for main roads
      markingColor = 0xffff00;
    } else {
      streetWidth = 0.5; // Standard district streets
      streetColor = 0x555555;
      markingColor = 0xffff00;
    }

    const streetGeometry = new THREE.BoxGeometry(streetWidth, 0.05, length);
    const streetMaterial = new THREE.MeshPhongMaterial({
      color: streetColor,
      emissive: streetColor,
      emissiveIntensity: type === "inheritance" ? 0.5 : 0.3,
    });
    const street = new THREE.Mesh(streetGeometry, streetMaterial);

    // Position street between buildings
    const midPoint = new THREE.Vector3()
      .addVectors(from, to)
      .multiplyScalar(0.5);
    street.position.copy(midPoint);
    street.position.y = 0.05;

    // Rotate to align with direction
    street.lookAt(to);
    street.rotateX(Math.PI / 2);

    this.cityGroup.add(street);

    // Add street markings (yellow/white lines)
    const markingGeometry = new THREE.BoxGeometry(
      streetWidth * 0.3,
      0.02,
      length * 0.1,
    );
    const markingMaterial = new THREE.MeshBasicMaterial({
      color: markingColor,
      emissive: markingColor,
      emissiveIntensity: 0.5,
    });

    // Add multiple markings along the street
    const numMarkings = type === "main" ? 8 : 5;
    for (let i = 0; i < numMarkings; i++) {
      const marking = new THREE.Mesh(markingGeometry, markingMaterial);
      const t = (i + 1) / (numMarkings + 1);
      marking.position.copy(from.clone().lerp(to, t));
      marking.position.y = 0.08;
      marking.lookAt(to);
      marking.rotateX(Math.PI / 2);
      this.cityGroup.add(marking);
    }
  }

  createBuilding(classNode, position) {
    const buildingGroup = new THREE.Group();
    buildingGroup.position.copy(position);
    buildingGroup.userData.isBuilding = true;
    buildingGroup.userData.node = classNode;
    buildingGroup.userData._width = null; // set after calculation
    buildingGroup.userData._depth = null;
    buildingGroup.userData._totalHeight = null;

    const familyMeta = this.classFamilyMeta.get(classNode.name) || null;
    const familyStyle = this.getFamilyStyle(familyMeta);

    // Calculate building dimensions based on metrics
    const numMethods = classNode.children
      ? classNode.children.filter((c) => c.type === "method").length
      : 0;
    const numAttributes = classNode.members
      ? classNode.members.filter(
          (m) => m.type === "property" || m.type === "attribute",
        ).length
      : 0;
    const complexity = classNode.complexity || 1;
    const lineCount = classNode.lineCount || 1;

    // Building dimensions based on metrics:
    // Height = Complexity + Number of Methods (NOM) + Line Count
    // Width/Depth = Number of Attributes + base size
    const numFloors = numMethods > 0 ? numMethods : 1;
    const baseWidth = 4;
    const baseDepth = 4;
    const width = baseWidth + Math.min(numAttributes * 0.5, 4); // Width based on attributes (max +4)
    const depth = baseDepth + Math.min(numAttributes * 0.5, 4); // Depth based on attributes
    const floorHeight = 3.5; // Base floor height (increased for better visibility)
    const complexityHeight = complexity * 0.3; // Additional height for complexity
    const lineCountHeight = Math.min(lineCount / 10, 5); // Height based on LOC (max +5)
    const totalFloorHeight = floorHeight + complexityHeight + lineCountHeight;
    const baseHeight = 1.5;
    const separatorHeight = 0.5; // Increased separator height for better floor distinction
    const totalHeight =
      baseHeight +
      numFloors * totalFloorHeight +
      (numFloors - 1) * separatorHeight;
    // Store dimensions for composition annex sizing
    buildingGroup.userData._width = width;
    buildingGroup.userData._depth = depth;
    buildingGroup.userData._totalHeight = totalHeight;

    // Base floor - family style first, then type-specific fallback.
    let baseColor = familyStyle
      ? familyStyle.primaryColor
          .clone()
          .offsetHSL(0, 0, Math.min(0.12, (familyMeta?.depth || 0) * 0.03))
          .getHex()
      : this.colorScheme.class;
    let baseOpacity = 1.0;

    if (classNode.type === "abstractClass") {
      baseColor = 0x8b5cf6; // Purple for abstract
      baseOpacity = 1.0;
    } else if (classNode.type === "interface") {
      baseColor = 0x06b6d4; // Cyan for interface
      baseOpacity = 1.0;
    }

    const baseGeometry = new THREE.BoxGeometry(width, baseHeight, depth);
    const baseMaterial = new THREE.MeshPhongMaterial({
      color: baseColor,
      emissive: baseColor,
      emissiveIntensity: 0.15,
      shininess: 60,
      transparent: false,
      opacity: 1.0,
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = baseHeight / 2;
    base.userData.node = classNode; // Enable click-to-code for base
    buildingGroup.add(base);

    // Shared family DNA architecture details.
    if (familyStyle) {
      this.addFamilyRoof(
        buildingGroup,
        width,
        depth,
        totalHeight,
        familyStyle,
        familyMeta?.depth || 0,
      );

      const stripeMaterial = new THREE.MeshBasicMaterial({
        color: familyStyle.stripeColor,
        transparent: false,
        opacity: 1.0,
      });
      for (let i = 0; i < 3; i++) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(width * 1.01, 0.18, depth * 1.01),
          stripeMaterial,
        );
        stripe.position.y = baseHeight + ((i + 1) * totalHeight) / 4;
        stripe.userData.inheritanceFamilyStripe = true;
        buildingGroup.add(stripe);
      }
    }

    // Floors (methods and control structures)
    if (classNode.children && classNode.children.length > 0) {
      let currentY = baseHeight;
      let floorCount = 0;

      for (const child of classNode.children) {
        if (child.type === "method") {
          floorCount++;

          // Log constructor detection for debugging
          if (child.isConstructor) {
            console.log(
              `🔨 Constructor found: ${child.name}, isConstructor=${child.isConstructor}`,
            );
          }

          // Use calculated floor height based on method complexity
          const methodComplexity = child.complexity || 1;
          const methodLineCount = child.lineCount || 1;
          // Ensure minimum floor height for visibility
          const methodFloorHeight = Math.max(
            totalFloorHeight +
              methodComplexity * 0.2 +
              Math.min(methodLineCount / 20, 2),
            3.0, // Minimum floor height
          );

          const floor = this.createFloor(
            child,
            width,
            depth,
            methodFloorHeight,
            currentY,
            classNode,
          );
          buildingGroup.add(floor);

          // Add control structures as decorations on floors
          if (child.children && child.children.length > 0) {
            this.addControlStructuresToFloor(
              floor,
              child.children,
              width,
              depth,
              currentY + methodFloorHeight / 2,
            );
          }

          // Move up for next floor (add separator height for clear separation)
          currentY += methodFloorHeight + separatorHeight;

          const methodType = child.isConstructor ? "CONSTRUCTOR" : "METHOD";
          console.log(
            `🏢 Floor ${floorCount} (${methodType}): ${child.name} at Y=${currentY.toFixed(2)}, height=${methodFloorHeight.toFixed(2)}, isConstructor=${child.isConstructor}`,
          );
        }
      }

      // If no methods, add at least one empty floor to show it's a class
      if (floorCount === 0) {
        const emptyFloor = this.createEmptyFloor(
          width,
          depth,
          floorHeight,
          baseHeight,
        );
        buildingGroup.add(emptyFloor);
      }
    } else {
      // No children - add empty floor
      const emptyFloor = this.createEmptyFloor(
        width,
        depth,
        floorHeight,
        baseHeight,
      );
      buildingGroup.add(emptyFloor);
    }

    // Add class members as small structures around building
    if (classNode.members && classNode.members.length > 0) {
      this.addMembersAroundBuilding(
        buildingGroup,
        classNode.members,
        width,
        depth,
      );
    }

    // Composition as physical part-of structure: docked side modules.
    if (classNode.compositions && classNode.compositions.length > 0) {
      this.addCompositionAttachments(
        buildingGroup,
        classNode,
        width,
        depth,
        baseHeight,
      );
    }

    // Building label with inheritance, generics, namespace/file, and OOP info
    let labelText = classNode.name || "Class";

    // Add generics/templates to label (safely)
    if (
      classNode.generics &&
      Array.isArray(classNode.generics) &&
      classNode.generics.length > 0
    ) {
      labelText += `<${classNode.generics.join(", ")}>`;
    }

    if (classNode.type === "abstractClass") {
      labelText = `🔷 ${labelText}`; // Diamond for abstract
    } else if (classNode.type === "interface") {
      labelText = `◊ ${labelText}`; // Diamond symbol for interface
    }

    // Add nested class indicator (safely)
    if (classNode.isNested === true) {
      labelText = `📦 ${labelText}`;
    }

    // Add namespace/file info (for multi-file codebases)
    if (classNode.namespace) {
      labelText += `\n[${classNode.namespace}]`;
    } else if (classNode.fileName) {
      // Show file name if no namespace (for multi-file projects)
      const fileName = classNode.fileName.replace(/\.[^.]+$/, "");
      labelText += `\n[${fileName}]`;
    }

    if (
      classNode.inherits &&
      Array.isArray(classNode.inherits) &&
      classNode.inherits.length > 0
    ) {
      labelText += ` (extends ${classNode.inherits.join(", ")})`;
    }
    const labelColor =
      classNode.type === "abstractClass"
        ? 0xff8c94
        : classNode.type === "interface"
          ? 0xffb347
          : this.colorScheme.class;
    const label = this.createLabel(labelText, labelColor);
    // Position class label much higher - well above any indicators
    label.position.set(0, totalHeight + 7, 0);
    label.scale.set(8, 2, 1); // Slightly smaller for cleaner look
    buildingGroup.add(label);

    // Store node data
    buildingGroup.userData.node = classNode;

    this.cityGroup.add(buildingGroup);
    return buildingGroup;
  }

  addCompositionAttachments(buildingGroup, classNode, width, depth, baseHeight) {
    const compositions = Array.isArray(classNode.compositions)
      ? classNode.compositions
      : [];
    if (compositions.length === 0) return;

    const moduleColor = 0x0088ff;
    const sideSign = compositions.length % 2 === 0 ? 1 : -1;
    const sideX = sideSign * (width / 2 + 0.95);
    const startZ = -((compositions.length - 1) * 1.6) / 2;

    compositions.forEach((comp, index) => {
      const targetClass = typeof comp === "string" ? comp : comp.target || "Part";
      const moduleWidth = 1.4;
      const moduleDepth = 1.4;
      const moduleHeight = 1.25;
      const moduleY = baseHeight + moduleHeight / 2;
      const moduleZ = startZ + index * 1.6;

      const module = new THREE.Mesh(
        new THREE.BoxGeometry(moduleWidth, moduleHeight, moduleDepth),
        new THREE.MeshPhongMaterial({
          color: moduleColor,
          emissive: moduleColor,
          emissiveIntensity: 0.3,
          transparent: false,
          opacity: 1.0,
          shininess: 60,
        }),
      );
      module.position.set(sideX, moduleY, moduleZ);
      module.userData.node = classNode;
      module.userData.compositionModule = true;
      module.userData.oopConcept = "composition-module";
      module.userData.sourceClass = classNode.name;
      module.userData.targetClass = targetClass;
      module.userData.ownerClassName = classNode.name;
      buildingGroup.add(module);

      const dock = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.45, 0.45),
        new THREE.MeshBasicMaterial({
          color: moduleColor,
          emissive: moduleColor,
          emissiveIntensity: 1.1,
        }),
      );
      dock.position.set(sideSign * (width / 2 + 0.25), baseHeight + 0.25, moduleZ);
      dock.userData.node = classNode;
      dock.userData.compositionModule = true;
      dock.userData.sourceClass = classNode.name;
      dock.userData.targetClass = targetClass;
      buildingGroup.add(dock);

      const badge = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.23),
        new THREE.MeshBasicMaterial({
          color: 0x66ccff,
          emissive: 0x66ccff,
          emissiveIntensity: 1.8,
          depthTest: false,
        }),
      );
      badge.position.set(sideX, moduleY + moduleHeight / 2 + 0.3, moduleZ);
      badge.userData.node = classNode;
      badge.userData.compositionModule = true;
      badge.userData.compositionOwnershipBadge = true;
      badge.userData.sourceClass = classNode.name;
      badge.userData.targetClass = targetClass;
      buildingGroup.add(badge);
    });
  }

  addControlStructuresToFloor(
    floorGroup,
    controlStructures,
    width,
    depth,
    yPosition,
  ) {
    if (!controlStructures || controlStructures.length === 0) return;

    // Keep structures well within floor boundaries (use 80% of width/depth)
    const usableWidth = width * 0.8;
    const usableDepth = depth * 0.8;
    const margin = width * 0.1; // 10% margin on each side

    const spacing = usableWidth / (controlStructures.length + 1);
    let xOffset = -usableWidth / 2 + spacing;

    controlStructures.forEach((struct) => {
      const structColor = this.getControlStructureColor(struct.type);
      const structSize = 0.35; // Smaller to fit better within floor

      // Create small indicator for control structure on the floor
      const geometry = new THREE.BoxGeometry(
        structSize,
        structSize * 0.6,
        structSize,
      );
      const material = new THREE.MeshPhongMaterial({
        color: structColor,
        emissive: structColor,
        emissiveIntensity: 1.0, // Maximum brightness for visibility
        shininess: 100,
      });
      const mesh = new THREE.Mesh(geometry, material);

      // Position well within floor boundaries - on top surface, centered
      // Use usableDepth/2 - 0.1 to keep it away from edge
      mesh.position.set(
        xOffset,
        yPosition + structSize * 0.3,
        usableDepth / 2 - 0.15,
      );
      floorGroup.add(mesh);

      // Add label for control structure
      const structLabel = this.createLabel(
        struct.type.toUpperCase(),
        structColor,
      );
      structLabel.position.set(
        xOffset,
        yPosition + structSize + 0.5,
        usableDepth / 2 - 0.15,
      );
      structLabel.scale.set(2, 0.6, 1);
      floorGroup.add(structLabel);

      xOffset += spacing;
    });
  }

  getControlStructureColor(type) {
    // Use bright, highly visible colors that contrast with yellow floors
    const colors = {
      if: 0xff00ff, // Bright Magenta (high contrast with yellow)
      elif: 0xff00ff, // Bright Magenta
      else: 0xff1493, // Deep Pink (very visible)
      for: 0x00ffff, // Bright Cyan (high contrast)
      while: 0x9400d3, // Bright Violet (high contrast)
      try: 0xff4500, // Bright Orange-Red (very visible)
      except: 0xff0000, // Bright Red (maximum visibility)
      catch: 0xff0000, // Bright Red
    };
    return colors[type] || 0xffffff;
  }

  addMembersAroundBuilding(buildingGroup, members, width, depth) {
    // Position members on the base, within building footprint or just outside edge
    // Use a smaller radius to keep them closer to the building
    const baseRadius = Math.max(width, depth) / 2 + 0.5; // Closer to building
    const angleStep = (Math.PI * 2) / members.length;

    members.forEach((member, index) => {
      const angle = index * angleStep;
      const x = Math.cos(angle) * baseRadius;
      const z = Math.sin(angle) * baseRadius;

      // Smaller sizes to fit better
      const memberSize = member.type === "constant" ? 0.5 : 0.6;
      const memberColor = this.getMemberColor(member.type);

      const geometry = new THREE.BoxGeometry(
        memberSize,
        memberSize,
        memberSize,
      );
      const material = new THREE.MeshPhongMaterial({
        color: memberColor,
        emissive: memberColor,
        emissiveIntensity: 0.8, // Brighter for visibility
        shininess: 100,
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Position on top of base (baseHeight / 2 + small offset)
      mesh.position.set(x, 1.0, z); // On base level, not floating
      mesh.userData.node = member;
      buildingGroup.add(mesh);

      // Always add label for members - make them visible
      const memberLabelText = `${member.name}`; // Simpler label - just name
      const label = this.createLabel(memberLabelText, memberColor);
      label.position.copy(mesh.position);
      label.position.y += memberSize / 2 + 2.0; // Much higher above cube
      label.scale.set(1.8, 0.5, 1); // Smaller labels
      buildingGroup.add(label);
    });
  }

  getMemberColor(type) {
    // Use bright, highly visible colors
    const colors = {
      property: 0x00ff88, // Bright Green (high contrast)
      attribute: 0x00ff88, // Bright Green
      constant: 0xff6600, // Bright Orange (very visible)
      static: 0x9932cc, // Bright Purple (high contrast)
    };
    return colors[type] || 0xffffff;
  }

  createFloor(methodNode, width, depth, height, yPosition, ownerClassNode = null) {
    const floorGroup = new THREE.Group();

    const inheritanceInfo = ownerClassNode
      ? this.classifyMethodByInheritance(ownerClassNode, methodNode)
      : { markerType: "child", parentName: null, parentHasMethod: false };

    // Debug logging
    console.log(`📐 Creating floor for ${methodNode.name}:`, {
      width,
      depth,
      height,
      access: methodNode.access,
      isVirtual: methodNode.isVirtual,
      overrides: methodNode.overrides,
      isConstructor: methodNode.isConstructor,
    });

    // Main floor (method) - Color based on access modifier
    // Floor colour = access level (clear distinct colours students can read at a glance)
    let floorColor;
    if (methodNode.isAbstract) {
      floorColor = 0x4338ca; // Deep indigo = abstract (ghost floor, no body)
    } else if (methodNode.access === "private") {
      floorColor = 0x374151; // Dark slate = private (locked, hidden)
    } else if (methodNode.access === "protected") {
      floorColor = 0xb45309; // Amber = protected (semi-open, family only)
    } else {
      floorColor = 0xe5c000; // Warm yellow = public (bright, open, welcoming)
    }

    const floorGeometry = new THREE.BoxGeometry(
      width * 0.95,
      height,
      depth * 0.95,
    );
    const floorMaterial = new THREE.MeshPhongMaterial({
      color: floorColor,
      emissive: floorColor,
      emissiveIntensity: 0.35,
      transparent: false, opacity: 1.0, shininess: 60,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = yPosition + height / 2;
    floor.castShadow = true;
    floor.receiveShadow = true;
    floor.userData.node = methodNode; // Enable click-to-code for floor mesh
    floor.userData.isMainFloorMesh = true; // Mark as the main floor mesh for positioning
    floor.userData.floorHeight = height; // Store the floor height
    floor.userData.markerType = inheritanceInfo.markerType;
    floor.userData.ownerClassName = ownerClassNode?.name || null;
    floor.userData.parentClassName = inheritanceInfo.parentName || null;
    floorGroup.add(floor);

    // Inheritance marker strip/icon on method floors:
    // - Blue: inherited marker semantics (from parent signature)
    // - Orange: overridden marker
    // - Child-defined: no marker
    if (inheritanceInfo.markerType === "override") {
      const markerStrip = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.9, 0.18, 0.2),
        new THREE.MeshBasicMaterial({
          color: 0xff8800,
          emissive: 0xff8800,
          emissiveIntensity: 1.6,
        }),
      );
      markerStrip.position.set(0, yPosition + height / 2 + 0.15, depth / 2 + 0.45);
      markerStrip.userData.inheritanceMethodMarker = true;
      markerStrip.userData.markerType = "override";
      markerStrip.userData.node = methodNode;
      markerStrip.userData.ownerClassName = ownerClassNode?.name || null;
      markerStrip.userData.parentClassName = inheritanceInfo.parentName || null;
      floorGroup.add(markerStrip);

      const markerIcon = new THREE.Mesh(
        new THREE.ConeGeometry(0.25, 0.55, 6),
        new THREE.MeshBasicMaterial({
          color: 0xff8800,
          emissive: 0xff8800,
          emissiveIntensity: 2.0,
          depthTest: false,
        }),
      );
      markerIcon.position.set(-width / 2 + 0.65, yPosition + height / 2 + 0.6, depth / 2 + 0.32);
      markerIcon.userData.inheritanceMethodMarker = true;
      markerIcon.userData.markerType = "override";
      markerIcon.userData.node = methodNode;
      markerIcon.userData.ownerClassName = ownerClassNode?.name || null;
      markerIcon.userData.parentClassName = inheritanceInfo.parentName || null;
      floorGroup.add(markerIcon);
    } else if (inheritanceInfo.markerType === "inherited") {
      const markerStrip = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.9, 0.16, 0.2),
        new THREE.MeshBasicMaterial({
          color: 0x00aaff,
          emissive: 0x00aaff,
          emissiveIntensity: 1.4,
        }),
      );
      markerStrip.position.set(0, yPosition + height / 2 + 0.15, depth / 2 + 0.45);
      markerStrip.userData.inheritanceMethodMarker = true;
      markerStrip.userData.markerType = "inherited";
      markerStrip.userData.node = methodNode;
      markerStrip.userData.ownerClassName = ownerClassNode?.name || null;
      markerStrip.userData.parentClassName = inheritanceInfo.parentName || null;
      floorGroup.add(markerStrip);

      const markerIcon = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.35, 0.35),
        new THREE.MeshBasicMaterial({
          color: 0x00aaff,
          emissive: 0x00aaff,
          emissiveIntensity: 2.0,
          depthTest: false,
        }),
      );
      markerIcon.position.set(-width / 2 + 0.65, yPosition + height / 2 + 0.6, depth / 2 + 0.32);
      markerIcon.userData.inheritanceMethodMarker = true;
      markerIcon.userData.markerType = "inherited";
      markerIcon.userData.node = methodNode;
      markerIcon.userData.ownerClassName = ownerClassNode?.name || null;
      markerIcon.userData.parentClassName = inheritanceInfo.parentName || null;
      floorGroup.add(markerIcon);
    }

    // Access marker style for encapsulation (line-free)
    if (methodNode.access) {
      console.log(
        `🔵 Creating access modifier: ${methodNode.access}, color:`,
        this.getAccessModifierColor(methodNode.access).toString(16),
      );
      const accessColor = this.getAccessModifierColor(methodNode.access);
      let accessGeometry;

      // Different shapes for different access levels - VISIBLE SIZE
      if (methodNode.access === "public") {
        accessGeometry = new THREE.SphereGeometry(1.0, 16, 16); // Green sphere
      } else if (methodNode.access === "protected") {
        accessGeometry = new THREE.TetrahedronGeometry(1.2); // Yellow pyramid
      } else if (methodNode.access === "private") {
        accessGeometry = new THREE.OctahedronGeometry(1.0); // Red octahedron
      } else {
        accessGeometry = new THREE.SphereGeometry(1.0, 16, 16); // Default sphere
      }

      const accessIndicator = new THREE.Mesh(
        accessGeometry,
        new THREE.MeshBasicMaterial({
          color: accessColor,
          emissive: accessColor,
          emissiveIntensity: 3.5, // Extremely bright
          transparent: false,
          opacity: 1.0,
          depthTest: false, // Render on top
        }),
      );
      // Position HIGH ABOVE the floor in the front-right corner for maximum visibility
      const xPos = width / 2 - 1.5;
      const yPos = yPosition + height / 2 + 2.5; // Much higher
      const zPos = depth / 2 - 1.5;
      accessIndicator.position.set(xPos, yPos, zPos);
      accessIndicator.renderOrder = 999; // Render last (on top)

      console.log(`   ✅ Access indicator positioned at:`, {
        x: xPos,
        y: yPos,
        z: zPos,
      });

      accessIndicator.userData.node = methodNode;
      accessIndicator.userData.oopConcept = "encapsulation";
      floorGroup.add(accessIndicator);

      console.log(
        `   ✅ Access indicator added to floorGroup. FloorGroup has ${floorGroup.children.length} children`,
      );
    }

    // Add polymorphism override indicator - simple marker
    if (methodNode.overrides) {
      // POLYMORPHISM OVERRIDE: large teal upward ARROW SIGN sticking up from floor edge.
      // Unmissable from across the city. Arrow points UP = this method overrides parent.
      const teal = new THREE.MeshBasicMaterial({ color: 0x00e5c8 });
      const tealBright = new THREE.MeshBasicMaterial({ color: 0x00ffd0, depthTest: false });

      // Vertical pole
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, height * 0.85, 8), teal);
      pole.position.set(-width/2 + 1.1, yPosition + height * 0.42, depth/2 + 0.4);
      pole.userData.node = methodNode;
      pole.userData.indicatorType = 'override';
      pole.userData.ownerClassName = ownerClassNode ? ownerClassNode.name : null;
      floorGroup.add(pole);

      // Arrowhead pointing up
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.5, 8), tealBright);
      arrow.position.set(-width/2 + 1.1, yPosition + height * 0.85 + 0.75, depth/2 + 0.4);
      arrow.renderOrder = 100;
      arrow.userData.node = methodNode;
      arrow.userData.indicatorType = 'override';
      arrow.userData.ownerClassName = ownerClassNode ? ownerClassNode.name : null;
      floorGroup.add(arrow);

      // Horizontal stripe across full floor face
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.95, 0.45, 0.22), teal);
      stripe.position.set(0, yPosition + height/2, depth/2 + 0.12);
      stripe.userData.node = methodNode;
      stripe.userData.indicatorType = 'override';
      stripe.userData.ownerClassName = ownerClassNode ? ownerClassNode.name : null;
      floorGroup.add(stripe);
    }

    // Add virtual method indicatorr - simple marker
    if (methodNode.isVirtual) {
      const virtualIndicator = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.0),
        new THREE.MeshBasicMaterial({
          color: 0xff8800,
          emissive: 0xff8800,
          emissiveIntensity: 3.0,
          depthTest: false,
        }),
      );
      virtualIndicator.position.set(
        -width / 2 + 1.5,
        yPosition + height / 2 + 1.5,
        depth / 2 - 1.0,
      );
      virtualIndicator.rotation.x = Math.PI / 4;
      virtualIndicator.rotation.z = Math.PI / 4;
      virtualIndicator.renderOrder = 1000;
      virtualIndicator.userData.node = methodNode;
      virtualIndicator.userData.oopConcept = "polymorphism-virtual";
      floorGroup.add(virtualIndicator);
    }

    // Add abstract method indicator
    if (methodNode.isAbstract && !methodNode.isConstructor) {
      console.log(`⬜ Creating ABSTRACT indicator (yellow frame)`);
      // Abstract - Hollow bright yellow frame
      const abstractFrame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.2, 1.2, 1.2)),
        new THREE.LineBasicMaterial({
          color: 0xffff00,
          linewidth: 3,
        }),
      );
      // Position on left edge, visible
      abstractFrame.position.set(
        -width / 2 + 1.0,
        yPosition + height / 2 + 1.0,
        depth / 2 - 1.0,
      );
      abstractFrame.userData.node = methodNode;
      abstractFrame.userData.oopConcept = "polymorphism-abstract";
      floorGroup.add(abstractFrame);
    }

    // Add constructor indicator - magenta cube
    if (methodNode.isConstructor === true || methodNode.isConstructor) {
      console.log(
        `🟪 Creating CONSTRUCTOR indicator (magenta cube) for: ${methodNode.name}`,
      );
      const constructorIndicator = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.9), // Visible magenta cube
        new THREE.MeshBasicMaterial({
          color: 0xff00ff,
          emissive: 0xff00ff,
          emissiveIntensity: 3.5, // Extremely bright magenta
          depthTest: false,
        }),
      );
      // Position in center front of floor, very visible
      constructorIndicator.position.set(
        0,
        yPosition + height / 2 + 2.5,
        depth / 2 + 0.5,
      );
      constructorIndicator.renderOrder = 999;
      constructorIndicator.userData.node = methodNode;
      constructorIndicator.userData.isConstructorIndicator = true;
      floorGroup.add(constructorIndicator);
      console.log(`   ✅ Constructor indicator added`);
    }

    // Add a bright outline/border around the floor for visibility
    const outlineGeometry = new THREE.BoxGeometry(
      width * 0.96,
      height + 0.1,
      depth * 0.96,
    );
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide
    });
    const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
    outline.position.y = yPosition + height / 2;
    outline.userData.isOutlineMesh = true;
    floorGroup.add(outline);

    // Add floor separator/edge on top (makes floors more visible)
    // Bright white/light separator line for clear separation
    const separatorHeight = 0.4; // Increased for better visibility
    const separatorGeometry = new THREE.BoxGeometry(
      width * 0.99,
      separatorHeight,
      depth * 0.99,
    );
    const separatorMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff, // Bright white separator line (stands out against dark base)
      emissive: 0xffffff,
      emissiveIntensity: 0.8, // Brighter separator
      shininess: 100,
    });
    const separator = new THREE.Mesh(separatorGeometry, separatorMaterial);
    separator.position.y = yPosition + height; // At the top edge of the floor
    separator.castShadow = true;
    separator.receiveShadow = true;
    floorGroup.add(separator);

    // Add a dark gap/space between floors for better distinction
    const gapGeometry = new THREE.BoxGeometry(
      width * 0.98,
      separatorHeight * 0.5,
      depth * 0.98,
    );
    const gapMaterial = new THREE.MeshPhongMaterial({
      color: 0x000000, // Black gap
      emissive: 0x000000,
      emissiveIntensity: 0.0,
    });
    const gap = new THREE.Mesh(gapGeometry, gapMaterial);
    gap.position.y = yPosition + height + separatorHeight * 0.75; // Just above separator
    floorGroup.add(gap);

    // Add bright edge highlight around floor
    const edgeGeometry = new THREE.EdgesGeometry(floorGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff, // White edges
      linewidth: 3,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.position.y = yPosition + height / 2;
    floorGroup.add(edges);

    // Add windows to make floors more distinct
    this.addWindows(floorGroup, width, depth, yPosition + height / 2, height);

    // Add floor label (method name) - visible on the side with OOP indicators
    let methodLabelText = methodNode.name || "Method";

    // Add generics/templates to label (safely)
    if (
      methodNode.generics &&
      Array.isArray(methodNode.generics) &&
      methodNode.generics.length > 0
    ) {
      methodLabelText += `<${methodNode.generics.join(", ")}>`;
    }

    if (methodNode.isAbstract === true) {
      methodLabelText = `🔷 ${methodLabelText}`;
    }
    if (methodNode.overrides) {
      methodLabelText = `↻ ${methodLabelText}`; // Override symbol
    }
    if (methodNode.isConstructor === true || methodNode.isConstructor) {
      methodLabelText = `⚙ ${methodLabelText}`; // Constructor symbol
      console.log(`🔨 Constructor label updated: ${methodLabelText}`);
    }

    // Add method overloading indicator (safely)
    if (
      methodNode.isOverloaded === true &&
      methodNode.overloadCount &&
      typeof methodNode.overloadCount === "number"
    ) {
      methodLabelText += ` [${methodNode.overloadCount}x]`;
    }

    const floorLabel = this.createLabel(methodLabelText, floorColor);
    // Position label WAY out in front - far beyond the building
    floorLabel.position.set(0, yPosition + height / 2 + 2.5, depth / 2 + 6.0);
    floorLabel.scale.set(3.5, 0.9, 1);
    floorGroup.add(floorLabel);

    // Add visual indicator for overloaded methods (small orange cubes) - safely
    if (
      methodNode.isOverloaded === true &&
      methodNode.overloadCount &&
      typeof methodNode.overloadCount === "number"
    ) {
      const overloadCount = Math.min(Math.max(methodNode.overloadCount, 1), 5);
      for (let i = 0; i < overloadCount; i++) {
        const overloadIndicator = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 0.15, 0.15),
          new THREE.MeshBasicMaterial({ color: 0xff8800, emissive: 0xff8800 }),
        );
        overloadIndicator.position.set(
          -width / 2 + 0.3 + i * 0.2,
          yPosition + height / 2,
          depth / 2 + 0.2,
        );
        floorGroup.add(overloadIndicator);
      }
    }

    // Store method data
    floorGroup.userData.node = methodNode;

    return floorGroup;
  }

  createEmptyFloor(width, depth, height, yPosition) {
    // Create a floor for classes with no methods
    const floorGroup = new THREE.Group();

    const floorGeometry = new THREE.BoxGeometry(
      width * 0.95,
      height,
      depth * 0.95,
    );
    const floorMaterial = new THREE.MeshPhongMaterial({
      color: 0x4a5568,
      emissive: 0x2d3748,
      emissiveIntensity: 0.1,
      transparent: false,
      opacity: 1.0,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = yPosition + height / 2;
    floorGroup.add(floor);

    return floorGroup;
  }

  createFunctionBuilding(funcNode, position) {
    const buildingGroup = new THREE.Group();
    buildingGroup.position.copy(position);
    buildingGroup.userData.isBuilding = true;
    buildingGroup.userData.node = funcNode;

    // Building dimensions based on metrics
    const complexity = funcNode.complexity || 1;
    const lineCount = funcNode.lineCount || 1;
    const numParams = funcNode.parameters ? funcNode.parameters.length : 0;

    // Width/Depth based on parameters
    const baseSize = 3;
    const width = baseSize + Math.min(numParams * 0.3, 2);
    const depth = baseSize + Math.min(numParams * 0.3, 2);
    // Height based on complexity and line count
    const height = 2 + complexity * 0.5 + Math.min(lineCount / 15, 4);

    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshPhongMaterial({
      color: this.colorScheme.function,
      emissive: this.colorScheme.function,
      emissiveIntensity: 0.3,
      shininess: 100,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height / 2;
    mesh.userData.node = funcNode; // Enable click-to-code
    buildingGroup.add(mesh);

    // Add windows
    this.addWindows(buildingGroup, width, depth, height / 2, height);

    // Label
    const label = this.createLabel(
      funcNode.name || "Function",
      this.colorScheme.function,
    );
    label.position.set(0, height + 0.5, 0);
    buildingGroup.add(label);

    buildingGroup.userData.node = funcNode;
    this.cityGroup.add(buildingGroup);
    return buildingGroup;
  }

  addWindows(group, width, depth, yPosition, height) {
    const windowSize = 0.6; // Slightly larger windows
    const windowSpacing = 1.8;
    const numWindows = Math.floor(width / windowSpacing);
    const numRows = Math.max(1, Math.floor(height / 1.5)); // Multiple rows of windows for taller floors

    for (let row = 0; row < numRows; row++) {
      const rowY =
        yPosition - height / 2 + (row + 1) * (height / (numRows + 1));

      for (let i = 0; i < numWindows; i++) {
        const x = (i - numWindows / 2) * windowSpacing + windowSpacing / 2;

        // Front windows
        const frontWindow = this.createWindow(windowSize, 0x87ceeb);
        frontWindow.position.set(x, rowY, depth / 2 + 0.02);
        group.add(frontWindow);

        // Back windows
        const backWindow = this.createWindow(windowSize, 0x87ceeb);
        backWindow.position.set(x, rowY, -depth / 2 - 0.02);
        group.add(backWindow);
      }
    }
  }

  createWindow(size, color = 0x87ceeb) {
    // Create window with frame for better visibility
    const windowGroup = new THREE.Group();

    // Window glass (bright)
    const glassGeometry = new THREE.PlaneGeometry(size * 0.9, size * 0.9);
    const glassMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      emissive: color,
      emissiveIntensity: 0.7,
    });
    const glass = new THREE.Mesh(glassGeometry, glassMaterial);
    windowGroup.add(glass);

    // Window frame (dark border)
    const frameGeometry = new THREE.PlaneGeometry(size, size);
    const frameMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.position.z = -0.01; // Behind glass
    windowGroup.add(frame);

    return windowGroup;
  }

  createLabel(text, color) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    // Increase canvas size for better text quality
    canvas.width = 512;
    canvas.height = 128;

    // Background for better visibility
    context.fillStyle = "rgba(0, 0, 0, 0.8)";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Text styling - larger and more visible
    const textColor = color
      ? `#${color.toString(16).padStart(6, "0")}`
      : "#ffffff";
    context.fillStyle = textColor;
    context.font = "bold 36px Arial";
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.textAlign = "center";
    context.textBaseline = "middle";

    // Handle multi-line text
    const lines = text.split("\n");
    const lineHeight = 45;
    const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, index) => {
      // Draw text with stroke for better visibility
      context.strokeText(line, canvas.width / 2, startY + index * lineHeight);
      context.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(8, 2, 1); // Larger scale for better visibility
    return sprite;
  }

  createPolymorphismLabel(text) {
    // Create a special label for polymorphism relationships
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = 512;
    canvas.height = 256; // Taller for multi-line

    // Orange background for polymorphism
    context.fillStyle = "rgba(255, 102, 0, 0.9)";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // White border
    context.strokeStyle = "#ffffff";
    context.lineWidth = 4;
    context.strokeRect(0, 0, canvas.width, canvas.height);

    // Text styling
    context.fillStyle = "#ffffff";
    context.font = "bold 28px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";

    // Draw text lines
    const lines = text.split("\n");
    const lineHeight = 40;
    const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, index) => {
      // Highlight "OVERRIDES" in bigger font
      if (line === "OVERRIDES") {
        context.font = "bold 36px Arial";
        context.fillStyle = "#ffff00"; // Yellow
        context.fillText(line, canvas.width / 2, startY + index * lineHeight);
        context.font = "bold 28px Arial";
        context.fillStyle = "#ffffff";
      } else {
        context.fillText(line, canvas.width / 2, startY + index * lineHeight);
      }
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(12, 6, 1); // Large label
    sprite.renderOrder = 1001; // Front of everything
    return sprite;
  }

  createGrid(gridSize = 100) {
    const normalizedGridSize = Math.max(40, Math.round(gridSize / 10) * 10);
    const gridHelper = new THREE.GridHelper(
      normalizedGridSize,
      normalizedGridSize / 5,
      0x555555,
      0x3a3a3a,
    );
    gridHelper.position.y = -0.1;
    this.cityGroup.add(gridHelper);

    // Add street markings
    const halfGrid = normalizedGridSize / 2;
    const markStep = Math.max(10, Math.round(normalizedGridSize / 8));
    for (let i = -halfGrid; i <= halfGrid; i += markStep) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(i, 0.01, -halfGrid),
        new THREE.Vector3(i, 0.01, halfGrid),
      ]);
      const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4a4a4a });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      this.cityGroup.add(line);

      const lineGeometry2 = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfGrid, 0.01, i),
        new THREE.Vector3(halfGrid, 0.01, i),
      ]);
      const line2 = new THREE.Line(lineGeometry2, lineMaterial);
      this.cityGroup.add(line2);
    }
  }

  getColorScheme(name) {
    const schemes = {
      default: {
        class: 0x3b82f6,   // Blue - Classes (matches legend)
        function: 0x06b6d4, // Cyan - Functions
        method: 0xe5c000,   // Warm yellow - Methods (floors)
        variable: 0x95e1d3, // Light green - Variables
      },
      rainbow: {
        class: 0xff0000, // Bright Red
        function: 0xff8800, // Orange
        method: 0xffff00, // Yellow
        variable: 0x00ff00, // Green
      },
      monochrome: {
        class: 0xffffff, // White
        function: 0xcccccc, // Light Gray
        method: 0x999999, // Medium Gray
        variable: 0x666666, // Dark Gray
      },
      vibrant: {
        class: 0xe74c3c, // Bright Red - Classes
        function: 0x3498db, // Bright Blue - Functions
        method: 0xf39c12, // Bright Orange - Methods
        variable: 0x2ecc71, // Bright Green - Variables
      },
    };
    return schemes[name] || schemes.default;
  }

  createInheritanceConnections(ast) {
    if (!this.inheritanceFamilies?.length) return;
    this.inheritanceFamilies.forEach(family => {
      if (family.members.length < 2) return;
      const familyStyle = this.getFamilyStyle(this.classFamilyMeta.get(family.root));
      const plinthColorHex = familyStyle
        ? familyStyle.primaryColor.clone().offsetHSL(0, -0.2, -0.18).getHex()
        : 0x334155;
      const memberPositions = [];
      family.members.forEach(member => {
        let found = null;
        this.cityGroup.children.forEach(child => {
          if (child.userData?.isBuilding && child.userData.node?.name === member.className) found = child;
        });
        if (found) memberPositions.push({ member, pos: found.position.clone() });
      });
      if (memberPositions.length < 2) return;
      let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
      memberPositions.forEach(({pos}) => {
        const pad = 5.5;
        minX=Math.min(minX,pos.x-pad); maxX=Math.max(maxX,pos.x+pad);
        minZ=Math.min(minZ,pos.z-pad); maxZ=Math.max(maxZ,pos.z+pad);
      });
      const pw = maxX - minX;
      const pd = maxZ - minZ;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const plinthH = 0.5;
      const plinthMesh = new THREE.Mesh(
        new THREE.BoxGeometry(pw, plinthH, pd),
        new THREE.MeshPhongMaterial({ color: plinthColorHex, emissive: plinthColorHex, emissiveIntensity: 0.07, shininess: 25, transparent: false, opacity: 1.0 })
      );
      plinthMesh.position.set(cx, -plinthH / 2 + 0.02, cz);
      plinthMesh.receiveShadow = true;
      plinthMesh.userData.inheritancePlinth = true;
      plinthMesh.userData.familyRoot = family.root;
      plinthMesh.userData.familyId = family.familyId;
      this.cityGroup.add(plinthMesh);
      memberPositions.forEach(({member, pos}) => {
        if (!member.parent) return;
        const parentEntry = memberPositions.find(m => m.member.className === member.parent);
        if (!parentEntry) return;
        const pPos = parentEntry.pos;
        const midX = (pos.x + pPos.x) / 2;
        const midZ = (pos.z + pPos.z) / 2;
        const dx = pos.x - pPos.x;
        const dz = pos.z - pPos.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        const ridgeAngle = Math.atan2(dx, dz);
        const accentHex = familyStyle?.accentColor?.getHex() || 0x4f7fbf;
        const ridge = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.32, len),
          new THREE.MeshPhongMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity: 0.22 })
        );
        ridge.position.set(midX, 0.14, midZ);
        ridge.rotation.y = ridgeAngle;
        ridge.userData.inheritancePlinth = true;
        ridge.userData.inheritanceRidge = true;
        ridge.userData.childClass = member.className;
        ridge.userData.parentClass = member.parent;
        ridge.userData.familyRoot = family.root;
        this.cityGroup.add(ridge);
      });
      const primHex = familyStyle?.primaryColor?.getHex() || 0xaabbcc;
      const plaque = this.createLabel(family.root + ' family', primHex);
      plaque.position.set(cx, 0.85, maxZ + 1.5);
      plaque.scale.set(5, 1.1, 1);
      this.cityGroup.add(plaque);
    });
  }


  createPolymorphismConnections(ast) {
    return; // Polymorphism arc lines disabled
    console.log("createPolymorphismConnections called");

    const classNodes = new Map();
    const methodFloors = new Map(); // class.method -> { floorGroup, mainMesh, methodNode, className }

    this.cityGroup.children.forEach((building) => {
      const classNode = building.userData?.node;
      if (!classNode || !["class", "abstractClass", "interface"].includes(classNode.type)) {
        return;
      }
      classNodes.set(classNode.name, classNode);

      building.children.forEach((child) => {
        const methodNode = child.userData?.node;
        if (!methodNode || methodNode.type !== "method") return;

        const key = `${classNode.name}.${methodNode.name}`;
        const mainMesh = (child.children || []).find(
          (c) => c.userData && c.userData.isMainFloorMesh,
        );

        methodFloors.set(key, {
          floorGroup: child,
          mainMesh: mainMesh || child,
          methodNode,
          className: classNode.name,
        });
      });
    });

    const getParentClass = (className) => {
      const classNode = classNodes.get(className);
      if (!classNode) return null;
      const parents = Array.isArray(classNode.inherits)
        ? classNode.inherits
        : Array.isArray(classNode.extends)
          ? classNode.extends
          : [];
      return parents[0] || null;
    };

    const findBaseMethodKey = (className, methodName) => {
      let currentClass = className;
      let currentKey = `${className}.${methodName}`;
      if (!methodFloors.has(currentKey)) return null;

      while (true) {
        const parentClass = getParentClass(currentClass);
        if (!parentClass) break;
        const parentKey = `${parentClass}.${methodName}`;
        if (!methodFloors.has(parentKey)) break;
        currentClass = parentClass;
        currentKey = parentKey;
      }

      return currentKey;
    };

    // Build families by base declaration
    const families = new Map(); // baseKey -> { methodName, baseKey, members:Set, edges:[] }

    methodFloors.forEach((entry, key) => {
      const methodName = entry.methodNode.name;
      const parentClass = getParentClass(entry.className);
      const parentKey = parentClass ? `${parentClass}.${methodName}` : null;
      if (!parentKey || !methodFloors.has(parentKey)) return;

      const baseKey = findBaseMethodKey(entry.className, methodName);
      if (!baseKey) return;

      if (!families.has(baseKey)) {
        families.set(baseKey, {
          methodName,
          baseKey,
          members: new Set([baseKey]),
          edges: [],
        });
      }

      const family = families.get(baseKey);
      family.members.add(key);
      family.members.add(parentKey);
      family.edges.push({ parentKey, childKey: key });
    });

    const familyList = Array.from(families.values());
    const iconTypes = ["sphere", "diamond", "cube", "cone"];

    const createFamilyIcon = (type, color) => {
      let geometry;
      if (type === "sphere") geometry = new THREE.SphereGeometry(0.18, 10, 10);
      else if (type === "diamond") geometry = new THREE.OctahedronGeometry(0.18);
      else if (type === "cone") geometry = new THREE.ConeGeometry(0.16, 0.34, 8);
      else geometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);

      return new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1.6,
          depthTest: false,
        }),
      );
    };

    familyList.forEach((family, familyIndex) => {
      const hue = (familyIndex * 137.5 + 24) % 360;
      const familyColor = new THREE.Color().setHSL(hue / 360, 0.8, 0.56);
      const familyColorHex = familyColor.getHex();
      const iconType = iconTypes[familyIndex % iconTypes.length];

      const members = Array.from(family.members);
      const baseClassName = family.baseKey.split(".")[0];
      const overrideClassNames = members
        .filter((k) => k !== family.baseKey)
        .map((k) => k.split(".")[0]);

      members.forEach((memberKey) => {
        const data = methodFloors.get(memberKey);
        if (!data) return;

        const isBase = memberKey === family.baseKey;
        const floorGroup = data.floorGroup;
        const mainMesh = data.mainMesh;

        // Apply shared family color accent on floor emissive
        if (mainMesh && mainMesh.material) {
          mainMesh.userData.polymorphismOriginalEmissiveIntensity =
            mainMesh.material.emissiveIntensity || 0.6;
          mainMesh.material.emissive = familyColor;
          mainMesh.material.emissiveIntensity = 0.7;
          mainMesh.userData.polymorphismFamilyMainMesh = true;
        }

        // Shared family icon
        const icon = createFamilyIcon(iconType, familyColorHex);
        icon.position.set(-0.65, (mainMesh.position?.y || 0) + 0.55, 0.55);
        icon.userData.polymorphismFamily = family.baseKey;
        icon.userData.polymorphismFamilyIcon = true;
        icon.userData.node = data.methodNode;
        icon.userData.ownerClassName = data.className;
        floorGroup.add(icon);

        // Shared thin family strip at front edge
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(1.0, 0.08, 0.08),
          new THREE.MeshBasicMaterial({
            color: familyColorHex,
            emissive: familyColorHex,
            emissiveIntensity: 1.2,
          }),
        );
        strip.position.set(0, (mainMesh.position?.y || 0) + 0.1, 0.56);
        strip.userData.polymorphismFamily = family.baseKey;
        strip.userData.polymorphismFamilyStrip = true;
        strip.userData.node = data.methodNode;
        strip.userData.ownerClassName = data.className;
        floorGroup.add(strip);

        // Base/override role tags
        const roleMarker = new THREE.Mesh(
          isBase
            ? new THREE.TorusGeometry(0.16, 0.05, 8, 16)
            : new THREE.ConeGeometry(0.13, 0.26, 6),
          new THREE.MeshBasicMaterial({
            color: isBase ? 0x44ccff : 0xffaa33,
            emissive: isBase ? 0x44ccff : 0xffaa33,
            emissiveIntensity: 1.6,
            depthTest: false,
          }),
        );
        roleMarker.position.set(0.65, (mainMesh.position?.y || 0) + 0.55, 0.55);
        if (isBase) roleMarker.rotation.x = Math.PI / 2;
        roleMarker.userData.polymorphismFamily = family.baseKey;
        roleMarker.userData.polymorphismRoleMarker = true;
        roleMarker.userData.polymorphismRole = isBase ? "base" : "override";
        roleMarker.userData.node = data.methodNode;
        roleMarker.userData.ownerClassName = data.className;
        floorGroup.add(roleMarker);

        // Metadata for interactive highlighting/panel explanation
        floorGroup.userData.polymorphismFamily = family.baseKey;
        floorGroup.userData.polymorphismColor = familyColorHex;
        floorGroup.userData.polymorphismRole = isBase ? "base" : "override";
        floorGroup.userData.polymorphismBaseClass = baseClassName;
        floorGroup.userData.polymorphismMethodName = family.methodName;
        floorGroup.userData.polymorphismOverrideClasses = overrideClassNames;

        data.methodNode.polymorphismFamily = family.baseKey;
        data.methodNode.polymorphismColor = familyColorHex;
        data.methodNode.polymorphismRole = isBase ? "base" : "override";
        data.methodNode.polymorphismBaseClass = baseClassName;
        data.methodNode.polymorphismMethodName = family.methodName;
        data.methodNode.polymorphismOverrideClasses = overrideClassNames;
      });

      // Create subtle family connectors hidden by default
      family.edges.forEach((edge) => {
        const parentData = methodFloors.get(edge.parentKey);
        const childData = methodFloors.get(edge.childKey);
        if (!parentData || !childData) return;

        const parentPos = new THREE.Vector3();
        const childPos = new THREE.Vector3();
        parentData.mainMesh.getWorldPosition(parentPos);
        childData.mainMesh.getWorldPosition(childPos);

        const startPoint = new THREE.Vector3(parentPos.x, parentPos.y + 1.0, parentPos.z);
        const endPoint = new THREE.Vector3(childPos.x, childPos.y + 1.0, childPos.z);
        const controlPoint = new THREE.Vector3(
          (startPoint.x + endPoint.x) / 2,
          Math.max(startPoint.y, endPoint.y) + 6,
          (startPoint.z + endPoint.z) / 2,
        );
        const curve = new THREE.QuadraticBezierCurve3(startPoint, controlPoint, endPoint);
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(32));

        const arcLine = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: familyColorHex,
            transparent: true,
            opacity: 0.65,
            depthTest: false,
          }),
        );
        arcLine.visible = false;
        arcLine.userData.disabled = true; // disabled: confusing arcs
        arcLine.userData.polymorphismConnection = true;
        arcLine.userData.focusOnly = true;
        arcLine.userData.polymorphismFamily = family.baseKey;
        arcLine.userData.parentMethod = edge.parentKey;
        arcLine.userData.childMethod = edge.childKey;
        arcLine.userData.parentFloor = parentData.floorGroup;
        arcLine.userData.childFloor = childData.floorGroup;
        this.cityGroup.add(arcLine);
      });
    });

    console.log(`🎉 Polymorphism families: ${familyList.length}`);
  }

  clear() {
    while (this.cityGroup.children.length > 0) {
      this.cityGroup.remove(this.cityGroup.children[0]);
    }
  }}
