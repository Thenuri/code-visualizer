/**
 * Enhanced Code Parser
 * Extracts classes, functions, methods, control structures, class members, and inheritance
 */
export class CodeParser {
  parse(code, language) {
    if (language === "python") {
      return this.parsePython(code);
    } else if (language === "php") {
      return this.parsePHP(code);
    } else if (language === "csharp") {
      return this.parseCSharp(code);
    }
    return { error: "Unsupported language" };
  }

  parsePython(code) {
    const lines = code.split("\n");
    const ast = {
      type: "module",
      name: "main",
      children: [],
      lineStart: 1,
      lineEnd: lines.length,
      complexity: 0,
    };

    let lineNumber = 0;
    let indentStack = [{ node: ast, indent: -1 }];
    let pendingAbstract = false;

    for (const line of lines) {
      lineNumber++;
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Track @abstractmethod decorator for the next def
      if (trimmed.startsWith("@")) {
        if (trimmed.includes("abstractmethod")) pendingAbstract = true;
        continue;
      }

      const indent = line.length - line.trimStart().length;
      const indentLevel = Math.floor(indent / 4);

      // Pop stack to correct level
      while (
        indentStack.length > 1 &&
        indentStack[indentStack.length - 1].indent >= indentLevel
      ) {
        indentStack.pop();
      }

      const parent = indentStack[indentStack.length - 1].node;

      // Check for abstract class (Python: ABC or abstractmethod)
      const abstractClassMatch = trimmed.match(
        /^class\s+(\w+).*ABC|.*abstract|from\s+abc\s+import/,
      );
      const isAbstract =
        abstractClassMatch !== null ||
        trimmed.includes("ABC") ||
        trimmed.includes("abstract");

      // Check for class (including generics/templates)
      const classMatch = trimmed.match(/^class\s+(\w+)(?:\s*\(([^)]+)\))?/);
      if (classMatch) {
        const className = classMatch[1];
        const inheritance = classMatch[2]
          ? classMatch[2].split(",").map((s) => s.trim())
          : [];

        // Check for generics in inheritance (Python doesn't have class-level generics like C#/Java)
        // But we can detect them in type hints if present
        const generics = [];

        // Check if this is a nested class (parent is a class)
        const isNested =
          parent.type === "class" || parent.type === "abstractClass";

        const classNode = {
          type: isAbstract ? "abstractClass" : "class",
          name: className,
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          inherits: inheritance,
          members: [],
          isAbstract: isAbstract,
          isNested: isNested,
          parentClass: isNested ? parent.name : null,
          generics: generics && generics.length > 0 ? generics : null,
        };
        parent.children.push(classNode);
        indentStack.push({ node: classNode, indent: indentLevel });
        continue;
      }

      // Check for function/method (including generics and overloading)
      const funcMatch = trimmed.match(/^def\s+(\w+)\s*\(/);
      if (funcMatch) {
        const methodName = funcMatch[1];
        // Extract parameters from the line (may be incomplete if multi-line)
        const paramMatch = trimmed.match(/\(([^)]*)\)/);
        const params =
          paramMatch && paramMatch[1]
            ? paramMatch[1]
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s)
            : [];

        // Check for generics in type hints (Python: def method[T](...))
        const genericsMatch = trimmed.match(/\[([^\]]+)\]/);
        const generics = genericsMatch
          ? genericsMatch[1].split(",").map((s) => s.trim())
          : [];

        const isConstructor =
          methodName === "__init__" || methodName === "__new__";
        const isAbstract = pendingAbstract;
        pendingAbstract = false;

        // Check for method overriding (polymorphism)
        let overrides = null;
        if (parent.type === "class" || parent.type === "abstractClass") {
          // Check if parent class has this method
          const parentClass =
            parent.inherits && parent.inherits.length > 0
              ? this.findClassByName(ast, parent.inherits[0])
              : null;
          if (parentClass) {
            const parentMethod = this.findMethodInClass(
              parentClass,
              methodName,
            );
            if (parentMethod) {
              overrides = parentMethod.name;
            }
          }
        }

        // Check for method overloading (same name, different parameters)
        let isOverloaded = false;
        let overloadCount = 1;
        if (
          (parent.type === "class" || parent.type === "abstractClass") &&
          parent.children
        ) {
          try {
            const existingMethods = parent.children.filter(
              (c) => c && c.type === "method" && c.name === methodName,
            );
            if (existingMethods.length > 0) {
              isOverloaded = true;
              overloadCount = existingMethods.length + 1;
              // Mark all previous overloads (safely)
              existingMethods.forEach((m) => {
                if (m) {
                  m.isOverloaded = true;
                  m.overloadCount = (m.overloadCount || 1) + 1;
                }
              });
            }
          } catch (error) {
            console.warn("Error detecting method overloading:", error);
            // Continue without overloading detection
          }
        }

        // Determine access modifier based on Python naming convention
        let access = "public";
        if (methodName.startsWith("__") && !methodName.endsWith("__")) {
          access = "private"; // name-mangled methods
        } else if (methodName.startsWith("_")) {
          access = "protected"; // convention-based protected
        }

        const funcNode = {
          type:
            parent.type === "class" || parent.type === "abstractClass"
              ? "method"
              : "function",
          name: methodName,
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          controlStructures: [],
          isConstructor: isConstructor,
          isAbstract: isAbstract,
          overrides: overrides,
          access: access,
          isOverloaded: isOverloaded || false,
          overloadCount: overloadCount || 1,
          parameters: params || [],
          generics: generics && generics.length > 0 ? generics : null,
        };
        parent.children.push(funcNode);
        indentStack.push({ node: funcNode, indent: indentLevel });
        continue;
      }

      // Check for control structures (inside functions/methods, at module level, or nested in other control structures)
      const controlParentTypes = [
        "module",
        "method",
        "function",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "try",
        "except",
      ];
      if (controlParentTypes.includes(parent.type)) {
        // Find the enclosing method/function for complexity tracking
        let enclosingMethod = null;
        for (let i = indentStack.length - 1; i >= 0; i--) {
          const stackNode = indentStack[i].node;
          if (stackNode.type === "method" || stackNode.type === "function") {
            enclosingMethod = stackNode;
            break;
          }
        }
        // Complexity target: add to enclosing method if inside a nested control structure
        const complexityTarget = enclosingMethod || parent;

        // If/Elif/Else
        if (trimmed.match(/^if\s+/)) {
          const ifNode = {
            type: "if",
            name: "if",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          parent.children.push(ifNode);
          complexityTarget.complexity += 1;
          indentStack.push({ node: ifNode, indent: indentLevel });
          continue;
        }

        if (trimmed.match(/^elif\s+/)) {
          const elifNode = {
            type: "elif",
            name: "elif",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          parent.children.push(elifNode);
          complexityTarget.complexity += 1;
          indentStack.push({ node: elifNode, indent: indentLevel });
          continue;
        }

        if (trimmed.match(/^else\s*:/)) {
          const elseNode = {
            type: "else",
            name: "else",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            children: [],
          };
          parent.children.push(elseNode);
          indentStack.push({ node: elseNode, indent: indentLevel });
          continue;
        }

        // Loops
        if (trimmed.match(/^for\s+/)) {
          const forNode = {
            type: "for",
            name: "for",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          parent.children.push(forNode);
          complexityTarget.complexity += 1;
          indentStack.push({ node: forNode, indent: indentLevel });
          continue;
        }

        if (trimmed.match(/^while\s+/)) {
          const whileNode = {
            type: "while",
            name: "while",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          parent.children.push(whileNode);
          complexityTarget.complexity += 1;
          indentStack.push({ node: whileNode, indent: indentLevel });
          continue;
        }

        // Try/Except
        if (trimmed.match(/^try\s*:/)) {
          const tryNode = {
            type: "try",
            name: "try",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          parent.children.push(tryNode);
          complexityTarget.complexity += 1;
          indentStack.push({ node: tryNode, indent: indentLevel });
          continue;
        }

        if (trimmed.match(/^except/)) {
          const exceptNode = {
            type: "except",
            name: "except",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            children: [],
          };
          parent.children.push(exceptNode);
          indentStack.push({ node: exceptNode, indent: indentLevel });
          continue;
        }
      }

      // Check for class members (inside classes or methods within classes)
      // self.attribute assignments happen inside methods, so walk up the stack to find enclosing class
      const attrMatch = trimmed.match(/^self\.(\w+)\s*=/);
      if (attrMatch) {
        // Find the enclosing class by walking up the indent stack
        let enclosingClass = null;
        for (let i = indentStack.length - 1; i >= 0; i--) {
          const stackNode = indentStack[i].node;
          if (
            stackNode.type === "class" ||
            stackNode.type === "abstractClass"
          ) {
            enclosingClass = stackNode;
            break;
          }
        }

        if (enclosingClass) {
          // Check if attribute is another class instance (composition)
          const valueMatch = trimmed.match(/=\s*(\w+)\(/);
          const composedClass = valueMatch ? valueMatch[1] : null;

          // Determine access based on Python naming convention
          const attrName = attrMatch[1];
          let access = "public";
          if (attrName.startsWith("__") && !attrName.endsWith("__")) {
            access = "private";
          } else if (attrName.startsWith("_")) {
            access = "protected";
          }

          const attrNode = {
            type: "attribute",
            name: attrName,
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            access: access,
            composedClass: composedClass, // For composition detection
          };

          // Avoid adding duplicate attributes
          if (!enclosingClass.members) enclosingClass.members = [];
          const alreadyExists = enclosingClass.members.some(
            (m) => m.name === attrName,
          );
          if (!alreadyExists) {
            enclosingClass.members.push(attrNode);

            // Track composition relationship
            if (composedClass && composedClass !== enclosingClass.name) {
              if (!enclosingClass.compositions)
                enclosingClass.compositions = [];
              enclosingClass.compositions.push({
                type: "has-a",
                target: composedClass,
                member: attrNode.name,
              });
            }
          }
          continue;
        }
      }

      // Check for class-level constants (UPPER_CASE) - directly under class
      if (parent.type === "class" || parent.type === "abstractClass") {
        const constMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
        if (constMatch) {
          const constNode = {
            type: "constant",
            name: constMatch[1],
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            access: "public",
          };
          if (!parent.members) parent.members = [];
          parent.members.push(constNode);
          continue;
        }
      }

      // Capture statements (input, output, assignments, etc.) for flowchart semantic analysis
      // Only capture statements that are inside functions, methods, or control structures
      const statementParentTypes = [
        "module",
        "method",
        "function",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "try",
        "except",
      ];
      if (statementParentTypes.includes(parent.type) && trimmed.length > 0) {
        // Skip lines that are just structural keywords we already handled
        const skipPatterns = [
          /^(def|class|if|elif|else|for|while|try|except|finally|with|import|from|return|pass|break|continue)\b/i,
          /^#/, // Comments
          /^"""/, // Docstrings
        ];

        const shouldSkip = skipPatterns.some((pattern) =>
          pattern.test(trimmed),
        );
        if (!shouldSkip) {
          const statementNode = {
            type: "statement",
            name: trimmed, // Store the actual code
            body: trimmed, // Alternative property name
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
          };
          parent.children.push(statementNode);
        }
      }
    }

    // Calculate final complexity and line counts
    this.calculateMetrics(ast);
    
    // Detect object instantiation
    this.detectObjectInstantiation(ast, code, 'python');
    
    return ast;
  }

  parsePHP(code) {
    const lines = code.split("\n");
    const ast = {
      type: "module",
      name: "main",
      children: [],
      lineStart: 1,
      lineEnd: lines.length,
      complexity: 0,
    };

    let lineNumber = 0;
    let braceDepth = 0;
    let currentClass = null;
    let currentFunction = null;
    let currentBlock = null;

    for (const line of lines) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*"))
        continue;

      const prevBraceDepth = braceDepth;
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Check for interface (including inheritance)
      const interfaceMatch = trimmed.match(
        /^interface\s+(\w+)(?:\s+extends\s+([^{]+))?/,
      );
      if (interfaceMatch) {
        const inheritance = interfaceMatch[2]
          ? interfaceMatch[2].split(",").map((s) => s.trim())
          : [];
        console.log(
          `🔶 PHP: Parsing interface ${interfaceMatch[1]}, extends: ${inheritance.join(", ") || "none"}`,
        );
        currentClass = {
          type: "interface",
          name: interfaceMatch[1],
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          inherits: inheritance,
          members: [],
          isAbstract: true,
        };
        ast.children.push(currentClass);
        continue;
      }

      // Check for abstract class
      const abstractMatch = trimmed.match(
        /^abstract\s+class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/,
      );
      if (abstractMatch) {
        const inheritance = [];
        if (abstractMatch[2]) inheritance.push(abstractMatch[2]); // extends
        if (abstractMatch[3])
          inheritance.push(...abstractMatch[3].split(",").map((s) => s.trim())); // implements

        console.log(
          `🔷 PHP: Parsing abstract class ${abstractMatch[1]}, inherits: ${inheritance.join(", ") || "none"}`,
        );

        currentClass = {
          type: "abstractClass",
          name: abstractMatch[1],
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          inherits: inheritance,
          members: [],
          isAbstract: true,
        };
        ast.children.push(currentClass);
        continue;
      }

      // Check for class (including generics and nested classes)
      const classMatch = trimmed.match(
        /^class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/,
      );
      if (classMatch) {
        const className = classMatch[1];
        const extendsClass = classMatch[2] ? [classMatch[2].trim()] : [];
        const implementsList = classMatch[3]
          ? classMatch[3].split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        const inheritance = [...extendsClass, ...implementsList];

        console.log(
          `📦 PHP: Parsing class ${className}, extends: ${extendsClass.join(", ") || "none"}, implements: ${implementsList.join(", ") || "none"}`,
        );

        // PHP doesn't have native generics, but check for docblock hints
        const generics = [];

        // Check if this is a nested class (inside another class)
        const isNested = currentClass !== null;

        const newClass = {
          type: "class",
          name: className,
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          inherits: inheritance,
          implements: implementsList,
          members: [],
          isAbstract: false,
          isNested: isNested,
          parentClass: isNested ? currentClass.name : null,
          generics: generics && generics.length > 0 ? generics : null,
        };

        if (isNested) {
          currentClass.children.push(newClass);
        } else {
          ast.children.push(newClass);
        }
        currentClass = newClass;
        continue;
      }

      // Check for function/method (including abstract, static and access modifiers)
      const funcMatch = trimmed.match(
        /(?:(public|private|protected|static|abstract)\s+)*function\s+(\w+)\s*\(/,
      );
      if (funcMatch) {
        const methodName = funcMatch[2];
        // Extract access modifier from the line
        const accessMatch = trimmed.match(/\b(public|private|protected)\b/);
        const access = accessMatch ? accessMatch[1] : "public";
        // Check if it's an abstract method
        const isAbstractMethod = trimmed.includes("abstract");
        // Extract parameters (may be incomplete if multi-line)
        const paramMatch = trimmed.match(/\(([^)]*)\)/);
        const params =
          paramMatch && paramMatch[1]
            ? paramMatch[1]
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s)
            : [];
        const isConstructor =
          methodName === "__construct" ||
          (currentClass && methodName === currentClass.name);

        // Check for method overriding (polymorphism)
        let overrides = null;
        if (
          currentClass &&
          currentClass.inherits &&
          currentClass.inherits.length > 0
        ) {
          console.log(
            `🔎 PHP: Checking override for ${methodName} in ${currentClass.name}, parent: ${currentClass.inherits[0]}`,
          );
          const parentClass = this.findClassByName(
            ast,
            currentClass.inherits[0],
          );
          if (parentClass) {
            console.log(`  ✅ PHP: Found parent class: ${parentClass.name}`);
            const parentMethod = this.findMethodInClass(
              parentClass,
              methodName,
            );
            if (parentMethod) {
              overrides = parentMethod.name;
              console.log(
                `  ✅ PHP: Method ${methodName} overrides parent method!`,
              );
            } else {
              console.log(
                `  ❌ PHP: Parent class ${parentClass.name} doesn't have method ${methodName}`,
              );
            }
          } else {
            console.log(
              `  ❌ PHP: Parent class ${currentClass.inherits[0]} not found in AST`,
            );
          }
        }

        // Check for method overloading (same name, different parameters)
        let isOverloaded = false;
        let overloadCount = 1;
        if (currentClass && currentClass.children) {
          try {
            const existingMethods = currentClass.children.filter(
              (c) => c && c.type === "method" && c.name === methodName,
            );
            if (existingMethods.length > 0) {
              isOverloaded = true;
              overloadCount = existingMethods.length + 1;
              // Mark all previous overloads (safely)
              existingMethods.forEach((m) => {
                if (m) {
                  m.isOverloaded = true;
                  m.overloadCount = (m.overloadCount || 1) + 1;
                }
              });
            }
          } catch (error) {
            console.warn("Error detecting method overloading:", error);
          }
        }

        const funcNode = {
          type: currentClass ? "method" : "function",
          name: methodName,
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          controlStructures: [],
          isConstructor: isConstructor,
          isAbstract: isAbstractMethod || false,
          overrides: overrides,
          access: access,
          isOverloaded: isOverloaded || false,
          overloadCount: overloadCount || 1,
          parameters: params || [],
          _openDepth: prevBraceDepth,
        };
        if (currentClass) {
          currentClass.children.push(funcNode);
          console.log(
            `📝 PHP: Added method ${methodName} to class ${currentClass.name}${isAbstractMethod ? " (abstract)" : ""}${overrides ? " (overrides: " + overrides + ")" : ""}`,
          );
        } else {
          ast.children.push(funcNode);
        }
        currentFunction = funcNode;
        continue;
      }

      // Control structures
      if (currentFunction) {
        if (trimmed.match(/if\s*\(/)) {
          const ifNode = {
            type: "if",
            name: "if",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentFunction.children.push(ifNode);
          currentFunction.complexity += 1;
          currentBlock = ifNode;
          continue;
        }

        if (trimmed.match(/else\s*{/)) {
          const elseNode = {
            type: "else",
            name: "else",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            children: [],
          };
          currentFunction.children.push(elseNode);
          currentBlock = elseNode;
          continue;
        }

        if (trimmed.match(/for\s*\(/)) {
          const forNode = {
            type: "for",
            name: "for",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentFunction.children.push(forNode);
          currentFunction.complexity += 1;
          currentBlock = forNode;
          continue;
        }

        if (trimmed.match(/while\s*\(/)) {
          const whileNode = {
            type: "while",
            name: "while",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentFunction.children.push(whileNode);
          currentFunction.complexity += 1;
          currentBlock = whileNode;
          continue;
        }

        if (trimmed.match(/try\s*{/)) {
          const tryNode = {
            type: "try",
            name: "try",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentFunction.children.push(tryNode);
          currentFunction.complexity += 1;
          currentBlock = tryNode;
          continue;
        }

        if (trimmed.match(/catch\s*\(/)) {
          const catchNode = {
            type: "catch",
            name: "catch",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            children: [],
          };
          currentFunction.children.push(catchNode);
          currentBlock = catchNode;
          continue;
        }
      }

      // Class members
      if (currentClass && braceDepth > 0) {
        const propMatch = trimmed.match(
          /(public|private|protected|static)?\s*\$(\w+)/,
        );
        if (propMatch) {
          // Check for composition (property is another class instance)
          const valueMatch = trimmed.match(/=\s*new\s+(\w+)/);
          const composedClass = valueMatch ? valueMatch[1] : null;

          const propNode = {
            type: propMatch[1] === "static" ? "static" : "property",
            name: propMatch[2],
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            access: propMatch[1] || "public",
            composedClass: composedClass,
          };
          currentClass.members.push(propNode);

          // Track composition relationship
          if (composedClass && composedClass !== currentClass.name) {
            if (!currentClass.compositions) currentClass.compositions = [];
            currentClass.compositions.push({
              type: "has-a",
              target: composedClass,
              member: propNode.name,
            });
          }
          continue;
        }

        const constMatch = trimmed.match(/const\s+(\w+)/);
        if (constMatch) {
          const constNode = {
            type: "constant",
            name: constMatch[1],
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            access: "public",
          };
          currentClass.members.push(constNode);
          continue;
        }
      }

      // Exit method body when brace depth returns to the level it opened at
      if (
        currentFunction &&
        braceDepth < prevBraceDepth &&
        braceDepth <= currentFunction._openDepth
      ) {
        currentFunction.lineEnd = lineNumber;
        currentFunction = null;
        currentBlock = null;
      }

      if (braceDepth === 0) {
        currentClass = null;
        currentFunction = null;
        currentBlock = null;
      }
    }

    this.calculateMetrics(ast);

    // Detect object instantiation
    this.detectObjectInstantiation(ast, code, 'php');
    
    return ast;
  }

  parseCSharp(code) {
    const lines = code.split("\n");
    const ast = {
      type: "module",
      name: "main",
      children: [],
      lineStart: 1,
      lineEnd: lines.length,
      complexity: 0,
      namespace: null, // Track namespace
    };

    let lineNumber = 0;
    let braceDepth = 0;
    let currentClass = null;
    let currentMethod = null;
    let currentBlock = null;
    let currentNamespace = null; // Track current namespace

    for (const line of lines) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*"))
        continue;

      const prevBraceDepth = braceDepth;
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Check for namespace declaration
      const namespaceMatch = trimmed.match(/namespace\s+([\w.]+)/);
      if (namespaceMatch) {
        currentNamespace = namespaceMatch[1];
        ast.namespace = currentNamespace;
        continue;
      }

      // Check for interface (including inheritance)
      const interfaceMatch = trimmed.match(
        /^(public|private|protected|internal)?\s*interface\s+(\w+)(?:\s*:\s*([^{]+))?/,
      );
      if (interfaceMatch) {
        const inheritance = interfaceMatch[3]
          ? interfaceMatch[3].split(",").map((s) => s.trim())
          : [];
        console.log(`🔷 C# Interface detected: ${interfaceMatch[2]}, extends: [${inheritance.join(', ')}]`);
        currentClass = {
          type: "interface",
          name: interfaceMatch[2],
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          inherits: inheritance,
          members: [],
          isAbstract: true,
          namespace: currentNamespace || null,
          _openDepth: prevBraceDepth,
        };
        ast.children.push(currentClass);
        continue;
      }

      // Check for interface method signatures (e.g., "void Draw();" or "string GetColor();")
      // These should be added as abstract methods to the interface
      if (currentClass && currentClass.type === 'interface') {
        const interfaceMethodMatch = trimmed.match(/(\w+)\s+(\w+)\s*\([^)]*\)\s*;/);
        if (interfaceMethodMatch) {
          const returnType = interfaceMethodMatch[1];
          const methodName = interfaceMethodMatch[2];
          console.log(`  🔹 C# Interface method signature: ${returnType} ${methodName}()`);
          
          const interfaceMethodNode = {
            type: 'method',
            name: methodName,
            children: [],
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            access: 'public', // Interface members are implicitly public
            modifiers: ['abstract'],
            isAbstract: true,
            isVirtual: false,
            parameters: []
          };
          
          currentClass.children.push(interfaceMethodNode);
          console.log(`  ✅ C# Added interface method ${methodName} to ${currentClass.name}`);
          continue;
        }
      }

      // Check for abstract class (including partial, sealed, new abstract classes)
      const abstractMatch = trimmed.match(
        /^(public|private|protected|internal)?\s*((?:(?:partial|sealed|new|unsafe)\s+)+)?abstract\s+class\s+(\w+)(?:\s*:\s*([^{]+))?/,
      );
      if (abstractMatch) {
        const inheritance = abstractMatch[4]
          ? abstractMatch[4].split(",").map((s) => s.trim())
          : [];
        const isPartial = /\bpartial\b/.test(abstractMatch[2] || "");
        console.log(
          `🟣 C# Abstract class detected: ${abstractMatch[3]}${isPartial ? " (partial)" : ""}, inherits: [${inheritance.join(", ")}]`,
        );
        currentClass = {
          type: "abstractClass",
          name: abstractMatch[3],
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          inherits: inheritance,
          members: [],
          isAbstract: true,
          isPartial: isPartial,
          namespace: currentNamespace || null,
          _openDepth: prevBraceDepth,
        };
        ast.children.push(currentClass);
        continue;
      }

      // Check for class (including generics, nested classes, partial, sealed, static, new classes)
      // Group 1: access modifier  Group 2: extra modifiers (partial/sealed/static/new/unsafe)
      // Group 3: class name  Group 4: generics  Group 5: inheritance list
      const classMatch = trimmed.match(
        /^(public|private|protected|internal)?\s*((?:(?:partial|sealed|static|new|unsafe|readonly)\s+)+)?class\s+(\w+)(?:<([^>]+)>)?(?:\s*:\s*([^{]+))?/,
      );
      if (classMatch) {
        const className = classMatch[3];
        const modifiersStr = classMatch[2] || "";
        const isPartial = /\bpartial\b/.test(modifiersStr);
        const generics = classMatch[4]
          ? classMatch[4].split(",").map((s) => s.trim())
          : [];
        const inheritance = classMatch[5]
          ? classMatch[5].split(",").map((s) => s.trim())
          : [];

        console.log(
          `📦 Class detected: ${className}${isPartial ? " (partial)" : ""}, inherits: [${inheritance.join(", ")}]`,
        );

        // Check if this is a nested class (inside another class)
        const isNested = currentClass !== null;

        const newClass = {
          type: "class",
          name: className,
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          inherits: inheritance,
          members: [],
          isAbstract: false,
          isPartial: isPartial,
          isNested: isNested,
          parentClass: isNested ? currentClass.name : null,
          namespace: currentNamespace || null,
          generics: generics && generics.length > 0 ? generics : null,
          _openDepth: prevBraceDepth,
        };

        if (isNested) {
          currentClass.children.push(newClass);
        } else {
          ast.children.push(newClass);
        }
        currentClass = newClass;
        continue;
      }

      // Check for method (including generics and overloading)
      // Match: [access] [modifiers] returnType methodName[<T>](params)
      // Also match constructors: [access] ClassName(params) [: base(...)]
      const methodMatch = trimmed.match(
        /(public|private|protected|internal)?\s*((?:(?:static|abstract|virtual|override|sealed|new|async|extern)\s+)+)?(\w+)\s+(\w+)\s*(?:<([^>]+)>)?\s*\(/,
      );

      // Match constructors - handle both simple and with : base(...) calls
      // Pattern: [access] ClassName(params) [: base(...)]
      let constructorMatch = null;
      let isConstructor = false;

      if (currentClass) {
        // Split by : to handle base calls separately
        const beforeColon = trimmed.split(":")[0].trim();

        // Match constructor: [access] ClassName(params)
        // Group 1: access modifier (optional)
        // Group 2: class name (required)
        const constructorPattern = new RegExp(
          `^(public|private|protected|internal)?\\s*(${currentClass.name})\\s*\\(`,
        );
        constructorMatch = beforeColon.match(constructorPattern);

        // Check if it's a constructor (method name matches class name)
        if (constructorMatch && constructorMatch[2] === currentClass.name) {
          isConstructor = true;
          console.log(
            `🔨 Constructor detected: ${currentClass.name}, access: ${constructorMatch[1] || "public"}`,
          );
        }
      }

      if ((methodMatch && currentClass) || (isConstructor && currentClass)) {
        let methodName, generics, params, access, modifiers;

        if (isConstructor) {
          // Constructor - extract name and parameters
          // constructorMatch[2] is the class name, constructorMatch[1] is the access modifier
          methodName = constructorMatch[2] || constructorMatch[1]; // Class name is in group 2
          access = constructorMatch[1] || "public"; // Access modifier is in group 1
          modifiers = [];
          generics = [];

          // Extract parameters - handle : base(...) calls
          // First, get the part before : base if it exists
          const beforeBase = trimmed.split(":")[0].trim();
          const paramMatch = beforeBase.match(/\(([^)]*)\)/);
          params =
            paramMatch && paramMatch[1]
              ? paramMatch[1]
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s)
              : [];

          // Check if constructor calls base constructor
          if (trimmed.includes(": base(")) {
            // Constructor calls base - this is important for inheritance visualization
            modifiers.push("base");
          }

          console.log(
            `✅ Constructor parsed: ${methodName}(${params.join(", ")})`,
          );
        } else {
          // Regular method
          methodName = methodMatch[4];
          access = methodMatch[1] || "private";
          modifiers = methodMatch[2] ? methodMatch[2].trim().split(/\s+/).filter(Boolean) : [];
          generics = methodMatch[5]
            ? methodMatch[5].split(",").map((s) => s.trim())
            : [];
          const paramMatch = trimmed.match(/\(([^)]*)\)/);
          params =
            paramMatch && paramMatch[1]
              ? paramMatch[1]
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s)
              : [];
        }

        const isAbstract = modifiers.includes("abstract");
        const isVirtual = modifiers.includes("virtual");
        const isOverride = modifiers.includes("override");

        // Debug logging for polymorphism detection
        if (isVirtual || isOverride || isAbstract) {
          console.log(`🔍 POLYMORPHISM DETECTED: ${methodName}`, {
            isVirtual,
            isOverride,
            isAbstract,
            modifiers,
            className: currentClass?.name,
          });
        }

        // Check for method overriding (polymorphism)
        let overrides = null;
        if (
          isOverride &&
          currentClass.inherits &&
          currentClass.inherits.length > 0
        ) {
          console.log(
            `🔎 C# Override detected for ${methodName} in ${currentClass.name}, parent: ${currentClass.inherits[0]}`,
          );
          const parentClass = this.findClassByName(
            ast,
            currentClass.inherits[0],
          );
          if (parentClass) {
            console.log(
              `  ✅ C# Found parent class: ${parentClass.name}, children count: ${parentClass.children?.length || 0}`,
            );
            const parentMethod = this.findMethodInClass(
              parentClass,
              methodName,
            );
            if (parentMethod) {
              console.log(
                `  ✅ C# Found parent method: ${parentMethod.name}, modifiers: [${parentMethod.modifiers?.join(", ") || "none"}], isAbstract: ${parentMethod.isAbstract}, isVirtual: ${parentMethod.isVirtual}`,
              );
              if (
                parentMethod.modifiers?.includes("virtual") ||
                parentMethod.modifiers?.includes("abstract") ||
                parentMethod.isAbstract ||
                parentMethod.isVirtual
              ) {
                overrides = parentMethod.name;
                console.log(`  ✅ C# Setting overrides to: ${overrides}`);
              } else {
                console.log(`  ❌ C# Parent method is not virtual/abstract`);
              }
            } else {
              console.log(`  ❌ C# Parent method not found: ${methodName}`);
            }
          } else {
            console.log(
              `  ❌ C# Parent class not found: ${currentClass.inherits[0]}`,
            );
          }
        }

        // Also mark virtual methods as overridable
        if (isVirtual && !isOverride) {
          // This method can be overridden
        }

        // Check for method overloading (same name, different parameters)
        let isOverloaded = false;
        let overloadCount = 1;
        if (currentClass && currentClass.children) {
          try {
            const existingMethods = currentClass.children.filter(
              (c) => c && c.type === "method" && c.name === methodName,
            );
            if (existingMethods.length > 0) {
              isOverloaded = true;
              overloadCount = existingMethods.length + 1;
              // Mark all previous overloads (safely)
              existingMethods.forEach((m) => {
                if (m) {
                  m.isOverloaded = true;
                  m.overloadCount = (m.overloadCount || 1) + 1;
                }
              });
            }
          } catch (error) {
            console.warn("Error detecting method overloading:", error);
          }
        }

        const methodNode = {
          type: "method",
          name: methodName,
          children: [],
          lineStart: lineNumber,
          lineEnd: lineNumber,
          complexity: 1,
          controlStructures: [],
          access: access || "private",
          modifiers: modifiers || [],
          isAbstract: isAbstract,
          isConstructor: isConstructor || false,
          isVirtual: isVirtual,
          overrides: overrides,
          isOverloaded: isOverloaded || false,
          overloadCount: overloadCount || 1,
          parameters: params || [],
          generics: generics && generics.length > 0 ? generics : null,
          _openDepth: prevBraceDepth,
        };

        console.log(`📝 C# Method parsed: ${methodName}`, {
          class: currentClass?.name,
          access: access || "private",
          isAbstract,
          isVirtual,
          isOverride,
          overrides,
          modifiers,
        });

        if (isConstructor) {
          console.log(
            `🔨 Creating constructor node: ${methodName}, isConstructor=${methodNode.isConstructor}`,
          );
        }

        console.log(
          `  ➕ Adding to class: ${currentClass?.name}, currentMethod: ${currentMethod?.name || "none"}`,
        );
        currentClass.children.push(methodNode);
        currentMethod = methodNode;
        continue;
      }

      // Control structures
      if (currentMethod) {
        if (trimmed.match(/if\s*\(/)) {
          const ifNode = {
            type: "if",
            name: "if",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentMethod.children.push(ifNode);
          currentMethod.complexity += 1;
          currentBlock = ifNode;
          continue;
        }

        if (trimmed.match(/else\s*{/)) {
          const elseNode = {
            type: "else",
            name: "else",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            children: [],
          };
          currentMethod.children.push(elseNode);
          currentBlock = elseNode;
          continue;
        }

        if (trimmed.match(/for\s*\(/)) {
          const forNode = {
            type: "for",
            name: "for",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentMethod.children.push(forNode);
          currentMethod.complexity += 1;
          currentBlock = forNode;
          continue;
        }

        if (trimmed.match(/while\s*\(/)) {
          const whileNode = {
            type: "while",
            name: "while",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentMethod.children.push(whileNode);
          currentMethod.complexity += 1;
          currentBlock = whileNode;
          continue;
        }

        if (trimmed.match(/try\s*{/)) {
          const tryNode = {
            type: "try",
            name: "try",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 1,
            children: [],
          };
          currentMethod.children.push(tryNode);
          currentMethod.complexity += 1;
          currentBlock = tryNode;
          continue;
        }

        if (trimmed.match(/catch\s*\(/)) {
          const catchNode = {
            type: "catch",
            name: "catch",
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            children: [],
          };
          currentMethod.children.push(catchNode);
          currentBlock = catchNode;
          continue;
        }
      }

      // Class members - C# properties and fields
      if (currentClass && braceDepth > 0) {
        // Match C# auto-properties: public String Owner { get; set; }
        const autoPropMatch = trimmed.match(
          /(public|private|protected|internal)?\s*(static|readonly)?\s*(\w+)\s+(\w+)\s*\{\s*(get|set|init)(?:\s*;\s*(get|set|init))?\s*;?\s*\}/,
        );
        if (autoPropMatch) {
          const access = autoPropMatch[1] || "private";
          const isStatic = autoPropMatch[2] === "static";
          const propType = autoPropMatch[3];
          const propName = autoPropMatch[4];
          const hasGet =
            autoPropMatch[5] === "get" || autoPropMatch[6] === "get";
          const hasSet =
            autoPropMatch[5] === "set" ||
            autoPropMatch[6] === "set" ||
            autoPropMatch[5] === "init" ||
            autoPropMatch[6] === "init";
          const setAccess = trimmed.match(
            /set\s*;\s*}|protected\s+set|private\s+set/,
          );
          const setModifier =
            setAccess && trimmed.includes("protected set")
              ? "protected"
              : setAccess && trimmed.includes("private set")
                ? "private"
                : hasSet
                  ? access
                  : null;

          const propNode = {
            type: isStatic ? "static" : "property",
            name: propName,
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            access: access,
            setAccess: setModifier, // Track setter access modifier separately
            propertyType: propType,
            hasGet: hasGet,
            hasSet: hasSet,
            composedClass:
              propType &&
              propType[0] === propType[0].toUpperCase() &&
              propType !== "String" &&
              propType !== "Int32" &&
              propType !== "Decimal" &&
              propType !== "Guid" &&
              propType !== "Boolean"
                ? propType
                : null,
          };
          currentClass.members.push(propNode);

          // Track composition relationship
          if (
            propNode.composedClass &&
            propNode.composedClass !== currentClass.name
          ) {
            if (!currentClass.compositions) currentClass.compositions = [];
            currentClass.compositions.push({
              type: "has-a",
              target: propNode.composedClass,
              member: propNode.name,
            });
          }
          continue;
        }

        // Match simple fields: public String Owner;
        const fieldMatch = trimmed.match(
          /(public|private|protected|internal)?\s*(static|readonly)?\s*(\w+)\s+(\w+)\s*[=;]/,
        );
        if (fieldMatch) {
          const access = fieldMatch[1] || "private";
          const isStatic = fieldMatch[2] === "static";
          const isReadonly = fieldMatch[2] === "readonly";
          const fieldType = fieldMatch[3];
          const fieldName = fieldMatch[4];

          const fieldNode = {
            type: isStatic ? "static" : isReadonly ? "constant" : "property",
            name: fieldName,
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
            access: access,
            propertyType: fieldType,
            composedClass:
              fieldType &&
              fieldType[0] === fieldType[0].toUpperCase() &&
              fieldType !== "String" &&
              fieldType !== "Int32" &&
              fieldType !== "Decimal" &&
              fieldType !== "Guid" &&
              fieldType !== "Boolean"
                ? fieldType
                : null,
          };
          currentClass.members.push(fieldNode);

          // Track composition relationship
          if (
            fieldNode.composedClass &&
            fieldNode.composedClass !== currentClass.name
          ) {
            if (!currentClass.compositions) currentClass.compositions = [];
            currentClass.compositions.push({
              type: "has-a",
              target: fieldNode.composedClass,
              member: fieldNode.name,
            });
          }
          continue;
        }
      }

      // Capture statements for flowchart semantic analysis
      if (
        currentBlock &&
        trimmed.length > 0 &&
        trimmed !== "{" &&
        trimmed !== "}"
      ) {
        // Skip C# keywords and declarations we already handled
        const skipPatterns = [
          /^(class|interface|public|private|protected|internal|static|abstract|virtual|override|namespace|using|return|break|continue)\b/i,
          /^\/\//, // Comments
          /^\/\*/, // Block comments
          /if\s*\(/,
          /else/,
          /for\s*\(/,
          /foreach\s*\(/,
          /while\s*\(/,
          /try\s*{/,
          /catch\s*\(/,
        ];

        const shouldSkip = skipPatterns.some((pattern) =>
          pattern.test(trimmed),
        );
        if (!shouldSkip && currentMethod) {
          const statementNode = {
            type: "statement",
            name: trimmed,
            body: trimmed,
            lineStart: lineNumber,
            lineEnd: lineNumber,
            complexity: 0,
          };
          currentBlock.children.push(statementNode);
        }
      }

      // Exit method when brace depth returns to where it was when method opened
      if (currentMethod && braceDepth < prevBraceDepth) {
        currentMethod.lineEnd = lineNumber;
        console.log(
          `🔚 Method ended: ${currentMethod.name}, depth: ${braceDepth}, openDepth: ${currentMethod._openDepth}`,
        );
        if (braceDepth <= currentMethod._openDepth) {
          currentMethod = null;
          currentBlock = null;
          console.log(`  ↩️ Exited method`);
        }
      }

      // Exit class when brace depth returns to where it was when class opened
      if (!currentMethod && currentClass && braceDepth < prevBraceDepth && braceDepth <= currentClass._openDepth) {
        currentClass.lineEnd = lineNumber;
        currentClass = null;
        currentBlock = null;
      }
    }

    this.calculateMetrics(ast);
    
    // Detect object instantiation
    this.detectObjectInstantiation(ast, code, 'csharp');
    
    return ast;
  }

  calculateMetrics(node) {
    if (!node) return;

    // Calculate line count
    if (node.lineStart && node.lineEnd) {
      node.lineCount = node.lineEnd - node.lineStart + 1;
    }

    // Recursively calculate for children
    if (node.children) {
      node.children.forEach((child) => {
        this.calculateMetrics(child);
        if (child.complexity) {
          node.complexity = (node.complexity || 0) + child.complexity;
        }
      });
    }

    // Calculate nesting depth
    const calculateDepth = (n, depth = 0) => {
      n.depth = depth;
      if (n.children) {
        n.children.forEach((child) => calculateDepth(child, depth + 1));
      }
    };
    calculateDepth(node);
  }

  // Helper methods for OOP concept detection
  findClassByName(ast, className) {
    const findInNode = (node) => {
      if (
        node.name === className &&
        (node.type === "class" ||
          node.type === "abstractClass" ||
          node.type === "interface")
      ) {
        return node;
      }
      if (node.children) {
        for (const child of node.children) {
          const found = findInNode(child);
          if (found) return found;
        }
      }
      return null;
    };
    return findInNode(ast);
  }

  findMethodInClass(classNode, methodName) {
    if (!classNode || !classNode.children) return null;
    return classNode.children.find(
      (child) => child.type === "method" && child.name === methodName,
    );
  }

  /**
   * Detect object instantiation patterns in code
   * Scans the source code for each method/function to find 'new ClassName()' patterns
   */
  detectObjectInstantiation(ast, sourceCode, language) {
    const lines = sourceCode.split('\n');
    
    const traverseNode = (node) => {
      // Only process methods and functions
      if (node.type === 'method' || node.type === 'function') {
        if (!node.instantiates) {
          node.instantiates = [];
        }
        
        // Get the relevant code lines for this node
        if (node.lineStart && node.lineEnd) {
          const builtInClasses = {
            'python': ['Exception', 'ValueError', 'TypeError', 'AttributeError', 'KeyError', 'IndexError', 'RuntimeError', 'NotImplementedError', 'StopIteration', 'True', 'False', 'None'],
            'php': ['Exception', 'InvalidArgumentException', 'RuntimeException', 'stdClass', 'DateTime'],
            'csharp': ['Exception', 'ArgumentException', 'InvalidOperationException', 'List', 'Dictionary', 'DateTime', 'StringBuilder'],
            'cpp': ['Exception', 'String', 'Vector', 'Map', 'Set', 'Pair'],
          };
          const builtIns = new Set(builtInClasses[language] || []);

          for (let i = node.lineStart - 1; i < node.lineEnd && i < lines.length; i++) {
            const line = lines[i];

            // Python uses ClassName(...) without 'new' — detect via uppercase-leading identifier
            if (language === 'python') {
              const pythonPattern = /(?<![.\w])([A-Z]\w+)\s*\(/g;
              let match;
              while ((match = pythonPattern.exec(line)) !== null) {
                const className = match[1];
                if (!builtIns.has(className) && !node.instantiates.includes(className)) {
                  node.instantiates.push(className);
                  console.log(`🏗️ python: Method ${node.name} instantiates ${className} (line ${i + 1})`);
                }
              }
            } else {
              // PHP, C#, C++ all use 'new ClassName(...)'
              const newPattern = /new\s+([A-Z]\w+)\s*\(/g;
              let match;
              while ((match = newPattern.exec(line)) !== null) {
                const className = match[1];
                if (!builtIns.has(className) && !node.instantiates.includes(className)) {
                  node.instantiates.push(className);
                  console.log(`🏗️ ${language}: Method ${node.name} instantiates ${className} (line ${i + 1})`);
                }
              }
            }
          }
        }
      }
      
      // Recursively process children
      if (node.children) {
        node.children.forEach(child => traverseNode(child));
      }
    };
    
    traverseNode(ast);
    return ast;
  }
}
