// AST-guided mechanical migration; does not touch textContent or static HTML.
import { parse } from 'acorn';
import { readFileSync, writeFileSync } from 'node:fs';
for (const file of ['app.js','auth.js','admin.js','team.js','interface.js','flight-detail-card.js']) {
  const source=readFileSync(file,'utf8'), edits=[];
  const visit=node=>{
    if(!node || typeof node!=='object')return;
    let target;
    if(node.type==='AssignmentExpression' && node.operator==='=' && node.left.type==='MemberExpression' && node.left.property.name==='innerHTML') target=node.right;
    if(node.type==='CallExpression' && node.callee.type==='MemberExpression' && node.callee.property.name==='insertAdjacentHTML') target=node.arguments[1];
    if(target && !(target.type==='CallExpression' && target.callee.name==='safeHtml')) edits.push({start:target.start,end:target.end});
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value && typeof value==='object')visit(value);
  };
  visit(parse(source,{ecmaVersion:'latest',sourceType:'script'}));
  let out=source;
  for(const e of edits.sort((a,b)=>b.start-a.start))out=out.slice(0,e.start)+'safeHtml('+out.slice(e.start,e.end)+')'+out.slice(e.end);
  writeFileSync(file,out);
}
