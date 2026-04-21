/**
 * Visualizer - Core visualization logic independent of UI/DOM
 * Pure visualization engine that can work in any context (web, extension, etc.)
 */

import { CodeParser } from "./CodeParser.js";
import { VisualizationEngine } from "./VisualizationEngine.js";

export class Visualizer {
  constructor(scene) {
    if (!scene) {
      throw new Error("Visualizer requires a Three.js scene");
    }

    this.scene = scene;
    this.visualizationEngine = new VisualizationEngine(scene);
    this.parser = new CodeParser();
    this.currentVisualization = null;
    this.currentAST = null;
    this.sourceCode = "";
    this.sourceCodeLines = [];
    this.loadedFiles = [];
    this.parsedFiles = [];
    this.nodeMap = {}; // Map for click-to-code navigation
  }

  /**
   * Parse and visualize code
   * @param {string} code - Source code to visualize
   * @param {string} language - Language (python, php, csharp)
   * @param {Object} options - Visualization options
   * @returns {Object} Result with AST and visualization
   */
  visualizeCode(code, language, options = {}) {
    if (!code || !code.trim()) {
      throw new Error("Code cannot be empty");
    }

    const normalizedLanguage = this.normalizeLanguage(language);

    try {
      // Parse code
      const ast = this.parser.parse(code, normalizedLanguage);

      if (!ast) {
        throw new Error("Parser returned null or undefined");
      }

      if (ast.error) {
        throw new Error(`Parse error: ${ast.error}`);
      }

      if (!ast.children || ast.children.length === 0) {
        throw new Error(
          "No code structures found. Ensure your code contains classes, functions, or control structures."
        );
      }

      // Store for reference
      this.sourceCode = code;
      this.sourceCodeLines = code.split("\n");
      this.currentAST = ast;

      // Create visualization
      const visualization = this.createVisualization(ast, options);

      // Store node references for click-to-code
      this.storeNodeReferences(ast);

      return {
        success: true,
        ast,
        visualization,
        metrics: this.extractMetrics(ast),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        ast: null,
        visualization: null,
      };
    }
  }

  /**
   * Visualize multiple files combined
   * @param {Array} files - Array of {name, content, language}
   * @param {Object} options - Visualization options
   * @returns {Object} Result with combined AST and visualization
   */
  visualizeFiles(files, options = {}) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("Files must be a non-empty array");
    }

    try {
      this.loadedFiles = files;
      this.parsedFiles = [];

      // Parse all files
      for (const file of files) {
        try {
          const language = this.normalizeLanguage(file.language);
          const ast = this.parser.parse(file.content, language);

          if (ast && !ast.error && ast.children && ast.children.length > 0) {
            ast.fileName = file.name;
            ast.filePath  = file.path || file.name;
            ast.language = language;
            this.parsedFiles.push(ast);
          }
        } catch (error) {
          console.warn(`Warning parsing ${file.name}:`, error.message);
        }
      }

      if (this.parsedFiles.length === 0) {
        throw new Error("No valid code structures found in any file");
      }

      // Combine ASTs
      const combinedAST = this.combineASTs(this.parsedFiles);

      // Resolve relationships
      this.resolveRelationships(combinedAST);

      // Store for reference
      this.currentAST = combinedAST;
      if (files.length > 0) {
        this.sourceCode = files[0].content;
        this.sourceCodeLines = files[0].content.split("\n");
      }

      // Create visualization
      const visualization = this.createVisualization(combinedAST, options);

      // Store node references
      this.storeNodeReferences(combinedAST);

      return {
        success: true,
        ast: combinedAST,
        visualization,
        filesProcessed: this.parsedFiles.length,
        metrics: this.extractMetrics(combinedAST),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        ast: null,
        visualization: null,
      };
    }
  }

  /**
   * Create visualization without DOM dependencies
   * @private
   */
  createVisualization(ast, options) {
    const defaultOptions = {
      viewMode: "city",
      layoutMode: "grouped",
      colorScheme: "default",
    };

    const finalOptions = { ...defaultOptions, ...options };

    // Clear previous
    this.clear();

    // Create new visualization
    return this.visualizationEngine.createVisualization(ast, finalOptions);
  }

  /**
   * Combine multiple ASTs into one
   * @private
   */
  combineASTs(asts) {
    const combined = {
      type: "module",
      name: "multi-file",
      children: [],
      lineStart: 1,
      lineEnd: 0,
      complexity: 0,
    };

    for (const ast of asts) {
      if (ast && ast.children && Array.isArray(ast.children)) {
        ast.children.forEach((child) => {
          if (child) {
            child.fileName = ast.fileName || "unknown";
            // Propagate fileName and filePath to all descendants
            if (ast.filePath) child.filePath = child.filePath || ast.filePath;
            const propagate = (node, fn, fp) => {
              if (!node) return;
              if (!node.fileName) node.fileName = fn;
              if (!node.filePath) node.filePath = fp;
              (node.children||[]).forEach(c => propagate(c, fn, fp));
              (node.members||[]).forEach(m => { if(!m.fileName) m.fileName=fn; if(!m.filePath) m.filePath=fp; });
            };
            propagate(child, child.fileName, child.filePath);
            combined.children.push(child);
          }
        });
      }
    }

    return combined;
  }

  /**
   * Resolve cross-file relationships
   * @private
   */
  resolveRelationships(ast) {
    const findClass = (className) => {
      for (const child of ast.children) {
        if (
          child &&
          (child.type === "class" || child.type === "abstractClass") &&
          child.name === className
        ) {
          return child;
        }
      }
      return null;
    };

    const findMethod = (classNode, methodName) => {
      if (!classNode || !classNode.children) return null;
      for (const child of classNode.children) {
        if (child && child.type === "method" && child.name === methodName) {
          return child;
        }
      }
      return null;
    };

    for (const classNode of ast.children) {
      if (
        !classNode ||
        (classNode.type !== "class" && classNode.type !== "abstractClass")
      )
        continue;
      if (
        !classNode.children ||
        !classNode.inherits ||
        classNode.inherits.length === 0
      )
        continue;

      const parentClass = findClass(classNode.inherits[0]);
      if (!parentClass) continue;

      for (const method of classNode.children) {
        if (!method || method.type !== "method") continue;

        const hasOverride =
          method.modifiers && method.modifiers.includes("override");
        if (!hasOverride) continue;

        const parentMethod = findMethod(parentClass, method.name);
        if (parentMethod) {
          const isVirtualOrAbstract =
            (parentMethod.modifiers &&
              (parentMethod.modifiers.includes("virtual") ||
                parentMethod.modifiers.includes("abstract"))) ||
            parentMethod.isVirtual ||
            parentMethod.isAbstract;

          if (isVirtualOrAbstract) {
            method.overrides = parentMethod.name;
          }
        }
      }
    }
  }

  /**
   * Store node references for click-to-code navigation
   * @private
   */
  storeNodeReferences(ast) {
    this.nodeMap = {};

    const traverse = (node, path = "") => {
      if (!node) return;

      if (node.name && (node.lineStart !== undefined || node.lineEnd !== undefined)) {
        const key = `${path}${path ? "." : ""}${node.name}`;
        this.nodeMap[key] = {
          node,
          startLine: node.lineStart,
          endLine: node.lineEnd,
          type: node.type,
        };
      }

      if (node.children && Array.isArray(node.children)) {
        const newPath = node.name ? `${path}${path ? "." : ""}${node.name}` : path;
        node.children.forEach((child) => traverse(child, newPath));
      }
    };

    traverse(ast);
  }

  /**
   * Extract metrics from AST
   * @private
   */
  extractMetrics(ast) {
    const metrics = {
      classCount: 0,
      methodCount: 0,
      totalComplexity: 0,
      maxComplexity: 0,
    };

    const traverse = (node) => {
      if (!node) return;

      if (node.type === "class" || node.type === "abstractClass") {
        metrics.classCount++;
      }

      if (node.type === "method" || node.type === "function") {
        metrics.methodCount++;
        if (node.complexity) {
          metrics.totalComplexity += node.complexity;
          metrics.maxComplexity = Math.max(metrics.maxComplexity, node.complexity);
        }
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(traverse);
      }
    };

    if (ast && ast.children) {
      ast.children.forEach(traverse);
    }

    return metrics;
  }

  /**
   * Get code for a specific node (used for click-to-code)
   */
  getCodeForNode(nodeName) {
    const nodeInfo = this.nodeMap[nodeName];
    if (!nodeInfo || !nodeInfo.startLine || !nodeInfo.endLine) {
      return null;
    }

    const start = Math.max(0, nodeInfo.startLine - 1);
    const end = Math.min(
      this.sourceCodeLines.length - 1,
      nodeInfo.endLine - 1
    );

    return this.sourceCodeLines.slice(start, end + 1).join("\n");
  }

  /**
   * Clear visualization
   */
  clear() {
    this.visualizationEngine.clear();
    this.currentVisualization = null;
    this.nodeMap = {};
  }

  /**
   * Get scene object
   */
  getScene() {
    return this.scene;
  }

  /**
   * Get current visualization
   */
  getCurrentVisualization() {
    return this.currentVisualization;
  }

  /**
   * Get current AST
   */
  getCurrentAST() {
    return this.currentAST;
  }

  /**
   * Normalize language input
   * @private
   */
  normalizeLanguage(language) {
    if (!language) return "python";
    const normalized = language.toLowerCase().trim();
    const mapping = {
      py: "python",
      python: "python",
      php: "php",
      cs: "csharp",
      csharp: "csharp",
      "c#": "csharp",
    };
    return mapping[normalized] || "python";
  }
}
