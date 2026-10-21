import * as THREE from "three";
import { DEPARTMENTS, type DeptKey, type FleetModel, type RoleSeat } from "@/data/drenix-data";

export type NodeId = DeptKey | "hq" | "coo";

export interface SceneCallbacks {
  onHover: (id: NodeId | null) => void;
  onSelect: (id: NodeId | null) => void;
}

const COLOR = {
  bg: 0x15100e,
  accent: 0xee6b2c,
  accent2: 0xf3904f,
  a300: 0xffc5a6,
  a700: 0xa8430f,
  dark: 0x1d1512,
  glass: 0x3a2a22,
};

/** Scene layout (x, z) — mirrors the hierarchy: HQ at the back, CEO level in the middle, COO departments in front. */
const LAYOUT: Record<NodeId, [number, number]> = {
  hq: [0, -18],
  coo: [-18, -4],
  cfo: [-6, -4],
  uzbhr: [6, -4],
  it: [18, -4],
  dispatch: [-22, 9],
  fleet: [-11, 9],
  eld: [0, 9],
  safety: [11, 9],
  ushr: [22, 9],
};

const LINKS: [NodeId, NodeId][] = [
  ["hq", "coo"],
  ["hq", "cfo"],
  ["hq", "uzbhr"],
  ["hq", "it"],
  ["coo", "dispatch"],
  ["coo", "fleet"],
  ["coo", "eld"],
  ["coo", "safety"],
  ["coo", "ushr"],
];

const INTRO_DELAY: Record<NodeId, number> = {
  hq: 0,
  coo: 0.2,
  cfo: 0.3,
  uzbhr: 0.4,
  it: 0.5,
  dispatch: 0.65,
  fleet: 0.75,
  eld: 0.85,
  safety: 0.95,
  ushr: 1.05,
};

/** Horizontal spacing factor; narrower on portrait phones so the map fills the screen. */
let X_SCALE = 1;

const PLATFORM_H = 0.36;
const PLATFORM_W = 4.6;
const TOWER_W = 3.4;
const FLOOR_H = 0.64;
const CUBE = 0.36;

const damp = (dt: number, k = 8) => 1 - Math.exp(-dt * k);
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,220,200,0.55)");
  grd.addColorStop(0.6, "rgba(255,160,110,0.12)");
  grd.addColorStop(1, "rgba(255,140,90,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ----------------------------------------------------------------------------- shared resources

class Shared {
  glow = makeGlowTexture();
  floorBox = new THREE.BoxGeometry(TOWER_W, FLOOR_H * 0.94, TOWER_W);
  floorEdges = new THREE.EdgesGeometry(this.floorBox);
  slab = new THREE.BoxGeometry(TOWER_W + 0.08, 0.035, TOWER_W + 0.08);
  cube = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
  plane = new THREE.PlaneGeometry(1, 1);
  halo = new THREE.TorusGeometry(0.34, 0.022, 8, 40);
  platform = new THREE.BoxGeometry(PLATFORM_W, PLATFORM_H, PLATFORM_W);
  platformEdges = new THREE.EdgesGeometry(this.platform);

  glowMaterial(opacity: number, color = COLOR.accent) {
    return new THREE.MeshBasicMaterial({
      map: this.glow,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  groundGlow(size: number, opacity: number) {
    const m = new THREE.Mesh(this.plane, this.glowMaterial(opacity));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(size, size, 1);
    m.position.y = 0.02;
    m.renderOrder = -1;
    return m;
  }

  dispose() {
    this.glow.dispose();
    [this.floorBox, this.floorEdges, this.slab, this.cube, this.plane, this.halo, this.platform, this.platformEdges].forEach((g) =>
      g.dispose(),
    );
  }
}

// ----------------------------------------------------------------------------- nodes

abstract class SceneNode {
  group = new THREE.Group();
  /** Child that lifts on hover and scales during the intro */
  lift = new THREE.Group();
  hit: THREE.Mesh;
  bright = 1;
  targetBright = 1;
  baseBright = 1;
  intro = 0;
  liftY = 0;
  /** height of the label anchor above the ground */
  abstract topY(): number;
  abstract radius: number;

  constructor(public id: NodeId, private hitSize: [number, number, number]) {
    const [x, z] = LAYOUT[id];
    this.group.position.set(x * X_SCALE, 0, z);
    this.group.add(this.lift);
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(...hitSize), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = hitSize[1] / 2;
    this.hit.userData.nodeId = id;
    this.group.add(this.hit);
  }

  setHitHeight(h: number) {
    const base = this.hitSize[1];
    this.hit.scale.y = Math.max(0.2, h / base);
    this.hit.position.y = (base * this.hit.scale.y) / 2;
  }

  baseUpdate(dt: number, t: number, introStart: number | null, hovered: boolean) {
    const d = introStart === null ? 0 : (t - introStart - INTRO_DELAY[this.id]) / 0.9;
    this.intro = introStart === null ? 0 : easeOut(d);
    this.lift.scale.y = Math.max(0.001, this.intro);
    this.liftY += ((hovered ? 0.2 : 0) - this.liftY) * damp(dt, 10);
    this.lift.position.y = this.liftY;
    this.bright += (this.targetBright * this.baseBright - this.bright) * damp(dt, 7);
  }

  abstract update(dt: number, t: number, introStart: number | null, hovered: boolean): void;
}

// ---- Department building -----------------------------------------------------

interface Cube {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  x: number;
  z: number;
  y: number;
  tx: number;
  tz: number;
  ty: number;
  fade: number;
  tFade: number;
  removing: boolean;
}

interface Floor {
  roleId: string;
  lead: boolean;
  group: THREE.Group;
  glassMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.LineBasicMaterial;
  slabMat: THREE.MeshStandardMaterial;
  cubes: Cube[];
  y: number;
  ty: number;
  fade: number;
  tFade: number;
  removing: boolean;
  pad?: THREE.Mesh;
  halo?: THREE.Mesh;
}

class DeptBuilding extends SceneNode {
  radius = 2.6;
  floors = new Map<string, Floor>();
  top = PLATFORM_H;
  targetTop = PLATFORM_H;
  highlight: string | null = null;
  platformMat: THREE.MeshStandardMaterial;
  platformEdgeMat: THREE.LineBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;

  constructor(id: DeptKey, private s: Shared, private parent: THREE.Scene) {
    super(id, [PLATFORM_W, 4, PLATFORM_W]);
    this.platformMat = new THREE.MeshStandardMaterial({ color: COLOR.dark, metalness: 0.55, roughness: 0.45, transparent: true });
    const platform = new THREE.Mesh(s.platform, this.platformMat);
    platform.position.y = PLATFORM_H / 2;
    platform.castShadow = true;
    platform.receiveShadow = true;
    this.platformEdgeMat = new THREE.LineBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.6 });
    const edges = new THREE.LineSegments(s.platformEdges, this.platformEdgeMat);
    edges.position.y = PLATFORM_H / 2;
    this.lift.add(platform, edges);
    const glow = s.groundGlow(9, 0.16);
    this.glowMat = glow.material as THREE.MeshBasicMaterial;
    this.group.add(glow);
    parent.add(this.group);
  }

  topY() {
    return this.top * this.intro + this.liftY;
  }

  private makeCube(lead: boolean): Cube {
    const mat = new THREE.MeshStandardMaterial({
      color: lead ? COLOR.accent : 0xf3ece8,
      emissive: lead ? COLOR.accent : 0xffc5a6,
      emissiveIntensity: lead ? 1.6 : 0.18,
      metalness: 0.2,
      roughness: 0.4,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(this.s.cube, mat);
    mesh.castShadow = true;
    return { mesh, mat, x: 0, z: 0, y: 0, tx: 0, tz: 0, ty: 0, fade: 0, tFade: 1, removing: false };
  }

  private layoutCubes(f: Floor, count: number, animate: boolean) {
    const live = f.cubes.filter((c) => !c.removing);
    while (live.length < count) {
      const c = this.makeCube(f.lead);
      f.group.add(c.mesh);
      f.cubes.push(c);
      live.push(c);
      c.y = animate ? 2.6 : 0;
      c.fade = animate ? 0 : 1;
    }
    while (live.length > count) {
      const c = live.pop()!;
      c.removing = true;
      c.tFade = 0;
      c.ty = 1.4;
    }
    const cols = Math.min(4, Math.max(1, count));
    const rows = Math.ceil(count / cols);
    const gap = 0.66;
    live.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? count - row * cols : cols;
      c.tx = (col - (inRow - 1) / 2) * gap;
      c.tz = (row - (rows - 1) / 2) * gap;
      c.ty = 0;
      c.tFade = 1;
      if (!animate) {
        c.x = c.tx;
        c.z = c.tz;
      } else if (c.fade === 0) {
        c.x = c.tx;
        c.z = c.tz;
      }
    });
  }

  private makeFloor(role: RoleSeat): Floor {
    const group = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({
      color: COLOR.glass,
      emissive: COLOR.accent,
      emissiveIntensity: 0.04,
      metalness: 0.3,
      roughness: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(this.s.floorBox, glassMat);
    glass.position.y = FLOOR_H / 2;
    glass.renderOrder = 2;
    const edgeMat = new THREE.LineBasicMaterial({ color: COLOR.accent2, transparent: true, opacity: 0 });
    const edges = new THREE.LineSegments(this.s.floorEdges, edgeMat);
    edges.position.y = FLOOR_H / 2;
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x4a362c, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0 });
    const slab = new THREE.Mesh(this.s.slab, slabMat);
    slab.position.y = 0.0175;
    slab.receiveShadow = true;
    group.add(slab, glass, edges);
    const f: Floor = {
      roleId: role.id,
      lead: !!role.lead,
      group,
      glassMat,
      edgeMat,
      slabMat,
      cubes: [],
      y: 0,
      ty: 0,
      fade: 0,
      tFade: 1,
      removing: false,
    };
    if (role.lead) {
      const pad = new THREE.Mesh(this.s.plane, this.s.glowMaterial(0.9));
      pad.rotation.x = -Math.PI / 2;
      pad.scale.set(1.3, 1.3, 1);
      pad.position.y = 0.05;
      const halo = new THREE.Mesh(this.s.halo, new THREE.MeshBasicMaterial({ color: COLOR.a300, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.66;
      group.add(pad, halo);
      f.pad = pad;
      f.halo = halo;
    }
    this.lift.add(group);
    return f;
  }

  setRoles(roles: RoleSeat[], animate: boolean) {
    const lead = roles.filter((r) => r.lead);
    const rest = roles.filter((r) => !r.lead);
    const stack = [...rest].reverse().concat(lead); // bottom → top, manager floor on top
    const keep = new Set(stack.map((r) => r.id));
    for (const f of this.floors.values()) {
      if (!keep.has(f.roleId) && !f.removing) {
        f.removing = true;
        f.tFade = 0;
        f.ty = f.y + 1.6;
        f.cubes.forEach((c) => {
          c.removing = true;
          c.tFade = 0;
        });
      }
    }
    stack.forEach((role, i) => {
      let f = this.floors.get(role.id);
      if (!f || f.removing) {
        if (f) this.disposeFloor(f);
        f = this.makeFloor(role);
        this.floors.set(role.id, f);
        f.y = PLATFORM_H + i * FLOOR_H + (animate ? 0.8 : 0);
        f.fade = animate ? 0 : 1;
      }
      f.ty = PLATFORM_H + i * FLOOR_H;
      f.tFade = 1;
      this.layoutCubes(f, role.count, animate);
    });
    this.targetTop = PLATFORM_H + stack.length * FLOOR_H;
    if (!animate) this.top = this.targetTop;
    this.baseBright = stack.length ? 1 : 0.5;
  }

  private disposeFloor(f: Floor) {
    this.lift.remove(f.group);
    f.glassMat.dispose();
    f.edgeMat.dispose();
    f.slabMat.dispose();
    f.cubes.forEach((c) => c.mat.dispose());
    if (f.pad) (f.pad.material as THREE.Material).dispose();
    if (f.halo) (f.halo.material as THREE.Material).dispose();
    this.floors.delete(f.roleId);
  }

  update(dt: number, t: number, introStart: number | null, hovered: boolean) {
    this.baseUpdate(dt, t, introStart, hovered);
    const k = damp(dt, 7);
    this.top += (this.targetTop - this.top) * k;
    this.setHitHeight(this.top + 1);
    const b = this.bright;
    this.platformMat.opacity = Math.min(1, 0.35 + 0.65 * b);
    this.platformEdgeMat.opacity = Math.min(1, 0.55 * b);
    this.glowMat.opacity = 0.16 * b;
    for (const f of [...this.floors.values()]) {
      f.y += (f.ty - f.y) * k;
      f.fade += (f.tFade - f.fade) * k;
      f.group.position.y = f.y;
      const hl = this.highlight === f.roleId ? 1 : 0;
      f.glassMat.opacity = (0.13 + hl * 0.22) * f.fade * b;
      f.glassMat.emissiveIntensity = 0.04 + hl * 0.5;
      f.edgeMat.opacity = Math.min(1, (0.32 + hl * 0.6) * f.fade * b);
      f.slabMat.opacity = 0.55 * f.fade * Math.min(1, b);
      if (f.pad) (f.pad.material as THREE.MeshBasicMaterial).opacity = 0.9 * f.fade * Math.min(1.2, b);
      if (f.halo) {
        f.halo.rotation.z += dt * 1.2;
        f.halo.position.y = 0.66 + Math.sin(t * 2) * 0.04;
        (f.halo.material as THREE.MeshBasicMaterial).opacity = 0.9 * f.fade * Math.min(1.2, b);
      }
      for (const c of [...f.cubes]) {
        c.x += (c.tx - c.x) * k;
        c.z += (c.tz - c.z) * k;
        c.y += (c.ty - c.y) * damp(dt, c.removing ? 4 : 6);
        c.fade += (c.tFade - c.fade) * damp(dt, c.removing ? 5 : 6);
        c.mesh.position.set(c.x, 0.05 + CUBE / 2 + c.y, c.z);
        c.mat.opacity = Math.min(1, c.fade * f.fade * Math.min(1, b + 0.05));
        c.mesh.visible = c.mat.opacity > 0.01;
        if (c.removing && c.fade < 0.02) {
          f.group.remove(c.mesh);
          c.mat.dispose();
          f.cubes.splice(f.cubes.indexOf(c), 1);
        }
      }
      if (f.removing && f.fade < 0.02) this.disposeFloor(f);
    }
  }
}

// ---- HQ tower --------------------------------------------------------------------

class HQBuilding extends SceneNode {
  radius = 4.6;
  height = 0;
  floors: { mesh: THREE.Group; baseY: number; float: boolean; phase: number }[] = [];
  rings: THREE.Mesh[] = [];
  mats: { m: THREE.Material & { opacity: number }; base: number }[] = [];
  beamMat: THREE.ShaderMaterial;

  constructor(private s: Shared, parent: THREE.Scene) {
    super("hq", [8, 8, 8]);
    const dims = [
      [7.6, 1.35],
      [6.5, 1.3],
      [5.4, 1.3],
      [4.4, 1.2],
      [3.4, 1.1],
    ];
    let y = 0;
    dims.forEach(([w, h], i) => {
      const g = new THREE.Group();
      const geo = new THREE.BoxGeometry(w, h, w);
      const mat = new THREE.MeshStandardMaterial({ color: 0x241b17, metalness: 0.7, roughness: 0.28, transparent: true });
      const body = new THREE.Mesh(geo, mat);
      body.position.y = h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      const em = new THREE.LineBasicMaterial({ color: COLOR.accent2, transparent: true, opacity: 0.55 });
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), em);
      edges.position.y = h / 2;
      const bandMat = new THREE.MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.9 });
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.05, w + 0.06), bandMat);
      band.position.y = h - 0.12;
      // window strip
      const winMat = new THREE.MeshBasicMaterial({ color: COLOR.a300, transparent: true, opacity: 0.16 });
      const win = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h * 0.32, w + 0.02), winMat);
      win.position.y = h * 0.5;
      g.add(body, edges, band, win);
      g.position.y = y;
      this.lift.add(g);
      this.floors.push({ mesh: g, baseY: y, float: i >= 1 && i <= 3, phase: i * 1.3 });
      this.mats.push({ m: mat, base: 1 }, { m: em, base: 0.55 }, { m: bandMat, base: 0.9 }, { m: winMat, base: 0.16 });
      y += h + 0.14;
    });
    this.height = y;

    [6.4, 7.5].forEach((r, i) => {
      const ringMat = new THREE.MeshBasicMaterial({ color: i ? COLOR.accent2 : COLOR.accent, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 160), ringMat);
      ring.rotation.x = Math.PI / 2 + (i ? -0.08 : 0.1);
      ring.position.y = i ? 4.4 : 2.4;
      this.lift.add(ring);
      this.rings.push(ring);
      this.mats.push({ m: ringMat, base: 0.75 });
    });

    this.beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(COLOR.accent2) }, uI: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 uColor; uniform float uI; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.6) * 0.07 * uI; gl_FragColor = vec4(uColor, a); }",
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, 26, 32, 1, true), this.beamMat);
    beam.position.y = this.height + 13;
    this.lift.add(beam);

    const glow = s.groundGlow(26, 0.5);
    this.group.add(glow);
    this.mats.push({ m: glow.material as THREE.MeshBasicMaterial, base: 0.5 });

    const light = new THREE.PointLight(COLOR.accent, 140, 42, 2);
    light.position.set(0, this.height + 2, 0);
    this.lift.add(light);

    this.setHitHeight(this.height);
    parent.add(this.group);
  }

  topY() {
    return this.height * this.intro + this.liftY;
  }

  update(dt: number, t: number, introStart: number | null, hovered: boolean) {
    this.baseUpdate(dt, t, introStart, hovered);
    this.floors.forEach((f) => {
      f.mesh.position.y = f.baseY + (f.float ? Math.sin(t * 0.9 + f.phase) * 0.09 : 0);
    });
    this.rings[0].rotation.z += dt * 0.18;
    this.rings[1].rotation.z -= dt * 0.12;
    this.mats.forEach(({ m, base }) => (m.opacity = Math.min(1, base * this.bright)));
    this.beamMat.uniforms.uI.value = this.bright;
  }
}

// ---- COO hub ---------------------------------------------------------------------

class COOHub extends SceneNode {
  radius = 2.2;
  height = 3.4;
  mats: { m: THREE.Material & { opacity: number }; base: number }[] = [];
  sprite: THREE.Sprite;

  constructor(s: Shared, parent: THREE.Scene) {
    super("coo", [4, 4.2, 4]);
    const geo = new THREE.CylinderGeometry(1.7, 1.95, this.height, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x241b17, metalness: 0.7, roughness: 0.3, transparent: true });
    const body = new THREE.Mesh(geo, mat);
    body.position.y = this.height / 2;
    body.castShadow = true;
    const em = new THREE.LineBasicMaterial({ color: COLOR.accent2, transparent: true, opacity: 0.6 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), em);
    edges.position.y = this.height / 2;
    const capMat = new THREE.MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.9 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.06, 6), capMat);
    cap.position.y = this.height + 0.03;
    const spriteMat = new THREE.SpriteMaterial({ map: s.glow, color: COLOR.accent, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sprite = new THREE.Sprite(spriteMat);
    this.sprite.scale.set(5, 5, 1);
    this.sprite.position.y = this.height + 0.2;
    this.lift.add(body, edges, cap, this.sprite);
    const glow = s.groundGlow(10, 0.3);
    this.group.add(glow);
    const light = new THREE.PointLight(COLOR.accent, 50, 18, 2);
    light.position.set(0, this.height + 1.5, 0);
    this.lift.add(light);
    this.mats.push(
      { m: mat, base: 1 },
      { m: em, base: 0.6 },
      { m: capMat, base: 0.9 },
      { m: spriteMat, base: 0.9 },
      { m: glow.material as THREE.MeshBasicMaterial, base: 0.3 },
    );
    parent.add(this.group);
  }

  topY() {
    return this.height * this.intro + this.liftY;
  }

  update(dt: number, t: number, introStart: number | null, hovered: boolean) {
    this.baseUpdate(dt, t, introStart, hovered);
    this.mats.forEach(({ m, base }) => (m.opacity = Math.min(1, base * this.bright)));
    const s = 4.6 + Math.sin(t * 1.6) * 0.4;
    this.sprite.scale.set(s, s, 1);
  }
}

// ---- connections -----------------------------------------------------------------

class Link {
  curve: THREE.CubicBezierCurve3;
  mat: THREE.MeshBasicMaterial;
  shadowMat: THREE.LineBasicMaterial;
  pulses: THREE.Sprite[] = [];
  pulseMats: THREE.SpriteMaterial[] = [];
  bright = 1;
  target = 1;
  speed: number;
  objects: THREE.Object3D[] = [];

  constructor(public from: SceneNode, public to: SceneNode, s: Shared, parent: THREE.Scene) {
    const a = from.group.position.clone();
    const b = to.group.position.clone();
    const dir = b.clone().sub(a).setY(0).normalize();
    const start = a.clone().addScaledVector(dir, from.radius).setY(0.5);
    const end = b.clone().addScaledVector(dir, -to.radius).setY(0.5);
    const len = start.distanceTo(end);
    const lift = 2.4 + len * 0.13;
    this.curve = new THREE.CubicBezierCurve3(
      start,
      start.clone().addScaledVector(dir, len * 0.18).setY(lift),
      end.clone().addScaledVector(dir, -len * 0.18).setY(lift),
      end,
    );
    this.speed = 5 / this.curve.getLength();
    this.mat = new THREE.MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(this.curve, 72, 0.04, 6, false), this.mat);
    const pts = this.curve.getPoints(60).map((p) => new THREE.Vector3(p.x, 0.03, p.z));
    this.shadowMat = new THREE.LineBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.12 });
    const shadow = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.shadowMat);
    this.objects.push(tube, shadow);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.SpriteMaterial({ map: s.glow, color: COLOR.a300, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      const sp = new THREE.Sprite(m);
      sp.scale.set(0.8, 0.8, 1);
      this.pulses.push(sp);
      this.pulseMats.push(m);
      this.objects.push(sp);
    }
    this.objects.forEach((o) => parent.add(o));
  }

  update(dt: number, t: number, reveal: number) {
    this.bright += (this.target - this.bright) * damp(dt, 7);
    const b = this.bright * reveal;
    this.mat.opacity = 0.38 * b;
    this.shadowMat.opacity = 0.12 * b;
    this.pulses.forEach((p, i) => {
      const u = (t * this.speed + i / this.pulses.length) % 1;
      p.position.copy(this.curve.getPointAt(u));
      this.pulseMats[i].opacity = Math.min(1, b) * Math.sin(u * Math.PI);
    });
  }
}

// ----------------------------------------------------------------------------- scene

export interface LabelEls {
  panel: HTMLElement;
  beam: HTMLElement;
}

export class CompanyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private shared = new Shared();
  private nodes = new Map<NodeId, SceneNode>();
  private links: Link[] = [];
  private dust: THREE.Points;
  private dustSpeed: Float32Array;
  private clock = new THREE.Clock();
  private raf = 0;
  private active = false;
  private introStart: number | null = null;
  private time = 0;
  private ro: ResizeObserver;
  private labelRO: ResizeObserver;
  private W = 1;
  private H = 1;
  private compact: boolean;

  // camera state
  private target = new THREE.Vector3(0, 3, -3);
  private goalTarget = new THREE.Vector3(0, 3, -3);
  private az = 0;
  private goalAz = 0;
  private el = THREE.MathUtils.degToRad(54);
  private goalEl = THREE.MathUtils.degToRad(54);
  private dist = 50;
  private goalDist = 50;
  private homeDist = 50;
  private zoomFactor = 1;
  private lastInteract = 0;
  private sway = true;
  private inset = { r: 0, b: 0 };
  private insetGoal = { r: 0, b: 0 };

  // interaction
  private hovered: NodeId | null = null;
  private selected: NodeId | null = null;
  private ptrs = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private pinchD = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  // labels
  private labels = new Map<NodeId, LabelEls & { w: number; h: number; x: number; y: number; init: boolean }>();
  private labelHot: NodeId | null = null;

  constructor(private container: HTMLElement, private cb: SceneCallbacks, opts: { compact: boolean; narrow: boolean }) {
    this.compact = opts.compact;
    X_SCALE = opts.narrow ? 0.6 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(COLOR.bg, 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-hidden", "true");

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
    this.scene.background = new THREE.Color(COLOR.bg);
    this.scene.fog = new THREE.Fog(COLOR.bg, 40, 140);

    this.buildEnvironment();
    this.nodes.set("hq", new HQBuilding(this.shared, this.scene));
    this.nodes.set("coo", new COOHub(this.shared, this.scene));
    DEPARTMENTS.forEach((d) => this.nodes.set(d.key, new DeptBuilding(d.key, this.shared, this.scene)));
    LINKS.forEach(([a, b]) => this.links.push(new Link(this.nodes.get(a)!, this.nodes.get(b)!, this.shared, this.scene)));

    // dust
    const n = this.compact ? 110 : 260;
    const pos = new Float32Array(n * 3);
    this.dustSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = Math.random() * 16;
      pos[i * 3 + 2] = -26 + Math.random() * 44;
      this.dustSpeed[i] = 0.2 + Math.random() * 0.5;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        size: 0.22,
        map: this.shared.glow,
        color: COLOR.accent2,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.dust);

    // events
    const c = this.renderer.domElement;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("pointerleave", this.onLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("visibilitychange", this.onVisibility);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.labelRO = new ResizeObserver((entries) => {
      for (const e of entries) {
        for (const l of this.labels.values()) {
          if (l.panel === e.target) {
            l.w = l.panel.offsetWidth;
            l.h = l.panel.offsetHeight;
          }
        }
      }
    });
    this.resize();
  }

  private buildEnvironment() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xffe9de, 0x140e0c, 0.6));
    s.add(new THREE.AmbientLight(0xffffff, 0.12));
    const dir = new THREE.DirectionalLight(0xfff1e9, 1.15);
    dir.position.set(16, 30, 24);
    dir.castShadow = true;
    dir.shadow.mapSize.set(this.compact ? 1024 : 2048, this.compact ? 1024 : 2048);
    const sc = dir.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 90;
    dir.shadow.radius = 4;
    dir.shadow.bias = -0.0005;
    s.add(dir);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.38 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);

    const grid = new THREE.GridHelper(180, 90, 0x5a2e18, 0x2c1d17);
    const gm = grid.material as THREE.LineBasicMaterial;
    gm.transparent = true;
    gm.opacity = 0.45;
    gm.depthWrite = false;
    grid.position.y = 0.005;
    s.add(grid);
  }

  // ------------------------------------------------------------------ public API

  setModel(model: FleetModel, animate: boolean) {
    DEPARTMENTS.forEach((d) => (this.nodes.get(d.key) as DeptBuilding).setRoles(model.departments[d.key].roles, animate));
  }

  registerLabel(id: NodeId, els: LabelEls | null) {
    const prev = this.labels.get(id);
    if (prev) this.labelRO.unobserve(prev.panel);
    if (!els) {
      this.labels.delete(id);
      return;
    }
    this.labels.set(id, { ...els, w: els.panel.offsetWidth, h: els.panel.offsetHeight, x: 0, y: 0, init: false });
    this.labelRO.observe(els.panel);
  }

  setLabelHover(id: NodeId | null) {
    this.labelHot = id;
  }

  setSelected(id: NodeId | null) {
    this.selected = id;
    if (id) {
      const n = this.nodes.get(id)!;
      const p = n.group.position;
      const top = id === "hq" ? 7 : id === "coo" ? 3.4 : (n as DeptBuilding).targetTop;
      this.goalTarget.set(p.x, top * 0.55, p.z);
      const base = id === "hq" ? 30 : 21;
      this.goalDist = base * (this.compact ? 1.45 : 1);
      this.goalEl = THREE.MathUtils.degToRad(32);
    } else {
      this.home();
    }
  }

  setHighlightFloor(dept: DeptKey | null, roleId: string | null) {
    DEPARTMENTS.forEach((d) => ((this.nodes.get(d.key) as DeptBuilding).highlight = d.key === dept ? roleId : null));
  }

  setInset(r: number, b: number) {
    this.insetGoal = { r, b };
  }

  setSway(on: boolean) {
    this.sway = on;
  }

  setCompact(c: boolean) {
    this.compact = c;
    this.resize();
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.clock.getDelta();
      this.loop();
    } else cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.setActive(false);
    this.ro.disconnect();
    this.labelRO.disconnect();
    const c = this.renderer.domElement;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("pointerleave", this.onLeave);
    c.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.shared.dispose();
    this.renderer.dispose();
    c.remove();
  }

  // ------------------------------------------------------------------ camera

  private homeTarget = new THREE.Vector3(0, 3, -3);

  private homeEl() {
    const portrait = this.H > this.W;
    return THREE.MathUtils.degToRad(this.compact ? (portrait ? 64 : 40) : 36);
  }

  private home() {
    this.goalTarget.copy(this.homeTarget);
    this.goalDist = this.homeDist * this.zoomFactor;
    this.goalEl = this.homeEl();
    this.goalAz = 0;
  }

  /**
   * Find the closest front-facing camera that shows every building, leaving the top band of the
   * screen free for the hologram labels (larger on desktop, where labels are full panels).
   */
  private fitHome() {
    const pts: THREE.Vector3[] = [];
    for (const n of this.nodes.values()) {
      const p = n.group.position;
      const r = n.id === "hq" ? 4 : 2.5;
      pts.push(new THREE.Vector3(p.x - r, 0, p.z + r), new THREE.Vector3(p.x + r, 0, p.z + r));
      const top = n.id === "hq" ? 7.4 : n.id === "coo" ? 3.6 : 3.6;
      pts.push(new THREE.Vector3(p.x, top, p.z));
    }
    const topNdc = this.compact ? 0.62 : 0.42;
    const botNdc = this.compact ? -0.86 : -0.9;
    const cam = this.camera.clone();
    cam.clearViewOffset();
    cam.aspect = this.W / this.H;
    cam.updateProjectionMatrix();
    const el = this.homeEl();
    const v = new THREE.Vector3();
    const tgt = new THREE.Vector3();
    const xLim = this.compact ? 0.97 : 0.95;
    for (let d = 20; d < 260; d *= 1.03) {
      let best: { dz: number; bal: number } | null = null;
      for (let dz = -12; dz <= 12; dz += 1.5) {
        tgt.set(0, 2, -3 + dz);
        cam.position.set(tgt.x, tgt.y + d * Math.sin(el), tgt.z + d * Math.cos(el));
        cam.lookAt(tgt);
        cam.updateMatrixWorld();
        let ok = true;
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = 0; i < pts.length && ok; i++) {
          v.copy(pts[i]).project(cam);
          const isTop = i % 3 === 2;
          if (Math.abs(v.x) > xLim) ok = false;
          else if (isTop ? v.y > topNdc : v.y < botNdc) ok = false;
          if (isTop) hi = Math.max(hi, v.y);
          else lo = Math.min(lo, v.y);
        }
        // prefer the shift that centres the scene in the free band
        const bal = Math.abs(topNdc - hi - (lo - botNdc));
        if (ok && (!best || bal < best.bal)) best = { dz, bal };
      }
      if (best) {
        this.homeDist = d;
        this.homeTarget.set(0, 2, -3 + best.dz);
        return;
      }
    }
    this.homeDist = 120;
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    this.fitHome();
    if (!this.selected) {
      this.goalTarget.copy(this.homeTarget);
      this.goalEl = this.homeEl();
      if (!this.introStart) {
        this.target.copy(this.homeTarget);
        this.el = this.goalEl;
      }
      this.goalDist = this.homeDist * this.zoomFactor;
      if (!this.introStart) this.dist = this.goalDist * 1.25;
    }
    this.applyView();
    this.camera.updateProjectionMatrix();
  }

  private applyView() {
    const { r, b } = this.inset;
    if (r > 0.5 || b > 0.5) this.camera.setViewOffset(this.W, this.H, r / 2, b / 2, this.W, this.H);
    else this.camera.clearViewOffset();
  }

  private updateCamera(dt: number) {
    const k = damp(dt, 3.2);
    this.target.lerp(this.goalTarget, k);
    this.az += (this.goalAz - this.az) * k;
    this.el += (this.goalEl - this.el) * k;
    this.dist += (this.goalDist - this.dist) * k;
    const idle = performance.now() - this.lastInteract > 3500;
    const swayA = this.sway && idle && !this.selected ? Math.sin(this.time * 0.12) * 0.07 : 0;
    const a = this.az + swayA;
    const cosE = Math.cos(this.el);
    this.camera.position.set(
      this.target.x + this.dist * cosE * Math.sin(a),
      this.target.y + this.dist * Math.sin(this.el),
      this.target.z + this.dist * cosE * Math.cos(a),
    );
    this.camera.lookAt(this.target);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.dist * 0.75;
    fog.far = this.dist * 2.6;

    const ki = damp(dt, 6);
    const pr = this.inset.r;
    const pb = this.inset.b;
    this.inset.r += (this.insetGoal.r - this.inset.r) * ki;
    this.inset.b += (this.insetGoal.b - this.inset.b) * ki;
    if (Math.abs(pr - this.inset.r) > 0.05 || Math.abs(pb - this.inset.b) > 0.05) {
      this.applyView();
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ input

  private pick(x: number, y: number): NodeId | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.nodes.values()].map((n) => n.hit), false);
    return hits.length ? (hits[0].object.userData.nodeId as NodeId) : null;
  }

  private onDown = (e: PointerEvent) => {
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastInteract = performance.now();
    if (this.ptrs.size === 1) this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.down) this.down.moved = true;
    }
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {}
  };

  private onMove = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") {
        const id = this.pick(e.clientX, e.clientY);
        if (id !== this.hovered) {
          this.hovered = id;
          this.cb.onHover(id);
        }
      }
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.lastInteract = performance.now();
    if (this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchD > 0) this.zoomBy(this.pinchD / d);
      this.pinchD = d;
      return;
    }
    if (this.down && !this.down.moved && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) this.down.moved = true;
    if (this.down?.moved) {
      const lim = THREE.MathUtils.degToRad(60);
      this.goalAz = THREE.MathUtils.clamp(this.goalAz - dx * 0.006, -lim, lim);
      this.goalEl = THREE.MathUtils.clamp(this.goalEl + dy * 0.004, THREE.MathUtils.degToRad(12), THREE.MathUtils.degToRad(68));
    }
  };

  private onUp = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinchD = 0;
    if (this.ptrs.size === 0 && this.down) {
      const d = this.down;
      this.down = null;
      if (!d.moved && performance.now() - d.t < 600) this.cb.onSelect(this.pick(e.clientX, e.clientY));
    }
  };

  private onLeave = () => {
    if (this.hovered) {
      this.hovered = null;
      this.cb.onHover(null);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.lastInteract = performance.now();
    this.zoomBy(Math.exp(e.deltaY * 0.0012));
  };

  private zoomBy(f: number) {
    const min = this.selected ? 9 : this.homeDist * 0.35;
    const max = this.homeDist * 1.6;
    this.goalDist = THREE.MathUtils.clamp(this.goalDist * f, min, max);
    if (!this.selected) this.zoomFactor = this.goalDist / this.homeDist;
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (this.active) {
      this.clock.getDelta();
      this.loop();
    }
  };

  // ------------------------------------------------------------------ frame

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.introStart === null) this.introStart = this.time + 0.1;
    this.frame(dt);
  };

  private frame(dt: number) {
    const t = this.time;
    const hot = this.labelHot ?? this.hovered;
    for (const n of this.nodes.values()) {
      n.targetBright = this.selected ? (n.id === this.selected ? 1.35 : 0.28) : hot === n.id ? 1.45 : 1;
      n.update(dt, t, this.introStart, hot === n.id);
    }
    const reveal = this.introStart === null ? 0 : easeOut((t - this.introStart - 1.1) / 1.2);
    for (const l of this.links) {
      const touches = (id: NodeId | null) => !!id && (l.from.id === id || l.to.id === id);
      l.target = this.selected ? (touches(this.selected) ? 1.6 : 0.18) : touches(hot) ? 2 : 1;
      l.update(dt, t, reveal);
    }
    // dust
    const p = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    for (let i = 0; i < this.dustSpeed.length; i++) {
      arr[i * 3 + 1] += this.dustSpeed[i] * dt;
      if (arr[i * 3 + 1] > 16) arr[i * 3 + 1] = 0;
    }
    p.needsUpdate = true;

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.layoutLabels(dt, reveal);
  }

  private v = new THREE.Vector3();

  private layoutLabels(dt: number, reveal: number) {
    if (!this.labels.size) return;
    const W = this.W;
    const H = this.H;
    const gap = this.compact ? 14 : 24;
    const topLimit = this.compact ? 50 : 56;
    const hot = this.labelHot ?? this.hovered;
    type Item = { id: NodeId; ax: number; ay: number; w: number; h: number; x: number; y: number; ok: boolean; hidden?: boolean };
    const items: Item[] = [];
    for (const [id, l] of this.labels) {
      const n = this.nodes.get(id)!;
      this.v.copy(n.group.position);
      this.v.y = n.topY() + 0.4;
      this.v.project(this.camera);
      const ok = this.v.z < 1 && this.v.z > -1;
      const ax = (this.v.x * 0.5 + 0.5) * W;
      const ay = (-this.v.y * 0.5 + 0.5) * H;
      items.push({ id, ax, ay, w: l.w, h: l.h, x: 0, y: 0, ok });
    }
    // Nearest (lowest on screen) first. On a collision, first slide sideways (the light beam bends
    // to reach the panel), then stack upward above the label it hits.
    items.sort((a, b) => b.ay - a.ay);
    const placed: Item[] = [];
    const pad = 6;
    const clampX = (x: number, w: number) => Math.min(Math.max(6, x), W - w - 6);
    const collide = (x: number, y: number, w: number, h: number) =>
      placed.find((p) => x < p.x + p.w + pad && x + w + pad > p.x && y < p.y + p.h + pad && y + h + pad > p.y);
    for (const it of items) {
      const baseX = clampX(it.ax - it.w / 2, it.w);
      const shifts = [0, -0.3, 0.3, -0.6, 0.6, -0.95, 0.95, -1.3, 1.3].map((f) => f * it.w);
      let y = it.ay - gap - it.h;
      let done = false;
      for (let tier = 0; tier < 14 && !done && y >= topLimit; tier++) {
        for (const s of shifts) {
          const x = clampX(baseX + s, it.w);
          if (!collide(x, y, it.w, it.h)) {
            it.x = x;
            it.y = y;
            done = true;
            break;
          }
        }
        if (!done) {
          const hit = collide(baseX, y, it.w, it.h);
          y = hit ? Math.min(y - 8, hit.y - it.h - pad) : y - 8;
        }
      }
      if (!done) {
        // doesn't fit: hidden until hovered or selected, and takes no space from the others
        it.x = baseX;
        it.y = Math.max(topLimit, it.ay - gap - it.h);
        it.hidden = true;
      } else placed.push(it);
    }
    const k = damp(dt, 14);
    for (const it of items) {
      const l = this.labels.get(it.id)!;
      const isHot = hot === it.id || this.selected === it.id;
      const y = it.y;
      const fits = it.ok && !it.hidden && it.ax > -40 && it.ax < W + 40;
      const visible = it.ok && (fits || isHot);
      if (!l.init) {
        l.x = it.x;
        l.y = y;
        l.init = true;
      } else {
        l.x += (it.x - l.x) * k;
        l.y += (y - l.y) * k;
      }
      const dim = this.selected && this.selected !== it.id ? 0.25 : 1;
      const op = visible ? reveal * dim : 0;
      l.panel.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0)`;
      l.panel.style.opacity = op.toFixed(3);
      l.panel.style.pointerEvents = op > 0.1 ? "auto" : "none";
      l.panel.style.zIndex = isHot ? "5" : "1";
      l.panel.classList.toggle("hot", isHot);
      // beam: from the building top to the nearest point on the panel's bottom edge
      const tx = Math.min(Math.max(it.ax, l.x + 10), l.x + l.w - 10);
      const ty = l.y + l.h;
      const dx = tx - it.ax;
      const dy = ty - it.ay;
      const len = dy < 0 ? Math.hypot(dx, dy) : 0;
      const ang = Math.atan2(-dx, dy);
      l.beam.style.transform = `translate3d(${it.ax.toFixed(1)}px, ${it.ay.toFixed(1)}px, 0) rotate(${ang.toFixed(4)}rad)`;
      l.beam.style.height = `${len.toFixed(1)}px`;
      l.beam.style.opacity = (op * 0.9).toFixed(3);
    }
  }
}

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
