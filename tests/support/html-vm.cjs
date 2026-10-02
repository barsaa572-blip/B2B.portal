const vm = require('node:vm');

function prepare(context = {}) {
  if (typeof context.safeHtml !== 'function') {
    context.safeHtml = value => String(value ?? '');
  }
  return context;
}

const create = vm.createContext;
vm.createContext = (context, ...args) =>
  create(prepare(context), ...args);

const runNew = vm.runInNewContext;
vm.runInNewContext = (code, context, ...args) =>
  runNew(code, prepare(context), ...args);

const run = vm.runInContext;
vm.runInContext = (code, context, ...args) =>
  run(code, prepare(context), ...args);