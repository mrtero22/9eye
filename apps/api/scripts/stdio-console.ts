// Imported first by the stdio server: over stdio, stdout carries MCP messages only, so anything the
// code logs goes to stderr instead.

console.log = console.error;
console.info = console.error;
console.debug = console.error;
