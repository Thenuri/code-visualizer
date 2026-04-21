/**
 * FlowchartEngine - Creates flowchart visualizations for procedural code
 * Analyzes control flow, detects errors, and generates proper flowchart shapes
 */
import * as THREE from "three";
// TextGeometry / FontLoader removed — labels use canvas sprites instead

export class FlowchartEngine {
  constructor(scene) {
    this.scene = scene;
    this.flowchartGroup = new THREE.Group();
    this.currentY = 0; // Vertical position tracker
    this.currentX = 0; // Horizontal position tracker (center column)
    this.nodeWidth = 12;
    this.nodeHeight = 6;
    this.verticalSpacing = 15; // Increased for clarity
    this.branchSpacing = 25; // Horizontal spacing for branches
    this.arrows = [];
    this.nodes = [];
    this.errorNodes = [];
    this.mergePoints = []; // Track where branches merge back
    this.suppressNextAutoArrow = false; // Flag to prevent duplicate arrows

    // Colors for different node types (semantic)
    this.colors = {
      start: 0x00ff00, // Green
      end: 0xff0000, // Red
      input: 0x00bfff, // Deep sky blue (input parallelogram)
      output: 0x32cd32, // Lime green (output parallelogram)
      process: 0x4169e1, // Royal blue
      decision: 0xffa500, // Orange
      loop: 0x9370db, // Purple
      functionCall: 0x00ced1, // Cyan
      error: 0xff4444, // Bright red
      warning: 0xffaa00, // Yellow-orange
      success: 0x00ff88, // Bright green
    };
  }

  createFlowchart(ast) {
    console.log("🌊 Creating flowchart visualization...");
    console.log("📊 AST has", ast.children?.length || 0, "top-level children");
    this.flowchartGroup = new THREE.Group();
    this.currentY = 0;
    this.currentX = 0;
    this.arrows = [];
    this.nodes = [];
    this.errorNodes = [];

    // Add start node
    this.addStartNode();
    this.currentY -= this.verticalSpacing;

    // Check for errors in AST
    if (ast.error) {
      this.addErrorNode(ast.error);
      this.currentY -= this.verticalSpacing;
      this.addEndNode();
      this.scene.add(this.flowchartGroup);
      return this.flowchartGroup;
    }

    // Process all structures - dive into classes and methods to find control flow
    if (ast.children && ast.children.length > 0) {
      ast.children.forEach((node, index) => {
        this.processNode(node, 0);
      });
    } else {
      this.addWarningNode("No code structures found");
      this.currentY -= this.verticalSpacing;
    }

    // Add end node
    this.addEndNode();

    // Detect flow issues
    this.detectFlowIssues();

    this.scene.add(this.flowchartGroup);
    console.log(
      `✅ Flowchart created with ${this.nodes.length} nodes and ${this.arrows.length} connections`,
    );
    return this.flowchartGroup;
  }

  processNode(node, depth, xOffset = 0) {
    if (!node) return;

    console.log(
      `🔍 Processing node: type="${node.type}", name="${node.name}", children=${node.children?.length || 0}`,
    );

    switch (node.type) {
      case "module":
        // Module level - process all children in center column
        console.log(
          `📦 Processing module, diving into ${node.children?.length || 0} children...`,
        );
        if (node.children && node.children.length > 0) {
          node.children.forEach((child) => {
            this.processNode(child, depth, xOffset);
          });
        }
        break;

      case "class":
      case "abstractClass":
      case "interface":
        // Skip class nodes - dive into children
        console.log(
          `📦 Skipping ${node.type}: ${node.name}, diving into children...`,
        );
        if (node.children && node.children.length > 0) {
          node.children.forEach((child) => {
            this.processNode(child, depth, xOffset);
          });
        }
        break;

      case "method":
      case "function":
        // Add function/method node - center column
        this.addFunctionNode(node, xOffset);
        console.log(`📞 Processing ${node.type}: ${node.name}`);
        if (node.children && node.children.length > 0) {
          this.currentY -= this.verticalSpacing;
          node.children.forEach((child) => {
            this.processNode(child, depth, xOffset);
          });
        }
        break;

      case "statement":
        // Analyze statement semantically - center column
        this.processStatement(node, xOffset);
        break;

      case "if":
      case "elif":
        // Decision node - keep everything in center column, flow vertically
        const decisionLabel = node.type === "if" ? "IF" : "ELIF";
        const ifDecisionY = this.currentY;
        const ifDecisionNodeIndex = this.nodes.length;
        this.addDecisionNode(node, decisionLabel, xOffset);
        this.currentY -= this.verticalSpacing;

        // Process children in same center column - just continue down
        if (node.children && node.children.length > 0) {
          const ifBodyStartY = this.currentY;

          // Suppress auto-arrow for first child (we'll add explicit YES arrow)
          this.suppressNextAutoArrow = true;

          node.children.forEach((child) => {
            this.processNode(child, depth + 1, xOffset);
          });

          // Add explicit YES arrow from decision to first child in body
          if (this.nodes.length > ifDecisionNodeIndex + 1) {
            const ifDecisionNode = this.nodes[ifDecisionNodeIndex];
            const firstChildNode = this.nodes[ifDecisionNodeIndex + 1];
            const yesArrowStart = new THREE.Vector3(
              xOffset,
              ifDecisionY - 4,
              0,
            );
            this.addArrow(yesArrowStart, firstChildNode.position, "normal");
          }
        }
        break;

      case "else":
        // ELSE node - continues down center
        this.addDecisionNode(node, "ELSE", xOffset);
        this.currentY -= this.verticalSpacing;
        if (node.children && node.children.length > 0) {
          node.children.forEach((child) => {
            this.processNode(child, depth + 1, xOffset);
          });
        }
        break;

      case "for":
      case "while":
        // Loop - use decision diamond + loop-back arrow (standard flowchart)
        const loopLabel = node.type === "for" ? "FOR" : "WHILE";
        const loopStartY = this.currentY;
        const decisionY = this.currentY;
        const loopDecisionNodeIndex = this.nodes.length;
        const condition = node.condition || node.iterator || loopLabel;

        // Create decision diamond for loop condition
        const loopDecision = this.addDecisionNode(node, condition, xOffset);
        this.currentY -= this.verticalSpacing;

        if (node.children && node.children.length > 0) {
          const loopBodyStartY = this.currentY;
          const loopBodyStartNodeIndex = this.nodes.length;

          // Suppress auto-arrow for first child (we'll add explicit YES arrow)
          this.suppressNextAutoArrow = true;

          // Process loop body
          node.children.forEach((child) => {
            this.processNode(child, depth + 1, xOffset);
          });

          // Get the last node in the loop body for loop-back arrow
          const lastLoopNode = this.nodes[this.nodes.length - 1];
          const loopBodyEndY = lastLoopNode.position.y;
          const loopEndY = this.currentY;

          // Add explicit YES arrow from decision to first child in loop body
          if (this.nodes.length > loopBodyStartNodeIndex) {
            const loopDecisionNode = this.nodes[loopDecisionNodeIndex];
            const firstChildNode = this.nodes[loopBodyStartNodeIndex];
            const yesArrowStart = new THREE.Vector3(xOffset, decisionY - 4, 0);
            this.addArrow(yesArrowStart, firstChildNode.position, "normal");
          }

          // Add loop-back arrow from last node in loop body back to loop start
          this.addLoopBackArrow(
            xOffset + 12,
            loopBodyEndY,
            xOffset,
            loopStartY,
          );

          // Add NO exit path (to the left, down past loop, then back to center)
          this.addNoExitPath(xOffset, decisionY, loopEndY);
        }
        break;

      case "try":
        this.addProcessNode(node, "TRY", xOffset);
        if (node.children && node.children.length > 0) {
          this.currentY -= this.verticalSpacing;
          node.children.forEach((child) => {
            this.processNode(child, depth + 1, xOffset);
          });
        }
        break;

      case "catch":
      case "except":
        this.addProcessNode(node, node.type.toUpperCase(), xOffset);
        if (node.children && node.children.length > 0) {
          this.currentY -= this.verticalSpacing;
          node.children.forEach((child) => {
            this.processNode(child, depth + 1, xOffset);
          });
        }
        break;

      default:
        // Other nodes - process in center column
        if (node.children && node.children.length > 0) {
          console.log(
            `🔍 Unknown node type '${node.type}', processing children...`,
          );
          node.children.forEach((child) => {
            this.processNode(child, depth, xOffset);
          });
        } else if (
          node.name &&
          node.type !== "property" &&
          node.type !== "field"
        ) {
          this.addProcessNode(node, node.name, xOffset);
        }
        break;
    }
  }

  addStartNode() {
    // 2D rounded rectangle for start
    const geometry = new THREE.CylinderGeometry(3, 3, 0.5, 32);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.start,
      emissive: this.colors.start,
      emissiveIntensity: 0.5,
    });
    const cylinder = new THREE.Mesh(geometry, material);
    cylinder.position.set(this.currentX, this.currentY, 0);
    cylinder.userData.nodeType = "start";
    cylinder.userData.label = "START";
    cylinder.userData.description = "Program Entry Point";

    const label = this.createLabel("START", this.colors.start);
    label.position.set(this.currentX, this.currentY, 1);

    this.flowchartGroup.add(cylinder);
    this.flowchartGroup.add(label);
    this.nodes.push({
      type: "start",
      position: cylinder.position.clone(),
      node: cylinder,
    });
  }

  addEndNode() {
    // 2D rounded rectangle for end
    const geometry = new THREE.CylinderGeometry(3, 3, 0.5, 32);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.end,
      emissive: this.colors.end,
      emissiveIntensity: 0.5,
    });
    const cylinder = new THREE.Mesh(geometry, material);
    cylinder.position.set(this.currentX, this.currentY, 0);
    cylinder.userData.nodeType = "end";
    cylinder.userData.label = "END";
    cylinder.userData.description = "Program Exit Point";

    const label = this.createLabel("END", this.colors.end);
    label.position.set(this.currentX, this.currentY, 1);

    this.flowchartGroup.add(cylinder);
    this.flowchartGroup.add(label);
    this.nodes.push({
      type: "end",
      position: cylinder.position.clone(),
      node: cylinder,
    });

    // Add arrow from previous node to end
    if (this.nodes.length > 1) {
      const prevNode = this.nodes[this.nodes.length - 2];
      this.addArrow(prevNode.position, cylinder.position);
    }
  }

  addProcessNode(node, text, xOffset = 0) {
    // 2D flat rectangle for process
    const geometry = new THREE.BoxGeometry(
      this.nodeWidth,
      this.nodeHeight,
      0.5,
    );
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.process,
      emissive: this.colors.process,
      emissiveIntensity: 0.3,
    });
    const box = new THREE.Mesh(geometry, material);
    box.position.set(xOffset, this.currentY, 0);
    box.userData.node = node;
    box.userData.nodeType = "process";
    box.userData.label = text;
    box.userData.description = node.name
      ? `Process: ${node.name}`
      : "Process Block";
    if (node.body) box.userData.codeSnippet = node.body;

    const label = this.createLabel(text.substring(0, 20), 0xffffff);
    label.position.set(xOffset, this.currentY, 1);

    this.flowchartGroup.add(box);
    this.flowchartGroup.add(label);

    // Add arrow from previous node (unless suppressed)
    if (this.nodes.length > 0 && !this.suppressNextAutoArrow) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addArrow(prevNode.position, box.position);
    }
    this.suppressNextAutoArrow = false; // Reset flag

    this.nodes.push({
      type: "process",
      position: box.position.clone(),
      node: box,
      astNode: node,
    });
    this.currentY -= this.verticalSpacing;
  }

  addDecisionNode(node, text, xOffset = 0) {
    // Create 2D diamond shape (flat plane in diamond orientation)
    const shape = new THREE.Shape();
    shape.moveTo(0, 4);
    shape.lineTo(4, 0);
    shape.lineTo(0, -4);
    shape.lineTo(-4, 0);
    shape.lineTo(0, 4);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.5,
      bevelEnabled: false,
    });
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.decision,
      emissive: this.colors.decision,
      emissiveIntensity: 0.4,
    });
    const diamond = new THREE.Mesh(geometry, material);
    diamond.position.set(xOffset, this.currentY, 0);
    diamond.userData.node = node;
    diamond.userData.nodeType = "decision";
    diamond.userData.label = text;
    diamond.userData.description = node.condition
      ? `Decision: ${node.condition}`
      : "Conditional Branch";

    const label = this.createLabel(text.substring(0, 15), 0xffffff);
    label.position.set(xOffset, this.currentY, 1);

    this.flowchartGroup.add(diamond);
    this.flowchartGroup.add(label);

    // Add arrow from previous node (unless suppressed)
    if (this.nodes.length > 0 && !this.suppressNextAutoArrow) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addArrow(prevNode.position, diamond.position, "decision");
    }
    this.suppressNextAutoArrow = false; // Reset flag

    // Add YES/NO labels for context
    const yesLabel = this.createLabel("YES", 0x00ff00, 0.6);
    yesLabel.position.set(xOffset - 3, this.currentY - 6, 0); // Below diamond (YES goes down)
    this.flowchartGroup.add(yesLabel);

    const noLabel = this.createLabel("NO", 0xff0000, 0.6);
    noLabel.position.set(xOffset - 8, this.currentY - 1, 0); // Left of diamond (NO exits left)
    this.flowchartGroup.add(noLabel);

    this.nodes.push({
      type: "decision",
      position: diamond.position.clone(),
      node: diamond,
      astNode: node,
    });

    return diamond; // Return node for branching logic
  }

  addLoopNode(node, text, xOffset = 0) {
    // Create 2D hexagon for loops
    const geometry = new THREE.CylinderGeometry(4, 4, 0.5, 6);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.loop,
      emissive: this.colors.loop,
      emissiveIntensity: 0.4,
    });
    const hex = new THREE.Mesh(geometry, material);
    hex.position.set(xOffset, this.currentY, 0);
    hex.userData.node = node;
    hex.userData.nodeType = "loop";
    hex.userData.label = text;
    hex.userData.description = node.iterator
      ? `Loop: ${text} (${node.iterator})`
      : `Loop: ${text}`;
    if (node.condition) hex.userData.condition = node.condition;

    const label = this.createLabel(text, 0xffffff);
    label.position.set(xOffset, this.currentY, 1);

    this.flowchartGroup.add(hex);
    this.flowchartGroup.add(label);

    // Add arrow from previous node
    if (this.nodes.length > 0) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addArrow(prevNode.position, hex.position);
    }

    this.nodes.push({
      type: "loop",
      position: hex.position.clone(),
      node: hex,
      astNode: node,
    });
  }

  addFunctionNode(node, xOffset = 0) {
    // 2D rounded rectangle for function calls
    const geometry = new THREE.CylinderGeometry(5, 5, 0.5, 32);
    geometry.scale(1.5, 0.8, 1);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.functionCall,
      emissive: this.colors.functionCall,
      emissiveIntensity: 0.4,
    });
    const cylinder = new THREE.Mesh(geometry, material);
    cylinder.position.set(xOffset, this.currentY, 0);
    cylinder.rotation.z = Math.PI / 2;
    cylinder.userData.node = node;
    cylinder.userData.nodeType = "function";

    const functionName = node.name || "function";
    cylinder.userData.label = functionName;
    cylinder.userData.description = `Function: ${functionName}`;
    if (node.parameters) cylinder.userData.parameters = node.parameters;

    const label = this.createLabel(functionName.substring(0, 15), 0xffffff);
    label.position.set(xOffset, this.currentY, 1);

    this.flowchartGroup.add(cylinder);
    this.flowchartGroup.add(label);

    // Add arrow from previous node
    if (this.nodes.length > 0) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addArrow(prevNode.position, cylinder.position);
    }

    this.nodes.push({
      type: "function",
      position: cylinder.position.clone(),
      node: cylinder,
      astNode: node,
    });
  }

  addErrorNode(errorText) {
    // 2D error box
    const geometry = new THREE.BoxGeometry(
      this.nodeWidth + 2,
      this.nodeHeight + 2,
      0.5,
    );
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.error,
      emissive: this.colors.error,
      emissiveIntensity: 0.6,
    });
    const box = new THREE.Mesh(geometry, material);
    box.position.set(this.currentX, this.currentY, 0);
    box.userData.nodeType = "error";
    box.userData.errorText = errorText;
    box.userData.label = "ERROR";
    box.userData.description = `Error: ${errorText}`;

    // Add warning symbol (triangle)
    const warnGeometry = new THREE.ConeGeometry(2, 3, 3);
    const warnMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const warn = new THREE.Mesh(warnGeometry, warnMaterial);
    warn.position.set(this.currentX - 4, this.currentY, 2);
    warn.rotation.z = Math.PI;

    const label = this.createLabel("ERROR", 0xffffff);
    label.position.set(this.currentX, this.currentY + 1, 2);

    const errorLabel = this.createLabel(
      errorText.substring(0, 30),
      0xff8888,
      0.5,
    );
    errorLabel.position.set(this.currentX, this.currentY - 1, 2);

    this.flowchartGroup.add(box);
    this.flowchartGroup.add(warn);
    this.flowchartGroup.add(label);
    this.flowchartGroup.add(errorLabel);

    // Add broken arrow from previous node
    if (this.nodes.length > 0) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addBrokenArrow(prevNode.position, box.position);
    }

    this.nodes.push({
      type: "error",
      position: box.position.clone(),
      node: box,
    });
    this.errorNodes.push(box);
  }

  addWarningNode(warningText) {
    const geometry = new THREE.BoxGeometry(this.nodeWidth, this.nodeHeight, 2);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.warning,
      emissive: this.colors.warning,
      emissiveIntensity: 0.4,
    });
    const box = new THREE.Mesh(geometry, material);
    box.position.set(this.currentX, this.currentY, 0);
    box.userData.nodeType = "warning";

    const label = this.createLabel(warningText.substring(0, 25), 0xffffff, 0.7);
    label.position.set(this.currentX, this.currentY, 2);

    this.flowchartGroup.add(box);
    this.flowchartGroup.add(label);

    if (this.nodes.length > 0) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addArrow(prevNode.position, box.position, "warning");
    }

    this.nodes.push({
      type: "warning",
      position: box.position.clone(),
      node: box,
    });
  }

  // Semantic Analysis Methods
  processStatement(node, xOffset = 0) {
    const code = node.name || node.body || "";

    // Input detection patterns for multiple languages
    const inputPatterns = [
      /input\s*\(/i, // Python: input() or int(input())
      /Console\.ReadLine/i, // C#: Console.ReadLine()
      /Console\.Read\b/i, // C#: Console.Read()
      /int\.Parse.*Console\.ReadLine/i, // C#: int.Parse(Console.ReadLine())
      /scanf\s*\(/i, // C: scanf()
      /cin\s*>>/i, // C++: cin >>
      /gets\s*\(/i, // C: gets()
      /fgets\s*\(/i, // C: fgets()
      /readline\s*\(/i, // JS/PHP: readline()
      /^\w+\s*=\s*\d+$/, // Initial value: num = 29
      /^\w+\s*=\s*(True|False)$/i, // Boolean: flag = False
      /^\w+\s*=\s*['"][^'"]*['"]$/, // String: name = "John"
    ];

    // Output detection patterns for multiple languages
    const outputPatterns = [
      /print\s*\(/i, // Python: print()
      /Console\.WriteLine/i, // C#: Console.WriteLine()
      /Console\.Write\b/i, // C#: Console.Write()
      /printf\s*\(/i, // C: printf()
      /cout\s*<</i, // C++: cout <<
      /puts\s*\(/i, // C: puts()
      /echo\s+/i, // PHP: echo
    ];

    // Check for input operations
    const isInput = inputPatterns.some((pattern) => pattern.test(code));
    if (isInput) {
      this.addInputNode(node, code, xOffset);
      return;
    }

    // Check for output operations
    const isOutput = outputPatterns.some((pattern) => pattern.test(code));
    if (isOutput) {
      this.addOutputNode(node, code, xOffset);
      return;
    }

    // Otherwise treat as process (assignment, calculation, etc.)
    this.addProcessNode(node, code, xOffset);
  }

  addInputNode(node, code, xOffset = 0) {
    // Create 2D parallelogram (slanted left) for input
    const shape = new THREE.Shape();
    shape.moveTo(-1, -3);
    shape.lineTo(5, -3);
    shape.lineTo(7, 3);
    shape.lineTo(1, 3);
    shape.lineTo(-1, -3);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.5,
      bevelEnabled: false,
    });
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.input,
      emissive: this.colors.input,
      emissiveIntensity: 0.4,
    });
    const parallelogram = new THREE.Mesh(geometry, material);
    parallelogram.position.set(xOffset, this.currentY, 0);
    parallelogram.userData.node = node;
    parallelogram.userData.nodeType = "input";

    // Extract variable name from input statement
    let varName = "Input";
    const pythonMatch = code.match(/(\w+)\s*=\s*input/i);
    const csharpMatch = code.match(/(\w+)\s*=\s*Console\.ReadLine/i);
    const cMatch = code.match(/scanf\s*\([^,]+,\s*&(\w+)/i);
    const cppMatch = code.match(/cin\s*>>\s*(\w+)/i);
    const assignmentMatch = code.match(/^(\w+)\s*=/); // Simple assignment: num = 29

    if (pythonMatch) varName = pythonMatch[1];
    else if (csharpMatch) varName = csharpMatch[1];
    else if (cMatch) varName = cMatch[1];
    else if (cppMatch) varName = cppMatch[1];
    else if (assignmentMatch) varName = assignmentMatch[1];

    // Get the value being assigned for display
    const valueMatch = code.match(/=\s*(.+)$/);
    const displayText = valueMatch
      ? `${varName} = ${valueMatch[1].trim()}`
      : `Input: ${varName}`;

    parallelogram.userData.label = displayText;
    parallelogram.userData.description = `Input: ${displayText}`;
    parallelogram.userData.code = code.substring(0, 50);

    const label = this.createLabel(varName.substring(0, 15), 0xffffff);
    label.position.set(xOffset, this.currentY, 1);

    this.flowchartGroup.add(parallelogram);
    this.flowchartGroup.add(label);

    // Add arrow from previous node (unless suppressed)
    if (this.nodes.length > 0 && !this.suppressNextAutoArrow) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addArrow(prevNode.position, parallelogram.position);
    }
    this.suppressNextAutoArrow = false; // Reset flag

    this.nodes.push({
      type: "input",
      position: parallelogram.position.clone(),
      node: parallelogram,
      astNode: node,
    });
    this.currentY -= this.verticalSpacing;
  }

  addOutputNode(node, code, xOffset = 0) {
    // Create 2D parallelogram for output (standard flowchart convention - I/O uses parallelogram!)
    const shape = new THREE.Shape();
    shape.moveTo(-7, 3);
    shape.lineTo(-5, -3);
    shape.lineTo(1, -3);
    shape.lineTo(-1, 3);
    shape.lineTo(-7, 3);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.5,
      bevelEnabled: false,
    });
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.output,
      emissive: this.colors.output,
      emissiveIntensity: 0.4,
    });
    const parallelogram = new THREE.Mesh(geometry, material);
    parallelogram.position.set(xOffset, this.currentY, 0);
    parallelogram.userData.node = node;
    parallelogram.userData.nodeType = "output";

    // Extract what's being printed
    let outputContent = "Output";
    const pythonMatch = code.match(/print\s*\(([^)]+)\)/i);
    const csharpMatch = code.match(/Console\.WriteLine?\s*\(([^)]+)\)/i);
    const cMatch = code.match(/printf\s*\([^,]*,?\s*([^)]*)\)/i);
    const cppMatch = code.match(/cout\s*<<\s*(.+?)(;|$)/i);

    if (pythonMatch) outputContent = pythonMatch[1].substring(0, 20);
    else if (csharpMatch) outputContent = csharpMatch[1].substring(0, 20);
    else if (cMatch && cMatch[1]) outputContent = cMatch[1].substring(0, 20);
    else if (cppMatch) outputContent = cppMatch[1].substring(0, 20);

    parallelogram.userData.label = `Output: ${outputContent}`;
    parallelogram.userData.description = `Display: ${outputContent}`;
    parallelogram.userData.code = code.substring(0, 50);

    const label = this.createLabel(outputContent.substring(0, 15), 0xffffff);
    label.position.set(xOffset, this.currentY, 1);

    this.flowchartGroup.add(parallelogram);
    this.flowchartGroup.add(label);

    // Add arrow from previous node (unless suppressed)
    if (this.nodes.length > 0 && !this.suppressNextAutoArrow) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.addArrow(prevNode.position, parallelogram.position);
    }
    this.suppressNextAutoArrow = false; // Reset flag

    this.nodes.push({
      type: "output",
      position: parallelogram.position.clone(),
      node: parallelogram,
      astNode: node,
    });
    this.currentY -= this.verticalSpacing;
  }

  addArrow(from, to, type = "normal") {
    // Use straight orthogonal arrows for clean flowchart
    const arrowColor =
      type === "decision"
        ? this.colors.decision
        : type === "warning"
          ? this.colors.warning
          : 0x00ff88;

    // Create straight vertical line (flowcharts flow vertically)
    const points = [from.clone(), to.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: arrowColor,
      linewidth: 2,
    });
    const line = new THREE.Line(geometry, material);
    this.flowchartGroup.add(line);

    // Arrow head pointing down
    const arrowGeometry = new THREE.ConeGeometry(0.5, 2, 8);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: arrowColor });
    const arrowHead = new THREE.Mesh(arrowGeometry, arrowMaterial);

    arrowHead.position.copy(to);
    // Point downward (negative Y direction)
    const direction = new THREE.Vector3(0, -1, 0);
    arrowHead.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction,
    );

    this.flowchartGroup.add(arrowHead);
    this.arrows.push({ line, arrowHead, from, to });
  }

  addBrokenArrow(from, to) {
    // Dashed/broken arrow for error flows
    const points = [from.clone(), to.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: this.colors.error,
      linewidth: 2,
      dashSize: 1,
      gapSize: 0.5,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    this.flowchartGroup.add(line);

    // X mark instead of arrow
    const xGeometry = new THREE.BufferGeometry();
    const xVertices = new Float32Array([
      -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0,
    ]);
    xGeometry.setAttribute("position", new THREE.BufferAttribute(xVertices, 3));
    const xMaterial = new THREE.LineBasicMaterial({ color: this.colors.error });
    const xMark = new THREE.LineSegments(xGeometry, xMaterial);
    xMark.position.copy(to);

    this.flowchartGroup.add(xMark);
  }

  addStraightArrow(from, to, type = "normal") {
    // Straight orthogonal arrow (for proper flowchart connections)
    const arrowColor =
      type === "branch"
        ? 0x00ff00
        : type === "merge"
          ? 0x00aaff
          : type === "decision"
            ? this.colors.decision
            : 0x00ff88;

    // Create orthogonal path (straight lines)
    const points = [];
    points.push(from.clone());

    // If horizontal distance is significant, add intermediate points
    if (Math.abs(to.x - from.x) > 5) {
      const midY = (from.y + to.y) / 2;
      points.push(new THREE.Vector3(from.x, midY, 0));
      points.push(new THREE.Vector3(to.x, midY, 0));
    }

    points.push(to.clone());

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: arrowColor,
      linewidth: 2,
    });
    const line = new THREE.Line(geometry, material);
    this.flowchartGroup.add(line);

    // Arrow head
    const direction = new THREE.Vector3()
      .subVectors(to, points[points.length - 2])
      .normalize();
    const arrowGeometry = new THREE.ConeGeometry(0.5, 2, 8);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: arrowColor });
    const arrowHead = new THREE.Mesh(arrowGeometry, arrowMaterial);

    arrowHead.position.copy(to);
    arrowHead.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction,
    );

    this.flowchartGroup.add(arrowHead);
    this.arrows.push({ line, arrowHead, from, to });
  }

  addBranchLabel(text, x, y) {
    // Add YES/NO or other branch labels
    const color =
      text === "YES" ? 0x00ff00 : text === "NO" ? 0xff0000 : 0xffffff;
    const label = this.createLabel(text, color, 0.8);
    label.position.set(x, y, 1);
    this.flowchartGroup.add(label);
  }

  addLoopBackArrow(fromX, fromY, toX, toY) {
    // Orthogonal loop-back arrow (right, up, left pattern)
    const loopColor = 0x9370db; // Purple for loop

    // Create orthogonal path: go right, then up, then left to loop start
    const rightOffset = 15; // How far right to go
    const points = [
      new THREE.Vector3(fromX, fromY, 0), // Start at bottom of loop
      new THREE.Vector3(fromX + rightOffset, fromY, 0), // Go right
      new THREE.Vector3(fromX + rightOffset, toY, 0), // Go up
      new THREE.Vector3(toX, toY, 0), // Go left back to start
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: loopColor,
      linewidth: 3,
    });
    const line = new THREE.Line(geometry, material);
    this.flowchartGroup.add(line);

    // Arrow head pointing left (back to loop start)
    const arrowGeometry = new THREE.ConeGeometry(0.8, 2.5, 8);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: loopColor });
    const arrowHead = new THREE.Mesh(arrowGeometry, arrowMaterial);

    arrowHead.position.copy(new THREE.Vector3(toX, toY, 0));
    // Point left (negative X direction)
    const direction = new THREE.Vector3(-1, 0, 0);
    arrowHead.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction,
    );

    this.flowchartGroup.add(arrowHead);

    // Add "REPEAT" label on the right side
    const repeatLabel = this.createLabel("REPEAT", loopColor, 0.7);
    repeatLabel.position.set(fromX + rightOffset + 2, (fromY + toY) / 2, 1);
    this.flowchartGroup.add(repeatLabel);

    // Store arrow with from/to positions for flow analysis
    const fromPos = new THREE.Vector3(fromX, fromY, 0);
    const toPos = new THREE.Vector3(toX, toY, 0);
    this.arrows.push({ line, arrowHead, from: fromPos, to: toPos });
  }

  addNoExitPath(xOffset, decisionY, loopEndY) {
    // Draw NO path: from decision diamond, go left, down past loop, then back to center
    const leftOffset = -15; // How far left to go
    const noColor = 0xff6b6b; // Light red for NO path

    const points = [
      new THREE.Vector3(xOffset + 4, decisionY, 0), // Start at diamond (left side)
      new THREE.Vector3(xOffset + leftOffset, decisionY, 0), // Go left
      new THREE.Vector3(xOffset + leftOffset, loopEndY, 0), // Go down past loop
      new THREE.Vector3(xOffset, loopEndY, 0), // Back to center
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: noColor,
      linewidth: 2,
      opacity: 0.7,
      transparent: true,
    });
    const line = new THREE.Line(geometry, material);
    this.flowchartGroup.add(line);

    // Store arrow for flow analysis
    const fromPos = points[0];
    const toPos = points[points.length - 1];
    this.arrows.push({ line, from: fromPos, to: toPos });
  }

  detectFlowIssues() {
    // Detect potential issues in flow:
    // - Unreachable code (nodes not connected to flow)
    // - Missing returns
    // - Infinite loops without break

    console.log("🔍 Detecting flow issues...");

    // Check for nodes that have no incoming connections
    this.nodes.forEach((node, index) => {
      if (index === 0) return; // Skip start node

      const hasIncoming = this.arrows.some(
        (arrow) => arrow.to.distanceTo(node.position) < 1,
      );

      if (!hasIncoming && node.type !== "start") {
        console.warn("⚠️ Unreachable code detected at node:", node.type);
        // Highlight unreachable nodes
        if (node.node && node.node.material) {
          node.node.material.opacity = 0.3;
          node.node.material.transparent = true;
        }
      }
    });
  }

  createLabel(text, color = 0xffffff, scale = 1.0) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = 512;
    canvas.height = 128;

    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.font = "bold 48px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(8 * scale, 2 * scale, 1);

    return sprite;
  }

  clear() {
    if (this.flowchartGroup) {
      this.scene.remove(this.flowchartGroup);
    }
    this.nodes = [];
    this.arrows = [];
    this.errorNodes = [];
  }
}
