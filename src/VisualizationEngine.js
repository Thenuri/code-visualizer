/**
 * 3D Visualization Engine
 * Creates 3D objects from AST with multiple view modes
 */
import * as THREE from "three";
import { CodeCityVisualizer } from "./CodeCityVisualizer.js";
import { FlowchartEngine } from "./FlowchartEngine.js";

export class VisualizationEngine {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.codeCityVisualizer = null;
    this.flowchartEngine = null;
    this.nodeCount = 0;
    this.performanceMode = false; // Enable optimizations for large codebases
  }

  createVisualization(ast, options) {
    // Clear previous
    this.clear();

    const { viewMode = "simple" } = options;

    // Count nodes to determine if we need performance optimizations
    this.nodeCount = this.countNodes(ast);
    this.performanceMode = this.nodeCount > 100; // Enable optimizations for 100+ nodes

    if (this.performanceMode) {
      console.log(`⚡ Performance mode enabled (${this.nodeCount} nodes)`);
    }

    let result;

    switch (viewMode) {
      case "city":
        // Code City view for OOP code
        if (!this.codeCityVisualizer) {
          this.codeCityVisualizer = new CodeCityVisualizer(this.scene);
        }
        result = this.codeCityVisualizer.createCity(ast, options);
        break;

      case "flowchart":
      default:
        // Flowchart view for procedural code
        if (!this.flowchartEngine) {
          this.flowchartEngine = new FlowchartEngine(this.scene);
        }
        result = this.flowchartEngine.createFlowchart(ast);
        break;
    }

    // Apply performance optimizations if needed
    if (this.performanceMode && result) {
      this.optimizeForLargeCodebase();
    }

    return result;
  }

  countNodes(node) {
    let count = 1;
    if (node.children) {
      node.children.forEach((child) => {
        count += this.countNodes(child);
      });
    }
    return count;
  }

  optimizeForLargeCodebase() {
    // Enable frustum culling (only render objects in view)
    this.group.traverse((object) => {
      if (object.isMesh) {
        object.frustumCulled = true;

        // Reduce geometry detail for distant objects
        if (object.geometry && object.geometry.type === "BoxGeometry") {
          // Use simpler materials for better performance
          if (object.material && object.material.type === "MeshPhongMaterial") {
            object.material.shininess = 30; // Reduce shininess calculations
          }
        }
      }
    });

    // Limit label rendering in performance mode
    let labelCount = 0;
    const maxLabels = 50;
    this.group.traverse((object) => {
      if (object.isSprite && labelCount >= maxLabels) {
        object.visible = false;
      } else if (object.isSprite) {
        labelCount++;
      }
    });

    console.log(
      `⚡ Optimizations applied: Frustum culling enabled, ${labelCount} labels visible`,
    );
  }

  createSimple(ast) {
    const spacing = 5;
    this.nodePositions = new Map(); // Track positions for inheritance

    // First pass: calculate actual width needed by simulating the layout
    let maxX = 0;
    let minX = 0;
    let tempX = 0;

    const calculateWidth = (node, depth = 0) => {
      if (!node.children) return;

      for (const child of node.children) {
        const size = this.getSize(child.type, child.complexity || 1);

        // Account for class members extending to the left
        if (
          (child.type === "class" ||
            child.type === "abstractClass" ||
            child.type === "interface") &&
          child.members &&
          child.members.length > 0
        ) {
          const memberSize = this.getSize("property");
          const membersWidth = child.members.length * (memberSize + 1);
          minX = Math.min(minX, tempX - size - membersWidth);
        }

        maxX = Math.max(maxX, tempX + size / 2);
        minX = Math.min(minX, tempX - size / 2);

        tempX += size + spacing;

        // Recursively process children (they don't affect X position in simple mode)
        if (child.children && child.children.length > 0) {
          calculateWidth(child, depth + 1);
        }
      }
    };

    // Calculate total width
    calculateWidth(ast);
    const totalWidth = maxX - minX;

    // Calculate starting X position - center the visualization
    const centerOffset = (maxX + minX) / 2;
    const startX = -centerOffset;
    let x = startX;

    const traverse = (node, depth = 0) => {
      if (!node.children) return;

      for (const child of node.children) {
        const size = this.getSize(child.type, child.complexity || 1);
        let color = this.getColor(child.type, child);

        // Adjust color intensity based on complexity
        const intensity = Math.min(1, 0.5 + (child.complexity || 1) * 0.1);

        // Special handling for abstract classes and interfaces
        let materialColor = color;
        let opacity = 1.0;
        if (child.type === "abstractClass") {
          opacity = 0.7; // Semi-transparent for abstract classes
          materialColor = 0xff8c94; // Light red for abstract
        } else if (child.type === "interface") {
          opacity = 0.6; // More transparent for interfaces
          materialColor = 0xffb347; // Orange-red for interfaces
        }

        // Create shape based on type
        let mesh;
        if (["if", "elif", "else"].includes(child.type)) {
          // Diamond shape for if/else
          const shape = new THREE.Shape();
          shape.moveTo(0, size);
          shape.lineTo(size, 0);
          shape.lineTo(0, -size);
          shape.lineTo(-size, 0);
          shape.lineTo(0, size);
          const geometry = new THREE.ShapeGeometry(shape);
          const material = new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: intensity,
          });
          mesh = new THREE.Mesh(geometry, material);
          mesh.rotation.z = Math.PI / 4;
        } else if (["for", "while"].includes(child.type)) {
          // Cylinder for loops
          const geometry = new THREE.CylinderGeometry(
            size * 0.7,
            size * 0.7,
            size,
            8,
          );
          const material = new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: intensity,
          });
          mesh = new THREE.Mesh(geometry, material);
        } else if (["try", "except", "catch"].includes(child.type)) {
          // Octahedron for try/catch
          const geometry = new THREE.OctahedronGeometry(size * 0.8);
          const material = new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: intensity,
          });
          mesh = new THREE.Mesh(geometry, material);
        } else {
          // Regular box for classes, functions, methods
          const geometry = new THREE.BoxGeometry(size, size, size);
          const material = new THREE.MeshPhongMaterial({
            color: materialColor || color,
            emissive: materialColor || color,
            emissiveIntensity: intensity,
            transparent: opacity < 1.0,
            opacity: opacity,
          });
          mesh = new THREE.Mesh(geometry, material);
        }

        const position = new THREE.Vector3(x, depth * 3, 0);
        mesh.position.copy(position);
        mesh.userData.node = child;

        // Store position for inheritance and composition connections
        if (
          child.type === "class" ||
          child.type === "abstractClass" ||
          child.type === "interface"
        ) {
          this.nodePositions.set(child.name, position.clone());
        }

        // Also store for class members positioning
        if (
          child.type === "class" &&
          child.members &&
          child.members.length > 0
        ) {
          let memberX = x - size;
          child.members.forEach((member) => {
            const memberSize = this.getSize(member.type);
            const memberColor = this.getColor(member.type);
            const memberGeometry = new THREE.BoxGeometry(
              memberSize,
              memberSize * 0.5,
              memberSize,
            );
            const memberMaterial = new THREE.MeshPhongMaterial({
              color: memberColor,
              emissive: memberColor,
              emissiveIntensity: 0.3,
            });
            const memberMesh = new THREE.Mesh(memberGeometry, memberMaterial);
            memberMesh.position.set(memberX, depth * 3 - size - 1, 0);
            memberMesh.userData.node = member;
            this.group.add(memberMesh);

            // Add label for member with type info
            const memberLabelText = `${member.name} (${member.type})`;
            const memberLabel = this.createLabel(memberLabelText);
            memberLabel.position.copy(memberMesh.position);
            memberLabel.position.y += memberSize / 2 + 0.5;
            memberLabel.scale.set(3, 0.6, 1);
            this.group.add(memberLabel);

            memberX += memberSize + 1;
          });
        }

        // Add label with OOP indicators - show name/type for ALL elements
        let labelText = child.name || child.type;

        // For control structures, show type clearly
        if (
          [
            "if",
            "elif",
            "else",
            "for",
            "while",
            "try",
            "except",
            "catch",
          ].includes(child.type)
        ) {
          labelText = `${child.type.toUpperCase()}`;
          if (child.name) {
            labelText += `: ${child.name}`;
          }
        }

        // Add generics/templates to label (safely)
        if (
          child.generics &&
          Array.isArray(child.generics) &&
          child.generics.length > 0
        ) {
          labelText += `<${child.generics.join(", ")}>`;
        }

        if (child.type === "abstractClass") {
          labelText = `🔷 ${labelText}`; // Diamond for abstract
        } else if (child.type === "interface") {
          labelText = `◊ ${labelText}`; // Diamond symbol for interface
        }

        // Add nested class indicator (safely)
        if (child.isNested === true) {
          labelText = `📦 ${labelText}`; // Box for nested class
        }

        // Add namespace/file info (for multi-file codebases)
        if (child.namespace) {
          labelText += `\n[${child.namespace}]`;
        } else if (child.fileName) {
          const fileName = child.fileName.replace(/\.[^.]+$/, "");
          labelText += `\n[${fileName}]`;
        }

        if (child.isAbstract === true) {
          labelText += " (abstract)";
        }

        // Add method overloading indicator (safely)
        if (child.isOverloaded === true && child.overloadCount) {
          labelText += ` [${child.overloadCount}x]`; // Show overload count
        }

        // Create label with better visibility
        const label = this.createLabel(labelText);
        label.position.copy(mesh.position);
        label.position.y += size / 2 + 1.5; // Higher for better visibility
        label.scale.set(4, 1, 1); // Larger scale

        this.group.add(mesh);
        this.group.add(label);

        // Add access modifier indicator for methods
        if (child.type === "method" && child.access) {
          const accessColor = this.getAccessModifierColor(child.access);
          const accessIndicator = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 8, 8),
            new THREE.MeshBasicMaterial({
              color: accessColor,
              emissive: accessColor,
            }),
          );
          accessIndicator.position.copy(mesh.position);
          accessIndicator.position.x += size / 2 + 0.5;
          accessIndicator.position.y += size / 2;
          this.group.add(accessIndicator);
        }

        // Add override indicator for polymorphic methods
        if (child.overrides) {
          const overrideIndicator = new THREE.Mesh(
            new THREE.ConeGeometry(0.4, 0.8, 4),
            new THREE.MeshBasicMaterial({
              color: 0x00ffff,
              emissive: 0x00ffff,
            }),
          );
          overrideIndicator.position.copy(mesh.position);
          overrideIndicator.position.x -= size / 2 + 0.5;
          overrideIndicator.position.y += size / 2;
          overrideIndicator.rotation.z = Math.PI;
          this.group.add(overrideIndicator);
        }

        // Add constructor indicator
        if (child.isConstructor) {
          const constructorIndicator = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshBasicMaterial({
              color: 0xff00ff,
              emissive: 0xff00ff,
            }),
          );
          constructorIndicator.position.copy(mesh.position);
          constructorIndicator.position.y -= size / 2 - 0.3;
          this.group.add(constructorIndicator);
        }

        // Add method overloading indicator (multiple small cubes) - safely
        if (
          child.isOverloaded === true &&
          child.overloadCount &&
          typeof child.overloadCount === "number"
        ) {
          const overloadCount = Math.min(Math.max(child.overloadCount, 1), 5);
          for (let i = 0; i < overloadCount; i++) {
            const overloadIndicator = new THREE.Mesh(
              new THREE.BoxGeometry(0.2, 0.2, 0.2),
              new THREE.MeshBasicMaterial({
                color: 0xff8800,
                emissive: 0xff8800,
              }),
            );
            overloadIndicator.position.copy(mesh.position);
            overloadIndicator.position.x += size / 2 + 0.3 + i * 0.25;
            overloadIndicator.position.y -= size / 2 - 0.3;
            overloadIndicator.position.z += size / 2;
            this.group.add(overloadIndicator);
          }
        }

        // Visualize nested classes inside parent classes - safely
        if (
          child.isNested === true &&
          child.parentClass &&
          typeof child.parentClass === "string"
        ) {
          // Make nested class smaller and position it inside parent
          mesh.scale.multiplyScalar(0.6);
          mesh.position.y -= size * 0.3;
          mesh.position.z += size * 0.2;

          // Add connection line to parent
          const parentPosition = this.nodePositions.get(child.parentClass);
          if (parentPosition) {
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
              parentPosition,
              mesh.position,
            ]);
            const lineMaterial = new THREE.LineBasicMaterial({
              color: 0x888888,
              linewidth: 1,
            });
            const line = new THREE.Line(lineGeometry, lineMaterial);
            this.group.add(line);
          }
        }

        // Add class members if it's a class
        if (
          child.type === "class" &&
          child.members &&
          child.members.length > 0
        ) {
          let memberX = x - size;
          child.members.forEach((member) => {
            const memberSize = this.getSize(member.type);
            const memberColor = this.getColor(member.type);
            const memberGeometry = new THREE.BoxGeometry(
              memberSize,
              memberSize * 0.5,
              memberSize,
            );
            const memberMaterial = new THREE.MeshPhongMaterial({
              color: memberColor,
              emissive: memberColor,
              emissiveIntensity: 0.3,
            });
            const memberMesh = new THREE.Mesh(memberGeometry, memberMaterial);
            memberMesh.position.set(memberX, depth * 3 - size - 1, 0);
            memberMesh.userData.node = member;
            this.group.add(memberMesh);

            const memberLabel = this.createLabel(member.name);
            memberLabel.position.copy(memberMesh.position);
            memberLabel.position.y += memberSize / 2 + 0.5;
            memberLabel.scale.set(2, 0.5, 1);
            this.group.add(memberLabel);

            memberX += memberSize + 1;
          });
        }

        x += size + spacing;

        // Recursively add children
        traverse(child, depth + 1);
      }
    };

    traverse(ast);

    // Add inheritance connections
    this.addInheritanceConnections(ast);

    // Final check: Center the visualization on the canvas
    setTimeout(() => {
      const boundingBox = new THREE.Box3().setFromObject(this.group);
      const groupCenter = boundingBox.getCenter(new THREE.Vector3());

      // Center around X = 0
      const shiftNeeded = groupCenter.x;

      if (Math.abs(shiftNeeded) > 0.5) {
        this.group.position.x -= shiftNeeded;
        console.log(
          `Shifted visualization to center by ${shiftNeeded.toFixed(2)} units`,
        );
      }
    }, 100);
  }

  addInheritanceConnections(ast) {
    const addConnections = (nodes) => {
      for (const node of nodes) {
        if (
          node.type === "class" &&
          node.inherits &&
          node.inherits.length > 0
        ) {
          node.inherits.forEach((parentName) => {
            const parentPos = this.nodePositions.get(parentName);
            const childPos = this.nodePositions.get(node.name);

            if (parentPos && childPos) {
              // Create connection line
              const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(parentPos.x, parentPos.y + 2, parentPos.z),
                new THREE.Vector3(childPos.x, childPos.y + 2, childPos.z),
              ]);
              const lineMaterial = new THREE.LineBasicMaterial({
                color: 0x00ff00,
                linewidth: 3,
              });
              const line = new THREE.Line(lineGeometry, lineMaterial);
              this.group.add(line);

              // Add arrow head
              const direction = new THREE.Vector3()
                .subVectors(childPos, parentPos)
                .normalize();
              const arrowHelper = new THREE.ArrowHelper(
                direction,
                parentPos,
                5,
                0x00ff00,
                1,
                0.5,
              );
              this.group.add(arrowHelper);
            }
          });
        }
        if (node.children) {
          addConnections(node.children);
        }
      }
    };

    addConnections(ast.children);
  }

  createHierarchical(ast, position, depth) {
    if (!ast.children) return;

    const spacing = 8;
    let xOffset = -(ast.children.length * spacing) / 2;

    for (const child of ast.children) {
      const size = this.getSize(child.type);
      const color = this.getColor(child.type);

      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshPhongMaterial({ color });
      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(
        position.x + xOffset,
        position.y - depth * 4,
        position.z,
      );
      mesh.userData.node = child;

      const label = this.createLabel(child.name || child.type);
      label.position.copy(mesh.position);
      label.position.y += size / 2 + 1;

      this.group.add(mesh);
      this.group.add(label);

      // Add children
      if (child.children && child.children.length > 0) {
        this.createHierarchical(
          child,
          new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
          depth + 1,
        );
      }

      xOffset += spacing;
    }
  }

  createFlowView(ast) {
    // Flow view: shows execution flow with arrows
    const spacing = 8;
    const ySpacing = 4;

    // Calculate total width to center the visualization
    const calculateWidth = (node, depth = 0) => {
      if (!node.children || node.children.length === 0) return spacing;
      let maxWidth = node.children.length * spacing;
      node.children.forEach((child) => {
        const childWidth = calculateWidth(child, depth + 1);
        maxWidth = Math.max(maxWidth, childWidth);
      });
      return maxWidth;
    };
    const totalWidth = calculateWidth(ast);
    const startX = -totalWidth / 2;

    const traverse = (node, depth = 0, parentX = 0) => {
      if (!node.children) return;

      let currentX =
        parentX - (node.children.length * spacing) / 2 + spacing / 2;
      if (depth === 0) {
        currentX += startX; // Shift left for root level
      }

      for (const child of node.children) {
        const size = this.getSize(child.type);
        const color = this.getColor(child.type);

        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshPhongMaterial({ color });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(currentX, -depth * ySpacing, 0);
        mesh.userData.node = child;

        const label = this.createLabel(child.name || child.type);
        label.position.copy(mesh.position);
        label.position.y += size / 2 + 1;

        this.group.add(mesh);
        this.group.add(label);

        // Add arrow/connection to parent
        if (depth > 0) {
          const arrow = this.createArrow(
            new THREE.Vector3(parentX, -(depth - 1) * ySpacing + size / 2, 0),
            new THREE.Vector3(currentX, -depth * ySpacing - size / 2, 0),
          );
          this.group.add(arrow);
        }

        traverse(child, depth + 1, currentX);
        currentX += spacing;
      }
    };

    traverse(ast);
  }

  createDependencyView(ast) {
    // Dependency view: shows relationships between nodes
    const nodes = [];
    const connections = [];

    // Collect all nodes
    const collectNodes = (node, parent = null) => {
      if (node.type !== "module") {
        nodes.push({ node, parent });
      }
      if (node.children) {
        node.children.forEach((child) => {
          collectNodes(child, node);
          if (parent) {
            connections.push({ from: parent, to: child });
          }
        });
      }
    };

    collectNodes(ast);

    // Position nodes in a circle
    const radius = 15;
    nodes.forEach((item, index) => {
      const angle = (index / nodes.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const size = this.getSize(item.node.type);
      const color = this.getColor(item.node.type);

      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshPhongMaterial({ color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, 0, z);
      mesh.userData.node = item.node;

      const label = this.createLabel(item.node.name || item.node.type);
      label.position.copy(mesh.position);
      label.position.y += size / 2 + 1;

      this.group.add(mesh);
      this.group.add(label);
    });

    // Add connections
    connections.forEach((conn) => {
      const fromIndex = nodes.findIndex((n) => n.node === conn.from);
      const toIndex = nodes.findIndex((n) => n.node === conn.to);

      if (fromIndex !== -1 && toIndex !== -1) {
        const fromAngle = (fromIndex / nodes.length) * Math.PI * 2;
        const toAngle = (toIndex / nodes.length) * Math.PI * 2;
        const fromPos = new THREE.Vector3(
          Math.cos(fromAngle) * radius,
          0,
          Math.sin(fromAngle) * radius,
        );
        const toPos = new THREE.Vector3(
          Math.cos(toAngle) * radius,
          0,
          Math.sin(toAngle) * radius,
        );

        const line = this.createConnectionLine(fromPos, toPos);
        this.group.add(line);
      }
    });
  }

  createTreeView(ast) {
    // Tree view: vertical tree structure
    const traverse = (node, position, depth = 0) => {
      if (!node.children || node.children.length === 0) return;

      const spacing = 10;
      let xOffset = -(node.children.length * spacing) / 2 + spacing / 2;

      node.children.forEach((child, index) => {
        const size = this.getSize(child.type);
        const color = this.getColor(child.type);

        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshPhongMaterial({ color });
        const mesh = new THREE.Mesh(geometry, material);

        const x = position.x + xOffset;
        const y = position.y - depth * 6;

        mesh.position.set(x, y, position.z);
        mesh.userData.node = child;

        const label = this.createLabel(child.name || child.type);
        label.position.copy(mesh.position);
        label.position.y += size / 2 + 1;

        this.group.add(mesh);
        this.group.add(label);

        // Connection line to parent
        if (depth > 0) {
          const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(position.x, position.y, position.z),
            new THREE.Vector3(x, y + size / 2, position.z),
          ]);
          const lineMaterial = new THREE.LineBasicMaterial({ color: 0x667eea });
          const line = new THREE.Line(lineGeometry, lineMaterial);
          this.group.add(line);
        }

        traverse(child, new THREE.Vector3(x, y, position.z), depth + 1);
        xOffset += spacing;
      });
    };

    traverse(ast, new THREE.Vector3(0, 10, 0), 0);
  }

  createArrow(from, to) {
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = direction.length();
    direction.normalize();

    const arrowHelper = new THREE.ArrowHelper(
      direction,
      from,
      length,
      0x667eea,
      length * 0.2,
      length * 0.1,
    );
    return arrowHelper;
  }

  createConnectionLine(from, to) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({
      color: 0x667eea,
      transparent: true,
      opacity: 0.5,
    });
    return new THREE.Line(geometry, material);
  }

  getSize(type) {
    const sizes = {
      class: 3,
      abstractClass: 3,
      interface: 2.5, // Slightly smaller for interfaces
      function: 2.5,
      method: 2,
      variable: 1.5,
    };
    return sizes[type] || 2;
  }

  getColor(type, node = null) {
    // More distinct colors for better visibility
    const colors = {
      class: 0xff6b6b, // Red - Classes
      abstractClass: 0xff8c94, // Light Red - Abstract Classes
      interface: 0xffb347, // Orange-Red - Interfaces
      function: 0x4ecdc4, // Cyan - Functions
      method: 0xffe66d, // Yellow - Methods
      variable: 0x95e1d3, // Light Green - Variables
      // Control structures
      if: 0xff9ff3, // Pink - If statements
      elif: 0xff9ff3, // Pink - Elif
      else: 0xf368e0, // Magenta - Else
      for: 0x54a0ff, // Blue - For loops
      while: 0x5f27cd, // Purple - While loops
      try: 0xff6348, // Red-Orange - Try blocks
      except: 0xff3838, // Red - Except
      catch: 0xff3838, // Red - Catch
      // Class members
      property: 0xa8e6cf, // Light Green - Properties
      attribute: 0xa8e6cf, // Light Green - Attributes
      constant: 0xffa500, // Orange - Constants (changed from yellow)
      static: 0x6c5ce7, // Purple - Static members
    };

    // Handle access modifier colors for methods
    if (type === "method" && node) {
      if (node.access === "private") {
        return 0xcc9900; // Darker yellow for private
      } else if (node.access === "protected") {
        return 0xffcc00; // Medium yellow for protected
      } else {
        return colors.method; // Bright yellow for public
      }
    }

    return colors[type] || 0xffffff;
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

  createLabel(text) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    // Increase canvas size for better text quality
    canvas.width = 512;
    canvas.height = 128;

    // Background for better visibility
    context.fillStyle = "rgba(0, 0, 0, 0.7)";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Text styling - larger and more visible
    context.fillStyle = "#ffffff";
    context.font = "bold 32px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";

    // Handle multi-line text
    const lines = text.split("\n");
    const lineHeight = 40;
    const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, index) => {
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
    sprite.scale.set(6, 1.5, 1); // Larger scale for better visibility
    return sprite;
  }

  clear() {
    // Clear regular group
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.scene.remove(this.group);

    // Clear code city if exists
    if (this.codeCityVisualizer) {
      this.codeCityVisualizer.clear();
    }

    // Clear flowchart if exists
    if (this.flowchartEngine) {
      this.flowchartEngine.clear();
    }
  }
}
