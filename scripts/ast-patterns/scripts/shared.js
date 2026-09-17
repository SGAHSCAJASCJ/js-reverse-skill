const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;
const t = require("@babel/types");

function parseFile(filePath) {
  // 去除 Windows 保存文件可能带的前导 UTF-8 BOM，避免 babel 解析异常
  const source = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return parser.parse(source, {
    sourceType: "unambiguous",
    plugins: ["jsx"]
  });
}

function printAst(ast) {
  return generator(ast, {
    compact: false,
    comments: false,
    jsescOption: { minimal: true }
  }).code;
}

function saveAst(ast, filePath) {
  fs.writeFileSync(filePath, printAst(ast), "utf8");
}

function reparse(ast) {
  return parser.parse(printAst(ast), {
    sourceType: "unambiguous",
    plugins: ["jsx"]
  });
}

function clone(node) {
  return t.cloneNode(node, true);
}

function isPrimitiveNode(node) {
  return t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node) || t.isIdentifier(node, { name: "undefined" });
}

function parseArgs() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node <script> <input.js> <output.js>");
    process.exit(1);
  }
  return { inputPath, outputPath };
}

module.exports = {
  clone,
  isPrimitiveNode,
  parseArgs,
  parseFile,
  printAst,
  reparse,
  saveAst,
  t,
  traverse
};
