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
  private readonly dummy = new THREE.Object3D();
  private readonly disposables: { dispose: () => void }[] = [];

  private collisionCooldownSec = 0;

  constructor(builtMap: BuiltMap, vehicleCount = 20) {
    this.builtMap = builtMap;

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

    // Create 3 InstancedMeshes for all AI vehicles (minimal Draw Calls)
    const bodyGeo = new THREE.BoxGeometry(2.1, 1.05, 4.6);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35 });
    const cabinGeo = new THREE.BoxGeometry(1.85, 0.72, 2.3);
    const cabinMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.3, metalness: 0.25 });
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 2.18, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.9 });

    this.disposables.push(bodyGeo, bodyMat, cabinGeo, cabinMat, wheelGeo, wheelMat);

    this.bodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, vehicleCount);
    this.bodyInst.castShadow = true;
    this.cabinInst = new THREE.InstancedMesh(cabinGeo, cabinMat, vehicleCount);
    this.wheelInst = new THREE.InstancedMesh(wheelGeo, wheelMat, vehicleCount * 2);

    this.spawnAgents(vehicleCount);
    builtMap.root.add(this.bodyInst, this.cabinInst, this.wheelInst);
  }

  private spawnAgents(count: number): void {
    // Prefer highway & national segments so city yards stay clear
    const candidates = this.builtMap.segments.filter((s) => s.def.roadClass !== 'urban');
    const pool = candidates.length > 0 ? candidates : this.builtMap.segments;
    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const seg = pool[i % pool.length]!;
      const dir: 1 | -1 = i % 2 === 0 || seg.def.oneWay ? 1 : -1;
      const sMeters = ((i * 137) % Math.max(40, Math.floor(seg.lengthMeters - 20))) + 10;
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
    trailerZ: number
  ): CollisionEvent | null {
    let collision: CollisionEvent | null = null;
    if (this.collisionCooldownSec > 0) {
      this.collisionCooldownSec = Math.max(0, this.collisionCooldownSec - dtSec);
    }

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      let desiredSpeed = a.targetSpeedMs;

      const fwdX = Math.sin(a.yaw);
      const fwdZ = Math.cos(a.yaw);

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
      for (let j = 0; j < this.agents.length; j++) {
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
    }

    this.bodyInst.instanceMatrix.needsUpdate = true;
    this.cabinInst.instanceMatrix.needsUpdate = true;
    this.wheelInst.instanceMatrix.needsUpdate = true;
    return collision;
  }

  public dispose(): void {
    this.bodyInst.dispose();
    this.cabinInst.dispose();
    this.wheelInst.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
