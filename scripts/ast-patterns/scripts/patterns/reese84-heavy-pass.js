const { runPatternPass } = require("./shared-pattern-pass");
const { inlineStringMethodCalls, traverse, t } = require("./pattern-utils");

function hasDynamicAccess(ast) {
  let found = false;
  traverse(ast, {
    MemberExpression(p) {
      if (p.node.computed && !p.get("property").isLiteral()) { found = true; p.stop(); }
    },
    WithStatement(p) { found = true; p.stop(); },
    "CallExpression|NewExpression"(p) {
      const callee = p.node.callee;
      if (callee && callee.type === "Identifier" && (callee.name === "eval" || callee.name === "Function")) {
        found = true; p.stop();
      }
    },
  });
  return found;
}

function pruneUnusedTopLevel(ast) {
  let changed = false;

  // 保守策略：只要代码里存在动态属性访问（computed 非字面量键）、with、或 eval/Function，
  // 就可能无法静态判定顶层声明是否被引用，此时保留全部声明，避免误删破坏产物。
  if (hasDynamicAccess(ast)) return false;

  traverse(ast, {
    Program(path) {
      path.get("body").forEach((stmtPath) => {
        if (stmtPath.isVariableDeclaration()) {
          const removable = [];
          stmtPath.get("declarations").forEach((declPath) => {
            if (!declPath.get("id").isIdentifier()) {
              return;
            }
            const binding = declPath.scope.getBinding(declPath.node.id.name);
            if (binding && !binding.referenced) {
              removable.push(declPath);
            }
          });
          if (removable.length === stmtPath.node.declarations.length && removable.length > 0) {
            stmtPath.remove();
            changed = true;
          } else if (removable.length > 0) {
            removable.forEach((declPath) => declPath.remove());
            changed = true;
          }
        } else if (stmtPath.isFunctionDeclaration() && stmtPath.node.id) {
          const binding = stmtPath.scope.getBinding(stmtPath.node.id.name);
          if (binding && !binding.referenced) {
            stmtPath.remove();
            changed = true;
          }
        }
      });
    }
  });

  return changed;
}

function reese84HeavyPass(ast) {
  let changed = false;
  if (inlineStringMethodCalls(ast)) {
    changed = true;
  }
  traverse(ast, {
    BinaryExpression: {
      exit(path) {
        if (path.get("left").isStringLiteral() && path.get("right").isStringLiteral()) {
          const evaluated = path.evaluate();
          if (evaluated.confident) {
            path.replaceWith(t.valueToNode(evaluated.value));
            changed = true;
          }
        }
      }
    }
  });
  if (pruneUnusedTopLevel(ast)) {
    changed = true;
  }
  return { ast, changed };
}

runPatternPass(reese84HeavyPass);
