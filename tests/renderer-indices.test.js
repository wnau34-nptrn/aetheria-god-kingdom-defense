import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({window:{},performance:{now:()=>0}});
vm.runInContext(readFileSync(new URL('../src/legacy/webgl-engine.js',import.meta.url),'utf8'),context);
const T=context.window.THREE;
function buffers(index,supportsUint32=true) {
  const uploads=[];
  const gl={ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,DYNAMIC_DRAW:35048,STATIC_DRAW:35044,UNSIGNED_SHORT:5123,UNSIGNED_INT:5125,
    createBuffer:()=>({}),bindBuffer:()=>{},bufferData:(target,data)=>uploads.push({target,bytes:data.BYTES_PER_ELEMENT})};
  const geometry=new T.BufferGeometry();
  for(const attr of ['position','normal','color']) geometry.setAttribute(attr,new T.BufferAttribute(new Float32Array(65537*3),3));
  geometry.setIndex(index);
  const result=T.WebGLRenderer.prototype._ensureGLBuffers.call({gl,_supportsUint32:supportsUint32},geometry);
  return {result,uploads};
}
test('large mesh indices retain 32-bit precision',()=>{
  const {result,uploads}=buffers([0,65536,1]);assert.equal(result.indexType,5125);assert.equal(uploads.at(-1).bytes,4);
});
test('small meshes use 16-bit indices and unsupported large meshes fail explicitly',()=>{
  const {result,uploads}=buffers([0,1,2]);assert.equal(result.indexType,5123);assert.equal(uploads.at(-1).bytes,2);
  assert.throws(()=>buffers([0,65536,1],false),/32-bit mesh indices/);
});
