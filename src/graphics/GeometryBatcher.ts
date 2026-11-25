import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface QueuedPart {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  colorHex?: string;
}

/**
 * Lightweight static geometry batcher that bakes world/local transforms (and optional
 * per-instance vertex colors) before merging geometries per material to minimize Draw Calls.
 */
export class GeometryBatcher {
  private readonly buckets = new Map<
    THREE.Material,
    {
      parts: QueuedPart[];
      castShadow: boolean;
      receiveShadow: boolean;
      layer: number;
      useVertexColors: boolean;
    }
  >();

  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpScale = new THREE.Vector3(1, 1, 1);
  private readonly tmpColor = new THREE.Color();

  public add(
    material: THREE.Material,
    geo: THREE.BufferGeometry,
    opts: {
      x?: number;
      y?: number;
      z?: number;
      rotX?: number;
      rotY?: number;
      rotZ?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      matrix?: THREE.Matrix4;
      colorHex?: string;
      castShadow?: boolean;
      receiveShadow?: boolean;
      layer?: number;
    } = {}
  ): void {
    let bucket = this.buckets.get(material);
    if (!bucket) {
      bucket = {
        parts: [],
        castShadow: opts.castShadow ?? false,
        receiveShadow: opts.receiveShadow ?? false,
        layer: opts.layer ?? 0,
        useVertexColors: Boolean(opts.colorHex),
      };
      this.buckets.set(material, bucket);
    } else {
      if (opts.castShadow) bucket.castShadow = true;
      if (opts.receiveShadow) bucket.receiveShadow = true;
      if (opts.colorHex) bucket.useVertexColors = true;
    }

    let matrix: THREE.Matrix4;
    if (opts.matrix) {
      matrix = opts.matrix.clone();
    } else {
      this.tmpPos.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
      this.tmpEuler.set(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0, 'YXZ');
      this.tmpQuat.setFromEuler(this.tmpEuler);
      this.tmpScale.set(opts.scaleX ?? 1, opts.scaleY ?? 1, opts.scaleZ ?? 1);
      matrix = this.tmpMat.clone().compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    }

    bucket.parts.push({ geo, matrix, colorHex: opts.colorHex });
  }

  public flush(root: THREE.Object3D, disposables: { dispose: () => void }[]): void {
    for (const [material, bucket] of this.buckets.entries()) {
      if (bucket.parts.length === 0) continue;

      let allHaveUv = true;
      let allIndexed = true;
      for (let i = 0; i < bucket.parts.length; i++) {
        const g = bucket.parts[i]!.geo;
        if (!g.attributes.uv) allHaveUv = false;
        if (!g.index) allIndexed = false;
      }

      const bakedList: THREE.BufferGeometry[] = [];
      for (let i = 0; i < bucket.parts.length; i++) {
        const part = bucket.parts[i]!;
        let g = part.geo.clone();
        if (!allIndexed && g.index) {
          const nonIdx = g.toNonIndexed();
          g.dispose();
          g = nonIdx;
        }
        g.applyMatrix4(part.matrix);
        if (!g.attributes.normal) {
          g.computeVertexNormals();
        }
        if (!allHaveUv && g.attributes.uv) {
          g.deleteAttribute('uv');
        }
        if (bucket.useVertexColors) {
          const count = g.attributes.position?.count ?? 0;
          this.tmpColor.set(part.colorHex ?? '#ffffff');
          const colors = new Float32Array(count * 3);
          for (let c = 0; c < count; c++) {
            colors[c * 3] = this.tmpColor.r;
            colors[c * 3 + 1] = this.tmpColor.g;
            colors[c * 3 + 2] = this.tmpColor.b;
          }
          g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
        bakedList.push(g);
      }

      const merged = mergeGeometries(bakedList, false);
      for (const b of bakedList) {
        b.dispose();
      }
      if (!merged) continue;

      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      mesh.layers.set(bucket.layer);
      root.add(mesh);
      disposables.push(merged);
    }
    this.buckets.clear();
  }
}
