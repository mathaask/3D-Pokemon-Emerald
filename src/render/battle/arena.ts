// Procedural 3D battle arena, themed per battle environment and tinted with colours sampled
// from the game's own terrain background.

import * as THREE from 'three';

const ENV = { GRASS: 0, LONG_GRASS: 1, SAND: 2, UNDERWATER: 3, WATER: 4, POND: 5, MOUNTAIN: 6, CAVE: 7, BUILDING: 8, PLAIN: 9 };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Small pixel-art style noise texture: base colour with darker/lighter speckles. */
function speckleTexture(base: THREE.Color, size = 64, seed = 1, contrast = 0.12): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = seeded(seed);
  const img = g.createImageData(size, size);
  const srgb = base.clone().convertLinearToSRGB();
  for (let i = 0; i < size * size; i++) {
    const r = rnd();
    const k = r < 0.08 ? 1 - contrast * 1.6 : r > 0.94 ? 1 + contrast : 1 + (rnd() - 0.5) * contrast * 0.4;
    img.data[i * 4] = Math.min(255, srgb.r * 255 * k);
    img.data[i * 4 + 1] = Math.min(255, srgb.g * 255 * k);
    img.data[i * 4 + 2] = Math.min(255, srgb.b * 255 * k);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export class BattleArena {
  readonly group = new THREE.Group();
  skyColor = new THREE.Color(0.6, 0.8, 1);
  horizon = new THREE.Color(0.85, 0.92, 1);
  private props = new THREE.Group();
  private ground: THREE.Mesh;
  private groundMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  private platformTop = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private platformSide = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  private platforms: THREE.Mesh[] = [];
  private water: THREE.Mesh | null = null;
  private waterMat: THREE.ShaderMaterial | null = null;
  private grassTufts: THREE.InstancedMesh | null = null;
  private env = -1;
  private playerPos = new THREE.Vector3();
  private enemyPos = new THREE.Vector3();

  constructor() {
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.group.add(this.ground, this.props);
    // Platform tops are the reference ground (y = 0) so sprites stand on them, not in them.
    this.group.position.y = -0.28;
  }

  setPlatforms(player: THREE.Vector3, enemy: THREE.Vector3): void {
    this.playerPos.copy(player);
    this.enemyPos.copy(enemy);
    for (const p of this.platforms) this.group.remove(p);
    this.platforms = [];
    for (const [pos, r] of [[player, 2.1], [enemy, 1.9]] as [THREE.Vector3, number][]) {
      const geo = new THREE.CylinderGeometry(r, r * 1.08, 0.28, 48, 1);
      const mesh = new THREE.Mesh(geo, [this.platformSide, this.platformTop, this.platformSide]);
      mesh.position.set(pos.x, 0.14, pos.z);
      mesh.scale.set(1, 1, 0.62);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.platforms.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Colours sampled from the GBA terrain background (cheap; may be called repeatedly). */
  setColors(sky: THREE.Color, platform: THREE.Color, rim: THREE.Color): void {
    if (this.env !== ENV.CAVE) {
      this.skyColor.copy(sky);
      this.horizon.copy(sky).lerp(new THREE.Color(1, 1, 1), 0.35);
      if (this.env === ENV.BUILDING) this.horizon.multiplyScalar(0.6);
    }
    this.platformTop.map?.dispose();
    this.platformTop.map = speckleTexture(platform, 32, this.env + 3, 0.1);
    this.platformTop.map.repeat.set(2, 2);
    this.platformTop.needsUpdate = true;
    this.platformSide.color.copy(rim).multiplyScalar(0.8);
  }

  /** Builds the environment (ground, props) for a battle environment id. */
  setEnvironment(env: number): void {
    this.env = env;
    const sky = this.skyColor.clone();
    const platform = new THREE.Color(0.5, 0.6, 0.4);
    const rim = new THREE.Color(0.4, 0.4, 0.3);
    // The GBA backdrop between the platforms is a pale wash; use a proper base colour per
    // environment, nudged towards the sampled platform colour so special arenas still tint.
    const BASE: Record<number, number> = {
      [ENV.GRASS]: 0x5fae4e, [ENV.LONG_GRASS]: 0x4f9a43, [ENV.PLAIN]: 0x7cba5c, [ENV.SAND]: 0xd9c27c,
      [ENV.UNDERWATER]: 0x2a5d8f, [ENV.WATER]: 0x3d7fc4, [ENV.POND]: 0x4a8fb8, [ENV.MOUNTAIN]: 0x9a7b5c,
      [ENV.CAVE]: 0x6b5644, [ENV.BUILDING]: 0xb9b2a0,
    };
    const ground = new THREE.Color(BASE[env] ?? 0x9aa58a).convertSRGBToLinear();
    this.props.clear();
    if (this.water) { this.group.remove(this.water); this.water = null; this.waterMat = null; }
    this.grassTufts = null;
    const groundTex = speckleTexture(ground, 64, env + 7, env === ENV.SAND ? 0.08 : 0.14);
    groundTex.repeat.set(36, 36);
    this.groundMat.map = groundTex;
    this.groundMat.color.set(0xffffff);
    this.groundMat.needsUpdate = true;
    this.setColors(sky, platform, rim);
    this.ground.visible = true;

    const rnd = seeded(1234 + env);
    const center = this.playerPos.clone().lerp(this.enemyPos, 0.5);
    switch (env) {
      case ENV.GRASS:
      case ENV.LONG_GRASS:
      case ENV.PLAIN: {
        this.addTreeRing(center, rnd, ground);
        this.addGrass(center, rnd, ground, env === ENV.LONG_GRASS ? 1.8 : 1);
        break;
      }
      case ENV.SAND:
        this.addRocks(center, rnd, rim, 14, 22, 50);
        this.addDunes(center, rnd, ground);
        break;
      case ENV.WATER:
      case ENV.POND:
      case ENV.UNDERWATER:
        this.addWater(center, ground, sky, env === ENV.UNDERWATER);
        this.addRocks(center, rnd, rim, 10, 26, 60);
        break;
      case ENV.MOUNTAIN:
        this.addRocks(center, rnd, rim, 30, 18, 55);
        this.addCliffs(center, rnd, rim, 34);
        break;
      case ENV.CAVE:
        this.addCliffs(center, rnd, rim, 22);
        this.addRocks(center, rnd, rim, 26, 12, 30);
        this.horizon.set(0.05, 0.04, 0.05);
        this.skyColor.set(0.03, 0.03, 0.04);
        break;
      case ENV.BUILDING:
      default:
        this.addRoom(center, ground, rim);
        this.horizon.copy(sky).multiplyScalar(0.6);
        break;
    }
  }

  private addTreeRing(center: THREE.Vector3, rnd: () => number, ground: THREE.Color): void {
    const leaf = ground.clone().multiplyScalar(0.62);
    const leafMat = new THREE.MeshStandardMaterial({ color: leaf, roughness: 0.9, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3d24, roughness: 1 });
    const crown = new THREE.IcosahedronGeometry(1, 0);
    const trunk = new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6);
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2;
      // keep the space behind the camera and between the platforms clear
      const r = 24 + rnd() * 30;
      const p = new THREE.Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r * 0.8 - 6);
      if (p.z > center.z + 10) continue;
      const s = 0.55 + rnd() * 0.5;
      const t = new THREE.Mesh(trunk, trunkMat);
      t.position.set(p.x, 0.7 * s, p.z);
      t.scale.setScalar(s);
      const c = new THREE.Mesh(crown, leafMat);
      c.position.set(p.x, (1.4 + 0.9) * s, p.z);
      c.scale.set(1.3 * s, 1.5 * s, 1.3 * s);
      c.rotation.y = rnd() * 6;
      for (const m of [t, c]) { m.castShadow = true; m.receiveShadow = true; this.props.add(m); }
    }
  }

  private addGrass(center: THREE.Vector3, rnd: () => number, ground: THREE.Color, height: number): void {
    const blade = new THREE.ConeGeometry(0.06, 0.45 * height, 3);
    blade.translate(0, 0.22 * height, 0);
    const mat = new THREE.MeshStandardMaterial({ color: ground.clone().multiplyScalar(0.85), roughness: 1, flatShading: true });
    const n = 1400;
    const inst = new THREE.InstancedMesh(blade, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 3 + Math.sqrt(rnd()) * 26;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      // avoid the platforms
      if (Math.hypot(x - this.playerPos.x, (z - this.playerPos.z) / 0.62) < 2.4 ||
        Math.hypot(x - this.enemyPos.x, (z - this.enemyPos.z) / 0.62) < 2.2) { m.makeScale(0, 0, 0); inst.setMatrixAt(i, m); continue; }
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6, (rnd() - 0.5) * 0.4));
      const s = 0.6 + rnd() * 0.8;
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m);
    }
    inst.receiveShadow = true;
    this.grassTufts = inst;
    this.props.add(inst);
  }

  private addRocks(center: THREE.Vector3, rnd: () => number, color: THREE.Color, count: number, rMin: number, rMax: number): void {
    const mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.9), roughness: 0.95, flatShading: true });
    const geo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rMin + rnd() * (rMax - rMin);
      const p = new THREE.Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r - 4);
      if (p.z > center.z + 8) continue;
      const rock = new THREE.Mesh(geo, mat);
      const s = 0.6 + rnd() * 2.2;
      rock.position.set(p.x, s * 0.4, p.z);
      rock.scale.set(s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.6), s * (0.8 + rnd() * 0.6));
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.props.add(rock);
    }
  }

  private addCliffs(center: THREE.Vector3, rnd: () => number, color: THREE.Color, radius: number): void {
    const mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.75), roughness: 1, flatShading: true });
    for (let i = 0; i < 28; i++) {
      const a = Math.PI * (1.05 + (i / 27) * 0.9) + (rnd() - 0.5) * 0.05;
      const geo = new THREE.CylinderGeometry(2 + rnd() * 3, 4 + rnd() * 4, 8 + rnd() * 14, 6);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(center.x + Math.cos(a) * radius, 4, center.z + Math.sin(a) * radius - 6);
      m.rotation.y = rnd() * 3;
      m.castShadow = true;
      m.receiveShadow = true;
      this.props.add(m);
    }
  }

  private addDunes(center: THREE.Vector3, rnd: () => number, color: THREE.Color): void {
    const mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.95), roughness: 1 });
    for (let i = 0; i < 12; i++) {
      const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const d = new THREE.Mesh(g, mat);
      const a = Math.PI * (1.1 + rnd() * 0.8);
      const r = 30 + rnd() * 30;
      d.position.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r - 6);
      d.scale.set(8 + rnd() * 10, 2 + rnd() * 4, 5 + rnd() * 6);
      d.receiveShadow = true;
      this.props.add(d);
    }
  }

  private addWater(center: THREE.Vector3, ground: THREE.Color, sky: THREE.Color, under: boolean): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: ground.clone().multiplyScalar(0.7) },
        uShallow: { value: ground.clone().lerp(sky, 0.4) },
        uFog: { value: this.horizon },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vPos;
        void main() {
          vec3 p = position;
          p.z += sin(p.x * 0.6 + uTime * 1.3) * 0.06 + cos(p.y * 0.5 + uTime) * 0.06;
          vPos = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uDeep, uShallow, uFog;
        varying vec3 vPos;
        void main() {
          float w = sin(vPos.x * 1.7 + uTime * 1.1) * sin(vPos.z * 1.3 - uTime * 0.9);
          float sparkle = smoothstep(0.92, 1.0, w);
          vec3 c = mix(uDeep, uShallow, 0.5 + 0.5 * w) + sparkle * 0.25;
          float d = length(vPos.xz - cameraPosition.xz);
          c = mix(c, uFog, smoothstep(30.0, 90.0, d));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 60, 60), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = under ? 0.02 : 0.05;
    this.water = water;
    this.waterMat = mat;
    this.group.add(water);
    this.ground.visible = false;
    void center;
  }

  private addRoom(center: THREE.Vector3, floor: THREE.Color, wall: THREE.Color): void {
    const wallMat = new THREE.MeshStandardMaterial({ color: wall.clone().lerp(new THREE.Color(1, 1, 1), 0.25), roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), wallMat);
    back.position.set(center.x, 8, center.z - 22);
    back.receiveShadow = true;
    const left = back.clone();
    left.rotation.y = Math.PI / 2;
    left.position.set(center.x - 26, 8, center.z);
    const right = back.clone();
    right.rotation.y = -Math.PI / 2;
    right.position.set(center.x + 26, 8, center.z);
    this.props.add(back, left, right);
    // floor tiles: a second texture layer of large tiles
    const tiles = speckleTexture(floor, 8, 99, 0.18);
    tiles.repeat.set(70, 70);
    this.groundMat.map = tiles;
    this.groundMat.needsUpdate = true;
  }

  update(time: number, night: boolean): void {
    if (this.waterMat) this.waterMat.uniforms.uTime.value = time;
    void night;
  }
}
