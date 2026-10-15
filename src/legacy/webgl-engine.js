(function ensureThreeEngine() {
  if (typeof window.THREE !== 'undefined') return;
  class Color {
    constructor(r, g, b) { this.r = 0.5; this.g = 0.7; this.b = 0.9; if (r !== undefined) this.set(r, g, b); }
    set(r, g, b) {
      if (typeof r === 'number' && g === undefined) return this.setHex(r);
      if (typeof r === 'string') return this.setStyle(r);
      if (r instanceof Color) return this.copy(r);
      this.r = r || 0; this.g = g || 0; this.b = b || 0; return this;
    }
    setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
    setHex(hex) { hex = Math.floor(hex); this.r = ((hex >> 16) & 255) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; return this; }
    setStyle(s) { if (s && s.startsWith('#')) return this.setHex(parseInt(s.slice(1), 16)); return this; }
    copy(c) { if (c) { this.r = c.r; this.g = c.g; this.b = c.b; } return this; }
    clone() { return new Color(this.r, this.g, this.b); }
    lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  }
  class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
    lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  }
  class Object3D {
    constructor() {
      this.position = new Vector3(); this.rotation = new Vector3(); this.scale = new Vector3(1, 1, 1);
      this.children = []; this.parent = null; this.visible = true; this.userData = {};
      this.castShadow = false; this.receiveShadow = false;
    }
    add(...objs) { for (const o of objs) { if (o && !this.children.includes(o)) { o.parent = this; this.children.push(o); } } return this; }
    remove(...objs) { for (const o of objs) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } } return this; }
    rotateX(a) { this.rotation.x += a; return this; }
    rotateY(a) { this.rotation.y += a; return this; }
    rotateZ(a) { this.rotation.z += a; return this; }
    lookAt(x, y, z) {
      const tx = (x instanceof Vector3) ? x.x : x, ty = (x instanceof Vector3) ? x.y : y, tz = (x instanceof Vector3) ? x.z : z;
      this._lookTarget = new Vector3(tx, ty, tz);
      const dx = tx - this.position.x, dz = tz - this.position.z;
      if (Math.hypot(dx, dz) > 0.001) this.rotation.y = Math.atan2(dx, dz);
    }
  }
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array instanceof Float32Array ? array : new Float32Array(array);
      this.itemSize = itemSize; this.count = this.array.length / itemSize; this.needsUpdate = true;
    }
    getX(i) { return this.array[i * this.itemSize]; }
    getY(i) { return this.array[i * this.itemSize + 1]; }
    getZ(i) { return this.array[i * this.itemSize + 2]; }
    setXYZ(i, x, y, z) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; this.needsUpdate = true; }
    setY(i, y) { this.array[i * this.itemSize + 1] = y; this.needsUpdate = true; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; this.userData = {}; this._version = 0; }
    setAttribute(name, attr) { this.attributes[name] = attr; this._version++; return this; }
    setIndex(idx) { this.index = idx instanceof Uint32Array ? idx : new Uint32Array(idx); this._version++; return this; }
    computeVertexNormals() {
      const pos = this.attributes.position; if (!pos) return;
      const norms = new Float32Array(pos.count * 3);
      const idx = this.index;
      if (idx) {
        for (let i = 0; i < idx.length; i += 3) {
          const a = idx[i], b = idx[i + 1], c = idx[i + 2];
          const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
          const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az;
          const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          norms[a*3]+=nx; norms[a*3+1]+=ny; norms[a*3+2]+=nz;
          norms[b*3]+=nx; norms[b*3+1]+=ny; norms[b*3+2]+=nz;
          norms[c*3]+=nx; norms[c*3+1]+=ny; norms[c*3+2]+=nz;
        }
      }
      for (let i = 0; i < pos.count; i++) {
        const x = norms[i*3], y = norms[i*3+1], z = norms[i*3+2], l = Math.hypot(x, y, z) || 1;
        norms[i*3] = x/l; norms[i*3+1] = y/l; norms[i*3+2] = z/l;
      }
      this.attributes.normal = new BufferAttribute(norms, 3);
      this._version++;
    }
    rotateX(angle) {
      const pos = this.attributes.position; if (!pos) return this;
      const c = Math.cos(angle), s = Math.sin(angle);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), z = pos.getZ(i);
        pos.setXYZ(i, pos.getX(i), y * c - z * s, y * s + z * c);
      }
      this.computeVertexNormals(); return this;
    }
    translate(dx, dy, dz) {
      const pos = this.attributes.position; if (!pos) return this;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
      this._version++; return this;
    }
    dispose() {
      if (this._gl && this._glCtx) {
        const gl = this._glCtx;
        if (this._gl.posBuf) gl.deleteBuffer(this._gl.posBuf);
        if (this._gl.normBuf) gl.deleteBuffer(this._gl.normBuf);
        if (this._gl.colBuf) gl.deleteBuffer(this._gl.colBuf);
        if (this._gl.idxBuf) gl.deleteBuffer(this._gl.idxBuf);
        this._gl = null;
      }
    }
  }
  class PlaneGeometry extends BufferGeometry {
    constructor(w = 1, h = 1, ws = 1, hs = 1) {
      super();
      const verts = new Float32Array((ws + 1) * (hs + 1) * 3);
      let p = 0;
      for (let iy = 0; iy <= hs; iy++) {
        const y = (iy / hs - 0.5) * h;
        for (let ix = 0; ix <= ws; ix++) { verts[p++] = (ix / ws - 0.5) * w; verts[p++] = -y; verts[p++] = 0; }
      }
      const indices = [], stride = ws + 1;
      for (let iy = 0; iy < hs; iy++) {
        for (let ix = 0; ix < ws; ix++) {
          const a = iy * stride + ix, b = a + 1, c = (iy + 1) * stride + ix, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      this.setAttribute('position', new BufferAttribute(verts, 3));
      this.setIndex(indices); this.computeVertexNormals();
    }
  }
  class BoxGeometry extends BufferGeometry {
    constructor(w = 1, h = 1, d = 1) {
      super();
      const x = w/2, y = h/2, z = d/2;
      const verts = new Float32Array([
        -x,-y, z, x,-y, z, x, y, z, -x, y, z,  x,-y,-z, -x,-y,-z, -x, y,-z, x, y,-z,
        -x, y, z, x, y, z, x, y,-z, -x, y,-z, -x,-y,-z, x,-y,-z, x,-y, z, -x,-y, z,
         x,-y, z, x,-y,-z, x, y,-z, x, y, z,  -x,-y,-z, -x,-y, z, -x, y, z, -x, y,-z
      ]);
      const idx = [];
      for (let f = 0; f < 6; f++) { const b = f * 4; idx.push(b, b+1, b+2, b, b+2, b+3); }
      this.setAttribute('position', new BufferAttribute(verts, 3));
      this.setIndex(idx); this.computeVertexNormals();
    }
  }
  class CylinderGeometry extends BufferGeometry {
    constructor(rTop = 1, rBot = 1, h = 1, radSeg = 14, heightSeg = 1, openEnded = false) {
      super();
      const rs = Math.max(3, radSeg), hs = Math.max(1, heightSeg), verts = [], indices = [];
      if (rs <= 8) {
        // Crisp flat-faceted side faces for 4-sided roofs, 6-sided crystals, and 8-sided octagonal towers
        for (let y = 0; y < hs; y++) {
          const v0 = y / hs, v1 = (y + 1) / hs;
          const py0 = (0.5 - v0) * h, py1 = (0.5 - v1) * h;
          const r0 = rTop + v0 * (rBot - rTop), r1 = rTop + v1 * (rBot - rTop);
          for (let x = 0; x < rs; x++) {
            const a0 = (x / rs) * Math.PI * 2, a1 = ((x + 1) / rs) * Math.PI * 2;
            const s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
            const baseIdx = verts.length / 3;
            verts.push(
              s0 * r0, py0, c0 * r0,
              s1 * r0, py0, c1 * r0,
              s0 * r1, py1, c0 * r1,
              s1 * r1, py1, c1 * r1
            );
            indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx + 1, baseIdx + 2, baseIdx + 3);
          }
        }
      } else {
        for (let y = 0; y <= hs; y++) {
          const v = y / hs, py = (0.5 - v) * h, r = rTop + v * (rBot - rTop);
          for (let x = 0; x <= rs; x++) {
            const a = (x / rs) * Math.PI * 2;
            verts.push(Math.sin(a) * r, py, Math.cos(a) * r);
          }
        }
        const stride = rs + 1;
        for (let y = 0; y < hs; y++) {
          for (let x = 0; x < rs; x++) {
            const i0 = y * stride + x, i1 = i0 + 1, i2 = (y + 1) * stride + x, i3 = i2 + 1;
            indices.push(i0, i2, i1, i1, i2, i3);
          }
        }
      }
      // Separate vertex rings for Top and Bottom Caps so cap normals never bleed into side walls!
      if (!openEnded && rTop > 0.001) {
        const tc = verts.length / 3;
        verts.push(0, h / 2, 0);
        for (let x = 0; x <= rs; x++) {
          const a = (x / rs) * Math.PI * 2;
          verts.push(Math.sin(a) * rTop, h / 2, Math.cos(a) * rTop);
        }
        for (let x = 0; x < rs; x++) indices.push(tc, tc + 1 + x + 1, tc + 1 + x);
      }
      if (!openEnded && rBot > 0.001) {
        const bc = verts.length / 3;
        verts.push(0, -h / 2, 0);
        for (let x = 0; x <= rs; x++) {
          const a = (x / rs) * Math.PI * 2;
          verts.push(Math.sin(a) * rBot, -h / 2, Math.cos(a) * rBot);
        }
        for (let x = 0; x < rs; x++) indices.push(bc, bc + 1 + x, bc + 1 + x + 1);
      }
      this.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      this.setIndex(indices);
      this.computeVertexNormals();
    }
  }
  class ConeGeometry extends CylinderGeometry {
    constructor(r = 1, h = 1, rs = 14, hs = 1, oe = false) { super(0.0005, r, h, rs, hs, oe); }
  }
  class SphereGeometry extends BufferGeometry {
    constructor(r = 1, wSeg = 14, hSeg = 12) {
      super();
      const ws = Math.max(8, wSeg), hs = Math.max(6, hSeg), verts = [], norms = [], indices = [];
      for (let y = 0; y <= hs; y++) {
        const phi = (y / hs) * Math.PI;
        for (let x = 0; x <= ws; x++) {
          const theta = (x / ws) * Math.PI * 2;
          const nx = -Math.cos(theta) * Math.sin(phi), ny = Math.cos(phi), nz = Math.sin(theta) * Math.sin(phi);
          verts.push(r * nx, r * ny, r * nz);
          norms.push(nx, ny, nz);
        }
      }
      const stride = ws + 1;
      for (let y = 0; y < hs; y++) {
        for (let x = 0; x < ws; x++) {
          const a = y * stride + x, b = a + 1, c = (y + 1) * stride + x, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      this.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      this.setAttribute('normal', new BufferAttribute(new Float32Array(norms), 3));
      this.setIndex(indices);
    }
  }
  class OctahedronGeometry extends BufferGeometry {
    constructor(r = 1) {
      super();
      const p = [
        [0, r, 0], [0, -r, 0], [r, 0, 0], [-r, 0, 0], [0, 0, r], [0, 0, -r]
      ];
      const faces = [
        [0, 4, 2], [0, 2, 5], [0, 5, 3], [0, 3, 4],
        [1, 2, 4], [1, 5, 2], [1, 3, 5], [1, 4, 3]
      ];
      const verts = [], indices = [];
      let idx = 0;
      for (const [a, b, c] of faces) {
        verts.push(...p[a], ...p[b], ...p[c]);
        indices.push(idx, idx + 1, idx + 2);
        idx += 3;
      }
      this.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      this.setIndex(indices);
      this.computeVertexNormals();
    }
  }
  class DodecahedronGeometry extends BufferGeometry {
    constructor(r = 1) {
      super();
      // Chiseled 20-face rock polyhedron with natural craggy facet displacement and flat normals
      const t = (1 + Math.sqrt(5)) / 2;
      const rawV = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
      ].map(([x, y, z], i) => {
        const l = Math.hypot(x, y, z) || 1;
        const crag = 0.88 + ((i * 37) % 11) * 0.022;
        return [(x / l) * r * crag, (y / l) * r * crag, (z / l) * r * crag];
      });
      const faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
      ];
      const verts = [], indices = [];
      let idx = 0;
      for (const [a, b, c] of faces) {
        verts.push(...rawV[a], ...rawV[b], ...rawV[c]);
        indices.push(idx, idx + 1, idx + 2);
        idx += 3;
      }
      this.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      this.setIndex(indices);
      this.computeVertexNormals();
    }
  }
  class RingGeometry extends BufferGeometry {
    constructor(innerR = 0.5, outerR = 1, seg = 24) {
      super();
      const s = Math.max(16, seg), verts = [], indices = [];
      for (let i = 0; i <= s; i++) {
        const a = (i / s) * Math.PI * 2;
        verts.push(Math.cos(a) * innerR, Math.sin(a) * innerR, 0, Math.cos(a) * outerR, Math.sin(a) * outerR, 0);
      }
      for (let i = 0; i < s; i++) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
      this.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      this.setIndex(indices);
      this.computeVertexNormals();
    }
  }
  class TorusGeometry extends BufferGeometry {
    constructor(r = 1, tube = 0.3, rs = 10, ts = 24) {
      super();
      const rSeg = Math.max(6, rs), tSeg = Math.max(12, ts), verts = [], norms = [], indices = [];
      for (let j = 0; j <= rSeg; j++) {
        const v = (j / rSeg) * Math.PI * 2;
        const cv = Math.cos(v), sv = Math.sin(v);
        for (let i = 0; i <= tSeg; i++) {
          const u = (i / tSeg) * Math.PI * 2;
          const cu = Math.cos(u), su = Math.sin(u);
          const px = (r + tube * cv) * cu, py = (r + tube * cv) * su, pz = tube * sv;
          const nx = cv * cu, ny = cv * su, nz = sv;
          verts.push(px, py, pz);
          norms.push(nx, ny, nz);
        }
      }
      const stride = tSeg + 1;
      for (let j = 0; j < rSeg; j++) {
        for (let i = 0; i < tSeg; i++) {
          const a = j * stride + i, b = a + 1, c = (j + 1) * stride + i, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      this.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
      this.setAttribute('normal', new BufferAttribute(new Float32Array(norms), 3));
      this.setIndex(indices);
    }
  }
  class Material {
    constructor(opts = {}) {
      Object.assign(this, opts);
      this.color = new Color(opts.color !== undefined ? opts.color : 0xffffff);
      this.emissive = new Color(opts.emissive !== undefined ? opts.emissive : 0x000000);
      this.emissiveIntensity = opts.emissiveIntensity || 0.0;
      this.roughness = opts.roughness !== undefined ? opts.roughness : 0.65;
      this.metalness = opts.metalness !== undefined ? opts.metalness : 0.05;
      this.matType = opts.matType !== undefined ? opts.matType : 0;
    }
    clone() {
      return new Material({
        color: this.color.clone(), emissive: this.emissive.clone(),
        emissiveIntensity: this.emissiveIntensity, roughness: this.roughness,
        metalness: this.metalness, matType: this.matType,
        transparent: this.transparent, opacity: this.opacity, vertexColors: this.vertexColors
      });
    }
  }
  class Mesh extends Object3D { constructor(g = new BufferGeometry(), m = new Material()) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }
  class Points extends Object3D { constructor(g = new BufferGeometry(), m = new Material()) { super(); this.geometry = g; this.material = m; this.isPoints = true; } }
  class PerspectiveCamera extends Object3D { constructor(fov = 50, aspect = 1, near = 0.1, far = 1000) { super(); this.fov = fov; this.aspect = aspect; this.near = near; this.far = far; } updateProjectionMatrix() {} }

  function mat4Multiply(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const a0 = a[i], a1 = a[i+4], a2 = a[i+8], a3 = a[i+12];
      o[i] = a0*b[0]+a1*b[1]+a2*b[2]+a3*b[3]; o[i+4] = a0*b[4]+a1*b[5]+a2*b[6]+a3*b[7];
      o[i+8] = a0*b[8]+a1*b[9]+a2*b[10]+a3*b[11]; o[i+12] = a0*b[12]+a1*b[13]+a2*b[14]+a3*b[15];
    }
    return o;
  }
  function mat4Perspective(fovDeg, aspect, near, far) {
    const f = 1.0 / Math.tan((fovDeg * 0.5 * Math.PI) / 180), nf = 1 / (near - far), o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = (2 * far * near) * nf; return o;
  }
  function mat4Ortho(l, r, b, t, n, f) {
    const lr = 1/(l-r), bt = 1/(b-t), nf = 1/(n-f), o = new Float32Array(16);
    o[0] = -2*lr; o[5] = -2*bt; o[10] = 2*nf; o[12] = (l+r)*lr; o[13] = (t+b)*bt; o[14] = (f+n)*nf; o[15] = 1; return o;
  }
  function mat4LookAt(eye, center, up) {
    let z0 = eye.x-center.x, z1 = eye.y-center.y, z2 = eye.z-center.z, len = Math.hypot(z0,z1,z2)||1;
    z0/=len; z1/=len; z2/=len;
    let x0 = up.y*z2-up.z*z1, x1 = up.z*z0-up.x*z2, x2 = up.x*z1-up.y*z0; len = Math.hypot(x0,x1,x2)||1;
    x0/=len; x1/=len; x2/=len;
    const y0 = z1*x2-z2*x1, y1 = z2*x0-z0*x2, y2 = z0*x1-z1*x0, o = new Float32Array(16);
    o[0]=x0; o[1]=y0; o[2]=z0; o[4]=x1; o[5]=y1; o[6]=z1; o[8]=x2; o[9]=y2; o[10]=z2;
    o[12]=-(x0*eye.x+x1*eye.y+x2*eye.z); o[13]=-(y0*eye.x+y1*eye.y+y2*eye.z); o[14]=-(z0*eye.x+z1*eye.y+z2*eye.z); o[15]=1; return o;
  }
  function mat4Compose(pos, rot, scl) {
    const cx = Math.cos(rot.x), sx = Math.sin(rot.x), cy = Math.cos(rot.y), sy = Math.sin(rot.y), cz = Math.cos(rot.z), sz = Math.sin(rot.z), o = new Float32Array(16);
    o[0]=(cy*cz)*scl.x; o[1]=(cy*sz)*scl.x; o[2]=(-sy)*scl.x;
    o[4]=(sx*sy*cz-cx*sz)*scl.y; o[5]=(sx*sy*sz+cx*cz)*scl.y; o[6]=(sx*cy)*scl.y;
    o[8]=(cx*sy*cz+sx*sz)*scl.z; o[9]=(cx*sy*sz-sx*cz)*scl.z; o[10]=(cx*cy)*scl.z;
    o[12]=pos.x; o[13]=pos.y; o[14]=pos.z; o[15]=1; return o;
  }

  class WebGLRenderer {
    constructor(opts = {}) {
      this.domElement = opts.canvas || document.createElement('canvas');
      this.gl = this.domElement.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true }) ||
                this.domElement.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
      this.shadowMap = { enabled: true, type: 2 };
      this._startTime = performance.now();
      if (!this.gl) throw new Error('WebGL is unavailable');
      this._supportsUint32 = typeof this.gl.texStorage2D === 'function' || !!this.gl.getExtension('OES_element_index_uint');
      this._initShaders();
    }
    setSize(w, h) { this.domElement.width = w; this.domElement.height = h; }
    setPixelRatio() {}
    _link(vsSrc, fsSrc) {
      const gl = this.gl, p = gl.createProgram();
      for (const [t, s] of [[gl.VERTEX_SHADER, vsSrc], [gl.FRAGMENT_SHADER, fsSrc]]) {
        const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed: ' + gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Shader linking failed: ' + gl.getProgramInfoLog(p));
      for (const sh of gl.getAttachedShaders(p)) { gl.detachShader(p, sh); gl.deleteShader(sh); }
      return p;
    }
    _initShaders() {
      const gl = this.gl; gl.enable(gl.DEPTH_TEST);
      this.shadowProg = this._link(
        `attribute vec3 aPosition; uniform mat4 uModel, uLightVP; void main(){ gl_Position = uLightVP * uModel * vec4(aPosition, 1.0); }`,
        `precision highp float; void main(){ float d = clamp(gl_FragCoord.z, 0.0, 1.0); gl_FragColor = vec4(floor(d*255.0)/255.0, fract(d*255.0), 0.0, 1.0); }`
      );
      this.sLoc = { aPosition: gl.getAttribLocation(this.shadowProg, 'aPosition'), uModel: gl.getUniformLocation(this.shadowProg, 'uModel'), uLightVP: gl.getUniformLocation(this.shadowProg, 'uLightVP') };
      this.shadowSize = 1024;
      this.shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.shadowSize, this.shadowSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.shadowSize, this.shadowSize);
      this.shadowFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shadowTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.mainProg = this._link(`
        attribute vec3 aPosition, aNormal, aColor;
        uniform mat4 uModel, uVP, uLightVP;
        varying vec3 vWorldPos, vLocalPos, vNormal, vColor; varying vec4 vShadowCoord;
        void main() {
          vec4 wp = uModel * vec4(aPosition, 1.0);
          vWorldPos = wp.xyz;
          vLocalPos = aPosition;
          vNormal = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal);
          vColor = aColor; vShadowCoord = uLightVP * wp; gl_Position = uVP * wp; gl_PointSize = 3.0;
        }`, `
        precision highp float;
        varying vec3 vWorldPos, vLocalPos, vNormal, vColor; varying vec4 vShadowCoord;
        uniform vec3 uBaseColor, uEmissive, uCameraPos, uSkyColor, uSunDir, uSunColor;
        uniform float uRoughness, uOpacity, uUseVertexColors, uUnlit, uTime, uSunIntensity, uMatType;
        uniform sampler2D uShadowMap;
        uniform vec3 uPointPos0, uPointCol0, uPointPos1, uPointCol1, uPointPos2, uPointCol2, uPointPos3, uPointCol3;
        uniform float uPointInt0, uPointInt1, uPointInt2, uPointInt3;

        float unpack(vec4 c) { return c.r + c.g / 255.0; }
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise2(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y);
        }
        float computeShadow(vec4 sc) {
          vec3 proj = sc.xyz / sc.w * 0.5 + 0.5;
          if (proj.x<0.01||proj.x>0.99||proj.y<0.01||proj.y>0.99||proj.z>0.995) return 1.0;
          float b = 0.0012, tx = 1.0 / 1024.0;
          float s0 = (proj.z-b > unpack(texture2D(uShadowMap, proj.xy))) ? 0.22 : 1.0;
          float s1 = (proj.z-b > unpack(texture2D(uShadowMap, proj.xy+vec2(tx,0)))) ? 0.22 : 1.0;
          float s2 = (proj.z-b > unpack(texture2D(uShadowMap, proj.xy-vec2(tx,0)))) ? 0.22 : 1.0;
          float s3 = (proj.z-b > unpack(texture2D(uShadowMap, proj.xy+vec2(0,tx)))) ? 0.22 : 1.0;
          float s4 = (proj.z-b > unpack(texture2D(uShadowMap, proj.xy-vec2(0,tx)))) ? 0.22 : 1.0;
          return (s0+s1+s2+s3+s4)*0.2;
        }
        vec3 ptLight(vec3 pPos, vec3 pCol, float pInt, vec3 N, vec3 alb) {
          if (pInt <= 0.01) return vec3(0.0);
          vec3 v = pPos - vWorldPos; float d = length(v);
          float att = 1.0 / (1.0 + 0.055*d + 0.011*d*d);
          return alb * pCol * pInt * (max(0.0, dot(N, v/max(d,0.001)))*0.75 + 0.25) * att;
        }
        void main() {
          float isBakedAsset = step(90.0, uMatType);
          vec3 albedo = mix(uBaseColor, vColor, max(uUseVertexColors, isBakedAsset));
          if (uUnlit > 0.5) { gl_FragColor = vec4(albedo + uEmissive, uOpacity); return; }
          vec3 N = normalize(vNormal), V = normalize(uCameraPos - vWorldPos);
          vec3 L = normalize(uSunDir);
          float sssGlow = 0.0;
          float effMat = uMatType;
          if (isBakedAsset > 0.5) {
            if (albedo.g > albedo.r * 1.15 && albedo.g > albedo.b * 1.12) effMat = 1.0;
            else if (albedo.r > 0.52 && albedo.g > 0.18 && albedo.g < 0.62 && albedo.b < 0.16 && abs(N.y) > 0.25) effMat = 4.0;
            else if (albedo.r > 0.22 && albedo.r < 0.60 && albedo.g > 0.08 && albedo.g < 0.38 && albedo.b < 0.20) effMat = 2.0;
            else effMat = 3.0;
          }

          if (uUseVertexColors > 0.5) {
            // Terrain Grass, Rock Cliffs & Cobblestone Roads
            float nm = noise2(vWorldPos.xz*2.4)*0.15 + noise2(vWorldPos.xz*9.5)*0.07;
            float st = sin(vWorldPos.y*3.2 + nm*6.5)*0.05;
            albedo *= (0.90 + nm + st); N = normalize(N + vec3(nm-0.1, 0.0, st)*0.48);
          } else if (uRoughness < 0.22 && uOpacity < 0.9) {
            // River Water Waves & Specular Ripples
            float wv1 = sin(vWorldPos.x*2.8 + uTime*3.6)*cos(vWorldPos.z*2.6 - uTime*4.2);
            float wv2 = sin((vWorldPos.x+vWorldPos.z)*4.5 - uTime*5.0)*0.5;
            float wv = wv1*0.65 + wv2*0.35;
            N = normalize(N + vec3(wv*0.24, 0.0, wv*0.24));
            albedo += vec3(max(0.0, wv)*0.18);
          } else if (abs(effMat - 1.0) < 0.4) {
            // MAT 1: Lush Organic Tree Foliage & Leaf Clusters with Subsurface Scattering
            float lf1 = noise2(vLocalPos.xy * 9.5 + vLocalPos.z * 7.5);
            float lf2 = noise2(vWorldPos.xz * 14.0 + vWorldPos.y * 11.0);
            float tuft = lf1 * 0.65 + lf2 * 0.35;
            albedo *= (0.82 + tuft * 0.38);
            albedo = mix(albedo * vec3(0.75, 0.88, 0.72), albedo * vec3(1.12, 1.18, 0.85), clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
            N = normalize(N + vec3(lf1 - 0.5, (tuft - 0.5) * 0.6, lf2 - 0.5) * 0.62);
            sssGlow = pow(clamp(dot(-L, V) * 0.5 + 0.5, 0.0, 1.0), 2.0) * max(0.0, N.y + 0.4) * 0.28;
          } else if (abs(effMat - 2.0) < 0.4) {
            // MAT 2: Gnarled Tree Bark & Hewn Timber Wood Grain
            float grain = sin(vLocalPos.x * 28.0 + noise2(vLocalPos.xy * 6.5) * 5.5) * 0.5 + 0.5;
            float bark = noise2(vec2(atan(vLocalPos.x, vLocalPos.z) * 6.0, vLocalPos.y * 5.5));
            float wMix = grain * 0.55 + bark * 0.45;
            albedo *= (0.80 + wMix * 0.36);
            N = normalize(N + vec3((wMix - 0.5) * 0.48, (bark - 0.5) * 0.18, (grain - 0.5) * 0.48));
          } else if (abs(effMat - 3.0) < 0.4) {
            // MAT 3: Chiseled Stone Masonry, Ashlar Blocks & Cobblestone
            float row = floor(vLocalPos.y * 4.2);
            float colX = (vLocalPos.x + vLocalPos.z) * 2.6 + mod(row, 2.0) * 0.5;
            float mortarY = smoothstep(0.04, 0.12, fract(vLocalPos.y * 4.2)) * smoothstep(0.96, 0.88, fract(vLocalPos.y * 4.2));
            float mortarX = smoothstep(0.04, 0.11, fract(colX)) * smoothstep(0.96, 0.89, fract(colX));
            float mortar = mortarX * mortarY;
            float blockHash = hash2(vec2(floor(colX), row));
            float rockMicro = noise2(vWorldPos.xz * 16.0 + vWorldPos.y * 12.0);
            albedo *= (0.88 + blockHash * 0.16 + rockMicro * 0.08) * (0.72 + 0.28 * mortar);
            N = normalize(N + vec3((rockMicro - 0.5) * 0.38, (1.0 - mortar) * 0.28, (blockHash - 0.5) * 0.32));
          } else if (abs(effMat - 4.0) < 0.4) {
            // MAT 4: Scalloped Terracotta Roof Shingles, Slate Tiles & Layered Thatch
            float scallop = sin((vLocalPos.x + vLocalPos.z) * 20.0) * 0.5 + 0.5;
            float course = fract(vLocalPos.y * 8.5 + scallop * 0.18);
            float tileShadow = smoothstep(0.0, 0.22, course);
            float tileVar = hash2(vec2(floor((vLocalPos.x + vLocalPos.z) * 6.5), floor(vLocalPos.y * 8.5)));
            albedo *= (0.76 + 0.28 * tileShadow) * (0.90 + tileVar * 0.18);
            N = normalize(N + vec3((scallop - 0.5) * 0.32, (course - 0.5) * 0.45, (tileVar - 0.5) * 0.25));
          } else if (abs(effMat - 5.0) < 0.4) {
            // MAT 5: Ribbed Dirigible & Hot-Air Balloon Fabric / Canvas Sails
            float angle = atan(vLocalPos.x, vLocalPos.z);
            float goreSeam = smoothstep(0.06, 0.22, abs(sin(angle * 10.0)));
            float weave = noise2(vLocalPos.xy * 26.0 + vLocalPos.z * 26.0) * 0.08;
            albedo *= (0.84 + 0.20 * goreSeam + weave);
            N = normalize(N + vec3(cos(angle) * (1.0 - goreSeam) * 0.28, weave * 0.5, sin(angle) * (1.0 - goreSeam) * 0.28));
            sssGlow = 0.14;
          } else {
            // Default Micro-Texture
            float micro = noise2(vWorldPos.xz * 12.0 + vWorldPos.y * 8.0) * 0.10 + noise2(vWorldPos.xy * 24.0) * 0.05;
            float brick = step(0.08, fract(vWorldPos.y * 3.5)) * step(0.06, fract((vWorldPos.x + vWorldPos.z + floor(vWorldPos.y * 3.5)*0.5) * 2.2));
            albedo *= (0.93 + micro + (1.0 - brick) * (-0.06));
            N = normalize(N + vec3(micro - 0.07, (1.0 - brick)*0.08, micro - 0.07) * 0.35);
          }

          float ndotl = max(0.0, dot(N, L)), sh = computeShadow(vShadowCoord);
          vec3 skyAmb = mix(vec3(0.14,0.18,0.32), uSkyColor*0.68+vec3(0.22), clamp(uSunIntensity,0.2,1.0));
          vec3 amb = mix(vec3(0.14,0.20,0.15), skyAmb, N.y*0.5+0.5) * albedo * 0.36 * clamp((vWorldPos.y+18.0)/24.0,0.45,1.08);
          vec3 H = normalize(L + V);
          float spec = pow(max(0.0, dot(N, H)), mix(96.0, 10.0, uRoughness)) * mix(0.08, 0.92, 1.0-uRoughness);
          vec3 dir = (albedo*(ndotl*1.15 + sssGlow) + vec3(spec)*(uSunColor+0.25)) * uSunColor * uSunIntensity * sh;
          vec3 rim = pow(1.0 - max(0.0, dot(N, V)), 3.0) * uSunColor * uSunIntensity * (0.18 + sssGlow * 0.4) * albedo;
          vec3 pt = ptLight(uPointPos0,uPointCol0,uPointInt0,N,albedo) + ptLight(uPointPos1,uPointCol1,uPointInt1,N,albedo) +
                    ptLight(uPointPos2,uPointCol2,uPointInt2,N,albedo) + ptLight(uPointPos3,uPointCol3,uPointInt3,N,albedo);
          vec3 col = amb + dir + rim + pt + uEmissive;
          float cd = max(0.0, length(uCameraPos - vWorldPos) - 165.0);
          col = mix(col, uSkyColor, clamp(1.0 - exp(-pow(cd*0.006, 1.6)), 0.0, 0.65));
          gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.86)), uOpacity);
        }`
      );
      const u = (n) => gl.getUniformLocation(this.mainProg, n);
      this.mLoc = {
        aPosition: gl.getAttribLocation(this.mainProg, 'aPosition'), aNormal: gl.getAttribLocation(this.mainProg, 'aNormal'), aColor: gl.getAttribLocation(this.mainProg, 'aColor'),
        uModel: u('uModel'), uVP: u('uVP'), uLightVP: u('uLightVP'), uBaseColor: u('uBaseColor'), uEmissive: u('uEmissive'), uRoughness: u('uRoughness'),
        uOpacity: u('uOpacity'), uUseVertexColors: u('uUseVertexColors'), uUnlit: u('uUnlit'), uTime: u('uTime'), uMatType: u('uMatType'), uCameraPos: u('uCameraPos'),
        uSkyColor: u('uSkyColor'), uSunDir: u('uSunDir'), uSunColor: u('uSunColor'), uSunIntensity: u('uSunIntensity'), uShadowMap: u('uShadowMap'),
        pPos: [u('uPointPos0'), u('uPointPos1'), u('uPointPos2'), u('uPointPos3')],
        pCol: [u('uPointCol0'), u('uPointCol1'), u('uPointCol2'), u('uPointCol3')],
        pInt: [u('uPointInt0'), u('uPointInt1'), u('uPointInt2'), u('uPointInt3')]
      };
    }
    _ensureGLBuffers(geom) {
      const gl = this.gl, pos = geom.attributes.position; if (!pos) return null;
      if (!geom.attributes.normal) geom.computeVertexNormals();
      const norm = geom.attributes.normal;
      let col = geom.attributes.color;
      if (!col) { const o = new Float32Array(pos.count*3); o.fill(1); col = new BufferAttribute(o, 3); geom.attributes.color = col; }
      if (!geom._gl) { geom._glCtx = gl; geom._gl = { posBuf: gl.createBuffer(), normBuf: gl.createBuffer(), colBuf: gl.createBuffer(), idxBuf: geom.index ? gl.createBuffer() : null, idxCount: 0, ver: -1 }; }
      if (geom._gl.ver !== geom._version || pos.needsUpdate || norm.needsUpdate || col.needsUpdate) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geom._gl.posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos.array, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, geom._gl.normBuf); gl.bufferData(gl.ARRAY_BUFFER, norm.array, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, geom._gl.colBuf); gl.bufferData(gl.ARRAY_BUFFER, col.array, gl.DYNAMIC_DRAW);
        if (geom.index && geom._gl.idxBuf) { const large = geom.index.some(i => i > 65535);
          if (large && !this._supportsUint32) throw new Error('32-bit mesh indices require WebGL2 or OES_element_index_uint');
          const ia = large ? new Uint32Array(geom.index) : new Uint16Array(geom.index);
          geom._gl.indexType = large ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geom._gl.idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ia, gl.STATIC_DRAW); geom._gl.idxCount = ia.length; }
        pos.needsUpdate = norm.needsUpdate = col.needsUpdate = false; geom._gl.ver = geom._version;
      }
      return geom._gl;
    }
    render(scene, camera) {
      const gl = this.gl; if (!gl) return;
      const w = this.domElement.width, h = this.domElement.height, elapsed = (performance.now() - this._startTime) * 0.001;
      const meshes = [], pointLights = []; let mainDirLight = null;
      const traverse = (obj, pMat, pCast = false) => {
        if (!obj || !obj.visible) return;
        const cast = obj.castShadow || pCast; obj._effectiveCastShadow = cast;
        const lMat = mat4Compose(obj.position, obj.rotation, obj.scale), wMat = pMat ? mat4Multiply(pMat, lMat) : lMat;
        if (obj.isDirectionalLight) { if (!mainDirLight || obj.intensity > mainDirLight.intensity) mainDirLight = obj; }
        else if (obj.isPointLight) pointLights.push(obj);
        else if ((obj.isMesh || obj.isPoints) && obj.geometry && obj.geometry.attributes.position) meshes.push({ obj, worldMat: wMat });
        for (const ch of obj.children) traverse(ch, wMat, cast);
      };
      traverse(scene, null, false);

      const sp = mainDirLight ? mainDirLight.position : new Vector3(45, 75, 35), sl = Math.hypot(sp.x, sp.y, sp.z) || 1;
      const sunDir = new Vector3(sp.x/sl, Math.max(0.28, sp.y/sl), sp.z/sl).normalize();
      const lightVP = mat4Multiply(mat4Ortho(-105, 105, -105, 105, 15, 320), mat4LookAt(new Vector3(sunDir.x*160, sunDir.y*160, sunDir.z*160), new Vector3(0,0,0), new Vector3(0,1,0)));

      if (this.mLoc.aNormal >= 0) gl.disableVertexAttribArray(this.mLoc.aNormal);
      if (this.mLoc.aColor >= 0) gl.disableVertexAttribArray(this.mLoc.aColor);
      if (((this._f = (this._f || 0) + 1) % 3) === 1) { gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO); gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.shadowProg); gl.uniformMatrix4fv(this.sLoc.uLightVP, false, lightVP); gl.enableVertexAttribArray(this.sLoc.aPosition);
      for (const { obj, worldMat } of meshes) {
        if (!obj._effectiveCastShadow || obj.isPoints || (obj.material && obj.material.transparent)) continue;
        const b = this._ensureGLBuffers(obj.geometry); if (!b || !b.idxCount) continue;
        gl.uniformMatrix4fv(this.sLoc.uModel, false, worldMat); gl.bindBuffer(gl.ARRAY_BUFFER, b.posBuf);
        gl.vertexAttribPointer(this.sLoc.aPosition, 3, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idxBuf);
        gl.drawElements(gl.TRIANGLES, b.idxCount, b.indexType, 0);
      } }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
      const bg = scene.background || new Color(0x60a5fa); gl.clearColor(bg.r, bg.g, bg.b, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.mainProg); const L = this.mLoc;
      const camVP = mat4Multiply(mat4Perspective(camera.fov, w/Math.max(1,h), camera.near, camera.far), mat4LookAt(camera.position, camera._lookTarget || new Vector3(0,4,0), new Vector3(0,1,0)));
      gl.uniformMatrix4fv(L.uVP, false, camVP); gl.uniformMatrix4fv(L.uLightVP, false, lightVP);
      gl.uniform3f(L.uCameraPos, camera.position.x, camera.position.y, camera.position.z);
      gl.uniform3f(L.uSkyColor, bg.r, bg.g, bg.b); gl.uniform3f(L.uSunDir, sunDir.x, sunDir.y, sunDir.z);
      const sc = mainDirLight ? mainDirLight.color : new Color(0xfffbeb), si = mainDirLight ? Math.max(0.32, mainDirLight.intensity) : 1.2;
      gl.uniform3f(L.uSunColor, sc.r, sc.g, sc.b); gl.uniform1f(L.uSunIntensity, si); gl.uniform1f(L.uTime, elapsed);
      for (let i = 0; i < 4; i++) {
        const pl = pointLights[i];
        if (pl) { gl.uniform3f(L.pPos[i], pl.position.x, pl.position.y, pl.position.z); gl.uniform3f(L.pCol[i], pl.color.r, pl.color.g, pl.color.b); gl.uniform1f(L.pInt[i], pl.intensity); }
        else gl.uniform1f(L.pInt[i], 0);
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(L.uShadowMap, 0);
      gl.enableVertexAttribArray(L.aPosition); gl.enableVertexAttribArray(L.aNormal); gl.enableVertexAttribArray(L.aColor);

      const detectMatType = (mat) => {
        if (mat.matType) return mat.matType;
        const r = mat.color.r, g = mat.color.g, b = mat.color.b;
        // Green foliage / leaves / crops
        if (g > r * 1.25 && g > b * 1.18) return 1.0;
        // Brown bark / wood / timber
        if (r > 0.35 && r < 0.72 && g > 0.12 && g < 0.45 && b < 0.22 && r > g * 1.35) return 2.0;
        // Terracotta / thatch roof
        if (r > 0.65 && g > 0.25 && g < 0.62 && b < 0.18) return 4.0;
        // Stone / masonry / plaster
        if (Math.abs(r - g) < 0.08 && Math.abs(g - b) < 0.12 && r > 0.25 && r < 0.85) return 3.0;
        return 0.0;
      };

      const draw = ({ obj, worldMat }) => {
        const mat = obj.material || new Material(); if (mat.transparent && mat.opacity <= 0.02) return;
        const b = this._ensureGLBuffers(obj.geometry); if (!b) return;
        gl.uniformMatrix4fv(L.uModel, false, worldMat); gl.uniform3f(L.uBaseColor, mat.color.r, mat.color.g, mat.color.b);
        const ei = mat.emissiveIntensity || 0; gl.uniform3f(L.uEmissive, mat.emissive.r*ei, mat.emissive.g*ei, mat.emissive.b*ei);
        gl.uniform1f(L.uRoughness, mat.roughness !== undefined ? mat.roughness : 0.65);
        gl.uniform1f(L.uOpacity, mat.transparent ? (mat.opacity !== undefined ? mat.opacity : 0.8) : 1.0);
        gl.uniform1f(L.uUseVertexColors, mat.vertexColors ? 1 : 0); gl.uniform1f(L.uUnlit, mat.isBasic || obj.isPoints ? 1 : 0);
        gl.uniform1f(L.uMatType, detectMatType(mat));
        gl.bindBuffer(gl.ARRAY_BUFFER, b.posBuf); gl.vertexAttribPointer(L.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.normBuf); gl.vertexAttribPointer(L.aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.colBuf); gl.vertexAttribPointer(L.aColor, 3, gl.FLOAT, false, 0, 0);
        if (obj.isPoints) gl.drawArrays(gl.POINTS, 0, obj.geometry.attributes.position.count);
        else if (b.idxCount > 0) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idxBuf); gl.drawElements(gl.TRIANGLES, b.idxCount, b.indexType, 0); }
      };
      gl.disable(gl.BLEND); gl.depthMask(true);
      for (const m of meshes) if (!m.obj.material || !m.obj.material.transparent) draw(m);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      for (const m of meshes) if (m.obj.material && m.obj.material.transparent) draw(m);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
  }
  window.THREE = {
    Color, Vector2, Vector3, Object3D, Group: Object3D, Scene: Object3D, BufferAttribute, Float32BufferAttribute: BufferAttribute,
    BufferGeometry, PlaneGeometry, BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, OctahedronGeometry, DodecahedronGeometry, IcosahedronGeometry: SphereGeometry, RingGeometry, TorusGeometry,
    MeshStandardMaterial: Material, MeshPhongMaterial: Material, MeshLambertMaterial: Material,
    MeshBasicMaterial: class extends Material { constructor(o) { super(o); this.isBasic = true; } },
    PointsMaterial: class extends Material { constructor(o) { super(o); this.isBasic = true; } },
    LineBasicMaterial: class extends Material { constructor(o) { super(o); this.isBasic = true; } },
    Mesh, Points, Line: Mesh, PerspectiveCamera, WebGLRenderer, AmbientLight: Object3D, HemisphereLight: Object3D,
    DirectionalLight: class extends Object3D { constructor(c, i) { super(); this.color = new Color(c); this.intensity = i; this.isDirectionalLight = true; this.shadow = { mapSize: {}, camera: {} }; this.target = new Object3D(); } },
    PointLight: class extends Object3D { constructor(c, i, d) { super(); this.color = new Color(c); this.intensity = i; this.distance = d; this.isPointLight = true; } },
    FogExp2: class { constructor(c, d) { this.color = new Color(c); this.density = d; } },
    Raycaster: class {
      constructor() { this.origin = new Vector3(); this.dir = new Vector3(0, -1, 0); }
      setFromCamera(ndc, cam) {
        this.origin.copy(cam.position);
        const tgt = cam._lookTarget || new Vector3(0, 4, 0);
        const fx = tgt.x - cam.position.x, fy = tgt.y - cam.position.y, fz = tgt.z - cam.position.z;
        const fl = Math.hypot(fx, fy, fz) || 1;
        const F = { x: fx / fl, y: fy / fl, z: fz / fl };
        // Right = normalize(cross(F, (0,1,0)))
        let rx = -F.z, ry = 0, rz = F.x;
        const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
        // Up = cross(R, F)
        const ux = ry * F.z - rz * F.y, uy = rz * F.x - rx * F.z, uz = rx * F.y - ry * F.x;
        const tanFov = Math.tan((cam.fov * 0.5 * Math.PI) / 180);
        const asp = cam.aspect || (window.innerWidth / Math.max(1, window.innerHeight));
        const dx = F.x + rx * (ndc.x * tanFov * asp) + ux * (ndc.y * tanFov);
        const dy = F.y + ry * (ndc.x * tanFov * asp) + uy * (ndc.y * tanFov);
        const dz = F.z + rz * (ndc.x * tanFov * asp) + uz * (ndc.y * tanFov);
        const dl = Math.hypot(dx, dy, dz) || 1;
        this.dir.set(dx / dl, dy / dl, dz / dl);
      }
      intersectObject() {
        if (Math.abs(this.dir.y) < 0.001) return [];
        let hEst = 4.15, t = 0, px = 0, pz = 0;
        for (let step = 0; step < 3; step++) {
          t = (hEst - this.origin.y) / this.dir.y;
          if (t <= 0 || t > 480) return [];
          px = this.origin.x + this.dir.x * t;
          pz = this.origin.z + this.dir.z * t;
          if (window._getTerrainHeightAt) hEst = window._getTerrainHeightAt(px, pz);
        }
        if (Math.hypot(px, pz) > 115) return [];
        return [{ point: new Vector3(px, hEst, pz), distance: t }];
      }
      intersectObjects(objs) {
        const hits = [];
        for (const o of objs) {
          if (!o || !o.visible || !o.userData || !o.userData.entity) continue;
          const vx = o.position.x - this.origin.x, vy = (o.position.y + 1.2) - this.origin.y, vz = o.position.z - this.origin.z;
          const proj = vx * this.dir.x + vy * this.dir.y + vz * this.dir.z;
          if (proj <= 0) continue;
          const cx = this.origin.x + this.dir.x * proj - o.position.x;
          const cy = this.origin.y + this.dir.y * proj - (o.position.y + 1.2);
          const cz = this.origin.z + this.dir.z * proj - o.position.z;
          const dSq = cx * cx + cy * cy + cz * cz;
          const entType = o.userData.entity.type;
          const hitSq = (entType === 'airship' || entType === 'temple' || entType === 'windmill') ? 24.0 : 8.5;
          if (dSq < hitSq) hits.push({ object: o, distance: proj, dSq });
        }
        hits.sort((a, b) => a.dSq - b.dSq);
        return hits;
      }
    },
    Clock: class { constructor() { this.last = performance.now(); } getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; return d; } },
    MathUtils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t },
    DoubleSide: 2, AdditiveBlending: 2, PCFSoftShadowMap: 2, sRGBEncoding: 3001, ACESFilmicToneMapping: 4
  };
})();
