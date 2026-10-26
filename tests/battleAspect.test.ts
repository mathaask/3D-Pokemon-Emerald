// Task 12a item 7: the arena's pruning holds up to a 21:9 window (the battle camera keeps its 24° vertical field of view: a
// wider window sees further to the sides).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { STAGE, GROUND_Y } from '../src/render/battle/stage';
import { battleCamera, FRAME_ASPECT, frameProjector } from '../src/render/battle/parts/scatter';
import { SCENERY_SEED } from '../src/render/battle/parts/scatter';
import { brokenEdgeGeometry, cloudSeaGeometry } from '../src/render/battle/parts/skyPillar';
import { GROUND_RADIUS } from '../src/render/battle/parts/ground';

describe('a 21:9 battle frame', () => {
  it("shows the Sky Pillar's sea of clouds over the edge to the frame's sides, settled and in the intro sweep", () => {
    const clouds = new THREE.Mesh(cloudSeaGeometry(SCENERY_SEED, STAGE), new THREE.MeshBasicMaterial());
    const edge = new THREE.Mesh(brokenEdgeGeometry(SCENERY_SEED, STAGE, [0.8, 0.8, 0.82]), new THREE.MeshBasicMaterial());
    const cx = STAGE.centre.x, cz = STAGE.centre.z;
    const floorAt = (o: THREE.Vector3, d: THREE.Vector3) => {
      const t = (GROUND_Y - o.y) / d.y;
      return t > 0 && Math.hypot(o.x + d.x * t - cx, o.z + d.z * t - cz) <= GROUND_RADIUS.rayquaza!;
    };
    for (const [yaw, ease] of [[0.9, 0], [-0.9, 0], [0.9, 1], [-0.9, 1], [0, 0]]) {
      const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(24, 21 / 9, 0.1, 400);
      cam.position.copy(battleCamera(STAGE, yaw, new THREE.Vector3(), look, ease));
      cam.lookAt(look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const ray = new THREE.Raycaster();
      // (the frame's outer columns: beyond a 16:9 frame's sides)
      for (const nx of [-0.95, -0.85, 0.85, 0.95]) {
        let rays = 0, hits = 0;
        for (let ny = 0.98; ny > 0; ny -= 0.03) {
          ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
          if (floorAt(ray.ray.origin, ray.ray.direction) || ray.intersectObject(edge).length) break;
          // (the band over the edge, up to 0.85: over it the fog has the far clouds)
          if (ny > 0.85) continue;
          rays++;
          if (ray.intersectObject(clouds).length) hits++;
        }
        if (rays >= 3) expect(hits / rays, `yaw ${yaw} ease ${ease} column ${nx}: clouds over the edge`).toBeGreaterThan(0.6);
      }
    }
  });

  it('names the aspects the arena is composed for: what must show, in the harness\'s 16:10; what may show, up to 21:9', () => {
    expect(FRAME_ASPECT.shown).toBe(1.6);
    expect(FRAME_ASPECT.widest).toBeCloseTo(21 / 9, 12);
    // (frameProjector's default: the frame what must show is placed in)
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const p = frameProjector(STAGE, 0), q = frameProjector(STAGE, 0, FRAME_ASPECT.shown);
    expect(p(5, 0, -8, v).toArray()).toEqual(q(5, 0, -8, w).toArray());
  });
});
