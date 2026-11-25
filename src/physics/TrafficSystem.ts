import * as THREE from 'three';
import { BuiltMap, CompiledRoadSegment } from '../map/MapBuilder';
import { CollisionEvent } from './TruckPhysics';

interface TrafficAgent {
  segment: CompiledRoadSegment;
  dir: 1 | -1;
  sMeters: number;
  speedMs: number;
  targetSpeedMs: number;
  isTruck: boolean;
  colorHex: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const CAR_COLORS = ['#dc2626', '#2563eb', '#e2e8f0', '#475569', '#059669', '#d97706', '#0f172a'] as const;

/**
 * Instanced AI traffic simulation following road splines with right-hand lane offsets,
 * intersection transitions, safe following gaps, and player collision detection.
 */
export class TrafficSystem {
  private readonly builtMap: BuiltMap;
  private readonly agents: TrafficAgent[] = [];
  private readonly nodeConnections = new Map<string, CompiledRoadSegment[]>();

  private readonly bodyInst: THREE.InstancedMesh;
  private readonly cabinInst: THREE.InstancedMesh;
  private readonly wheelInst: THREE.InstancedMesh;
  private readonly headlightInst: THREE.InstancedMesh;
  private readonly taillightInst: THREE.InstancedMesh;
  private readonly shadowInst: THREE.InstancedMesh | null = null;
  private readonly headlightMat: THREE.MeshBasicMaterial;
  private readonly taillightMat: THREE.MeshBasicMaterial;
  private readonly maxCapacity: number;
  private activeCount: number;
  private readonly dummy = new THREE.Object3D();
  private readonly disposables: { dispose: () => void }[] = [];

  private collisionCooldownSec = 0;

  constructor(
    builtMap: BuiltMap,
    vehicleCount = 20,
    maxCapacity = 28,
    shadowTexture?: THREE.CanvasTexture
  ) {
    this.builtMap = builtMap;
    this.maxCapacity = Math.max(maxCapacity, vehicleCount);
    this.activeCount = Math.min(this.maxCapacity, vehicleCount);

    for (const seg of builtMap.segments) {
      const a = this.nodeConnections.get(seg.def.fromNodeId) ?? [];
      a.push(seg);
      this.nodeConnections.set(seg.def.fromNodeId, a);

      if (!seg.def.oneWay) {
        const b = this.nodeConnections.get(seg.def.toNodeId) ?? [];
        b.push(seg);
        this.nodeConnections.set(seg.def.toNodeId, b);
      }
    }

    // Create batched InstancedMeshes for all AI vehicles + night headlights/taillights
    const bodyGeo = new THREE.BoxGeometry(2.1, 1.05, 4.6);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.38 });
    const cabinGeo = new THREE.BoxGeometry(1.85, 0.72, 2.3);
    const cabinMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.3, metalness: 0.25 });
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 2.18, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.9 });
    const lampGeo = new THREE.BoxGeometry(0.34, 0.16, 0.08);
    this.headlightMat = new THREE.MeshBasicMaterial({ color: '#fef9c3' });
    this.taillightMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });

    this.disposables.push(
      bodyGeo,
      bodyMat,
      cabinGeo,
      cabinMat,
      wheelGeo,
      wheelMat,
      lampGeo,
      this.headlightMat,
      this.taillightMat
    );

    this.bodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, this.maxCapacity);
    this.bodyInst.castShadow = true;
    this.cabinInst = new THREE.InstancedMesh(cabinGeo, cabinMat, this.maxCapacity);
    this.wheelInst = new THREE.InstancedMesh(wheelGeo, wheelMat, this.maxCapacity * 2);
    this.headlightInst = new THREE.InstancedMesh(lampGeo, this.headlightMat, this.maxCapacity * 2);
    this.taillightInst = new THREE.InstancedMesh(lampGeo, this.taillightMat, this.maxCapacity * 2);

    if (shadowTexture) {
      const shadowGeo = new THREE.PlaneGeometry(2.9, 5.8);
      shadowGeo.rotateX(-Math.PI / 2);
      const shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.shadowInst = new THREE.InstancedMesh(shadowGeo, shadowMat, this.maxCapacity);
      this.disposables.push(shadowGeo, shadowMat);
      builtMap.root.add(this.shadowInst);
    }

    this.spawnAgents(this.maxCapacity);
    this.setActiveCount(this.activeCount);
    builtMap.root.add(this.bodyInst, this.cabinInst, this.wheelInst, this.headlightInst, this.taillightInst);
  }

  public setActiveCount(count: number): void {
    this.activeCount = Math.max(0, Math.min(this.maxCapacity, Math.round(count)));
    this.bodyInst.count = this.activeCount;
    this.cabinInst.count = this.activeCount;
    this.wheelInst.count = this.activeCount * 2;
    this.headlightInst.count = this.activeCount * 2;
    this.taillightInst.count = this.activeCount * 2;
    if (this.shadowInst) {
      this.shadowInst.count = this.activeCount;
    }
  }

  private spawnAgents(count: number): void {
    // Include highway/national segments, weighting Munich-facing corridors slightly so traffic is immediately visible
    const candidates = this.builtMap.segments.filter((s) => s.def.roadClass !== 'urban');
    const pool = candidates.length > 0 ? candidates : this.builtMap.segments;
    const prioritySegs = pool.filter(
      (s) => s.def.id === 'seg_a9_south' || s.def.id === 'seg_bavaria_express' || s.def.id === 'seg_mid_west'
    );
    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const seg =
        i < 6 && prioritySegs.length > 0
          ? prioritySegs[i % prioritySegs.length]!
          : pool[i % pool.length]!;
      const dir: 1 | -1 = i % 2 === 0 || seg.def.oneWay ? 1 : -1;
      const sMeters = ((i * 119 + 45) % Math.max(40, Math.floor(seg.lengthMeters - 20))) + 10;
      const isTruck = i % 4 === 0;
      const baseSpeedKmh = seg.def.speedLimitKmh * (isTruck ? 0.78 : 0.9);
      const colorHex = CAR_COLORS[i % CAR_COLORS.length]!;

      const agent: TrafficAgent = {
        segment: seg,
        dir,
        sMeters,
        speedMs: baseSpeedKmh / 3.6,
        targetSpeedMs: baseSpeedKmh / 3.6,
        isTruck,
        colorHex,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
      };
      this.syncAgentPose(agent);
      this.agents.push(agent);

      tmpColor.set(colorHex);
      this.bodyInst.setColorAt(i, tmpColor);
    }
    if (this.bodyInst.instanceColor) {
      this.bodyInst.instanceColor.needsUpdate = true;
    }
  }

  private syncAgentPose(agent: TrafficAgent): void {
    const t = THREE.MathUtils.clamp(agent.sMeters / agent.segment.lengthMeters, 0, 1);
    const p = agent.segment.curve.getPointAt(t);
    const tan = agent.segment.curve.getTangentAt(t);
    const hLen = Math.hypot(tan.x, tan.z) || 1;
    const tx = tan.x / hLen;
    const tz = tan.z / hLen;

    // Right-hand side of travel
    const rx = -tz * agent.dir;
    const rz = tx * agent.dir;
    const laneOffset = agent.segment.def.width * 0.25;

    agent.x = p.x + rx * laneOffset;
    agent.y = p.y;
    agent.z = p.z + rz * laneOffset;
    agent.yaw = Math.atan2(tx * agent.dir, tz * agent.dir);
  }

  private transitionNextSegment(agent: TrafficAgent): void {
    const arrivedNodeId = agent.dir === 1 ? agent.segment.def.toNodeId : agent.segment.def.fromNodeId;
    const connected = this.nodeConnections.get(arrivedNodeId) ?? [];
    const options = connected.filter((s) => s.def.id !== agent.segment.def.id && s.def.roadClass !== 'urban');
    const nextSeg = options.length > 0
      ? options[Math.floor(Math.random() * options.length)]!
      : agent.segment;

    if (nextSeg.def.fromNodeId === arrivedNodeId) {
      agent.segment = nextSeg;
      agent.dir = 1;
      agent.sMeters = 2;
    } else if (!nextSeg.def.oneWay) {
      agent.segment = nextSeg;
      agent.dir = -1;
      agent.sMeters = nextSeg.lengthMeters - 2;
    } else {
      agent.dir = 1;
      agent.sMeters = 2;
    }
    agent.targetSpeedMs = (agent.segment.def.speedLimitKmh * (agent.isTruck ? 0.78 : 0.9)) / 3.6;
  }

  public update(
    dtSec: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    trailerX: number,
    trailerZ: number,
    nightFactor = 0
  ): CollisionEvent | null {
    this.headlightMat.color.setHex(nightFactor > 0.25 ? 0xfffbeb : 0xe2e8f0);
    this.taillightMat.color.setHex(nightFactor > 0.25 ? 0xff2d2d : 0xb91c1c);
    let collision: CollisionEvent | null = null;
    if (this.collisionCooldownSec > 0) {
      this.collisionCooldownSec = Math.max(0, this.collisionCooldownSec - dtSec);
    }

    for (let i = 0; i < this.activeCount; i++) {
      const a = this.agents[i]!;
      let desiredSpeed = a.targetSpeedMs;

      const fwdX = Math.sin(a.yaw);
      const fwdZ = Math.cos(a.yaw);

      // Stop smoothly for RED / AMBER traffic signals at approaching signalized nodes
      const remainingToNode = a.dir === 1 ? a.segment.lengthMeters - a.sMeters : a.sMeters;
      if (remainingToNode < 28 && remainingToNode > 7) {
        const destNodeId = a.dir === 1 ? a.segment.def.toNodeId : a.segment.def.fromNodeId;
        const signal = this.builtMap.getTrafficLightState(destNodeId, fwdX, fwdZ);
        if (signal !== 'green') {
          desiredSpeed = remainingToNode < 14 ? 0 : Math.min(desiredSpeed, ((remainingToNode - 14) / 14) * 6);
        }
      }

      // Check distance to player tractor & trailer ahead in same lane
      for (const [px, pz] of [
        [playerX, playerZ],
        [trailerX, trailerZ],
      ] as const) {
        const dx = px - a.x;
        const dz = pz - a.z;
        const forwardDot = dx * fwdX + dz * fwdZ;
        const lateralDist = Math.abs(dx * -fwdZ + dz * fwdX);
        if (forwardDot > 0 && forwardDot < 34 && lateralDist < 3.4) {
          if (forwardDot < 14) desiredSpeed = 0;
          else desiredSpeed = Math.min(desiredSpeed, ((forwardDot - 14) / 20) * a.targetSpeedMs);
        }
      }

      // Check distance to other AI vehicles ahead
      for (let j = 0; j < this.activeCount; j++) {
        if (i === j) continue;
        const b = this.agents[j]!;
        if (Math.abs(a.y - b.y) > 5) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const forwardDot = dx * fwdX + dz * fwdZ;
        const lateralDist = Math.abs(dx * -fwdZ + dz * fwdX);
        if (forwardDot > 0 && forwardDot < 28 && lateralDist < 2.8) {
          if (forwardDot < 11) desiredSpeed = 0;
          else desiredSpeed = Math.min(desiredSpeed, b.speedMs * 0.9);
        }
      }

      // Smooth accel / braking
      const rate = desiredSpeed < a.speedMs ? 11 : 4.5;
      a.speedMs += (desiredSpeed - a.speedMs) * Math.min(1, dtSec * rate);
      a.sMeters += a.dir * a.speedMs * dtSec;

      if (a.sMeters >= a.segment.lengthMeters - 1 || a.sMeters <= 1) {
        this.transitionNextSegment(a);
      }
      this.syncAgentPose(a);

      // Player collision check
      if (this.collisionCooldownSec <= 0 && Math.abs(a.y - playerY) < 4) {
        const dPlayer = Math.hypot(a.x - playerX, a.z - playerZ);
        if (dPlayer < 3.5) {
          a.speedMs = 0;
          this.collisionCooldownSec = 1.6;
          collision = { impactSpeedKmh: 26, label: a.isTruck ? 'AI 箱式货车' : '社会乘用车' };
        }
      }

      // Update instanced matrices
      const scaleZ = a.isTruck ? 1.55 : 0.96;
      const scaleY = a.isTruck ? 1.85 : 1.0;

      this.dummy.position.set(a.x, a.y + 0.62 * scaleY, a.z);
      this.dummy.rotation.set(0, a.yaw, 0);
      this.dummy.scale.set(1, scaleY, scaleZ);
      this.dummy.updateMatrix();
      this.bodyInst.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(a.x + fwdX * (a.isTruck ? 1.6 : -0.2), a.y + (a.isTruck ? 1.55 : 1.38), a.z + fwdZ * (a.isTruck ? 1.6 : -0.2));
      this.dummy.scale.set(1, 1, a.isTruck ? 0.65 : 1.0);
      this.dummy.updateMatrix();
      this.cabinInst.setMatrixAt(i, this.dummy.matrix);

      const axleOffset = a.isTruck ? 2.1 : 1.35;
      this.dummy.position.set(a.x + fwdX * axleOffset, a.y + 0.36, a.z + fwdZ * axleOffset);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.wheelInst.setMatrixAt(i * 2, this.dummy.matrix);

      this.dummy.position.set(a.x - fwdX * axleOffset, a.y + 0.36, a.z - fwdZ * axleOffset);
      this.dummy.updateMatrix();
      this.wheelInst.setMatrixAt(i * 2 + 1, this.dummy.matrix);

      // Front headlights & rear taillights
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const frontLen = a.isTruck ? 3.55 : 2.25;
      const rearLen = a.isTruck ? 3.55 : 2.25;
      for (const [idxOffset, side] of [
        [0, -0.74],
        [1, 0.74],
      ] as const) {
        this.dummy.position.set(
          a.x + fwdX * frontLen + rightX * side,
          a.y + 0.65,
          a.z + fwdZ * frontLen + rightZ * side
        );
        this.dummy.rotation.set(0, a.yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.headlightInst.setMatrixAt(i * 2 + idxOffset, this.dummy.matrix);

        this.dummy.position.set(
          a.x - fwdX * rearLen + rightX * side,
          a.y + 0.68,
          a.z - fwdZ * rearLen + rightZ * side
        );
        this.dummy.updateMatrix();
        this.taillightInst.setMatrixAt(i * 2 + idxOffset, this.dummy.matrix);
      }

      if (this.shadowInst) {
        this.dummy.position.set(a.x, a.y + 0.032, a.z);
        this.dummy.rotation.set(0, a.yaw, 0);
        this.dummy.scale.set(1, 1, a.isTruck ? 1.48 : 0.96);
        this.dummy.updateMatrix();
        this.shadowInst.setMatrixAt(i, this.dummy.matrix);
      }
    }

    this.bodyInst.instanceMatrix.needsUpdate = true;
    this.cabinInst.instanceMatrix.needsUpdate = true;
    this.wheelInst.instanceMatrix.needsUpdate = true;
    this.headlightInst.instanceMatrix.needsUpdate = true;
    this.taillightInst.instanceMatrix.needsUpdate = true;
    if (this.shadowInst) {
      this.shadowInst.instanceMatrix.needsUpdate = true;
    }
    return collision;
  }

  public dispose(): void {
    this.bodyInst.dispose();
    this.cabinInst.dispose();
    this.wheelInst.dispose();
    this.headlightInst.dispose();
    this.taillightInst.dispose();
    this.shadowInst?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
