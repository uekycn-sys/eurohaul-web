import * as THREE from 'three';
import { BuiltMap, CompiledRoadSegment } from '../map/MapBuilder';
import { CollisionEvent } from './TruckPhysics';

type TrafficArchetype = 'sedan' | 'van' | 'semi';

interface TrafficAgent {
  segment: CompiledRoadSegment;
  dir: 1 | -1;
  laneSlot: 0 | 1; // 0 = outer slow lane, 1 = inner fast lane (on 4+ lane motorways)
  targetLaneSlot: 0 | 1;
  lateralShift: number;
  sMeters: number;
  speedMs: number;
  targetSpeedMs: number;
  archetype: TrafficArchetype;
  isTruck: boolean;
  colorHex: string;
  braking: boolean;
  yieldTimerSec: number;
  accidentTimerSec: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  trailerX: number;
  trailerY: number;
  trailerZ: number;
  trailerYaw: number;
  trailerPitch: number;
}

const SEDAN_COLORS = ['#dc2626', '#2563eb', '#e2e8f0', '#475569', '#059669', '#0f172a'] as const;
const VAN_COLORS = ['#f8fafc', '#e2e8f0', '#f1f5f9', '#cbd5e1'] as const;
const SEMI_COLORS = ['#b91c1c', '#1d4ed8', '#d97706', '#047857'] as const;
const TRAILER_COLORS = ['#f8fafc', '#e2e8f0', '#dbeafe', '#fef3c7'] as const;

const BUBBLE_MIN_M = 80;
const BUBBLE_MAX_M = 480;
const RECYCLE_DIST_M = 520;
const MIN_SAFE_GAP_M = 38;
const PLAYER_HULL_RADIUS = 1.45;

/**
 * Instanced AI traffic simulation maintaining a dense player-centered dynamic
 * traffic bubble (80m..480m) with multi-lane motorway discipline, physical stopping-distance
 * braking, articulated semi-trailers following road curvature/pitch, and anti-clipping collision handling.
 */
export class TrafficSystem {
  private readonly builtMap: BuiltMap;
  private readonly agents: TrafficAgent[] = [];
  private readonly nodeConnections = new Map<string, CompiledRoadSegment[]>();
  private readonly roadPool: CompiledRoadSegment[];

  private readonly bodyInst: THREE.InstancedMesh;
  private readonly cabinInst: THREE.InstancedMesh;
  private readonly semiTrailerInst: THREE.InstancedMesh;
  private readonly wheelInst: THREE.InstancedMesh;
  private readonly headlightInst: THREE.InstancedMesh;
  private readonly taillightInst: THREE.InstancedMesh;
  private readonly shadowInst: THREE.InstancedMesh | null = null;
  private readonly headlightMat: THREE.MeshBasicMaterial;
  private readonly taillightMat: THREE.MeshBasicMaterial;
  private readonly maxCapacity: number;
  private activeCount: number;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpBrakeColor = new THREE.Color();
  private readonly disposables: { dispose: () => void }[] = [];

  private collisionCooldownSec = 0;
  private hazardClockSec = 0;

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

    const arterial = builtMap.segments.filter((s) => s.def.roadClass !== 'urban');
    this.roadPool = arterial.length > 0 ? arterial : builtMap.segments;

    const bodyGeo = new THREE.BoxGeometry(2.1, 1.05, 4.6);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.38 });
    const cabinGeo = new THREE.BoxGeometry(1.85, 0.72, 2.3);
    const cabinMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.3, metalness: 0.25 });
    const semiTrailerGeo = new THREE.BoxGeometry(2.36, 2.65, 9.6);
    const semiTrailerMat = new THREE.MeshStandardMaterial({ roughness: 0.46, metalness: 0.2 });
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 2.18, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.9 });
    const lampGeo = new THREE.BoxGeometry(0.34, 0.16, 0.08);
    this.headlightMat = new THREE.MeshBasicMaterial({ color: '#fef9c3' });
    this.taillightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

    this.disposables.push(
      bodyGeo,
      bodyMat,
      cabinGeo,
      cabinMat,
      semiTrailerGeo,
      semiTrailerMat,
      wheelGeo,
      wheelMat,
      lampGeo,
      this.headlightMat,
      this.taillightMat
    );

    this.bodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, this.maxCapacity);
    this.bodyInst.castShadow = true;
    this.bodyInst.frustumCulled = false;
    this.cabinInst = new THREE.InstancedMesh(cabinGeo, cabinMat, this.maxCapacity);
    this.cabinInst.frustumCulled = false;
    this.semiTrailerInst = new THREE.InstancedMesh(semiTrailerGeo, semiTrailerMat, this.maxCapacity);
    this.semiTrailerInst.castShadow = true;
    this.semiTrailerInst.frustumCulled = false;
    this.wheelInst = new THREE.InstancedMesh(wheelGeo, wheelMat, this.maxCapacity * 2);
    this.wheelInst.frustumCulled = false;
    this.headlightInst = new THREE.InstancedMesh(lampGeo, this.headlightMat, this.maxCapacity * 2);
    this.headlightInst.frustumCulled = false;
    this.taillightInst = new THREE.InstancedMesh(lampGeo, this.taillightMat, this.maxCapacity * 2);
    this.taillightInst.frustumCulled = false;

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
      this.shadowInst.frustumCulled = false;
      this.disposables.push(shadowGeo, shadowMat);
      builtMap.root.add(this.shadowInst);
    }

    const [sx, , sz] = builtMap.manifest.defaultSpawnPosition;
    this.spawnAgents(this.maxCapacity, sx, sz, builtMap.manifest.defaultSpawnHeadingRad);
    this.setActiveCount(this.activeCount);
    this.syncInstanceMatrices(false, false);
    builtMap.root.add(
      this.bodyInst,
      this.cabinInst,
      this.semiTrailerInst,
      this.wheelInst,
      this.headlightInst,
      this.taillightInst
    );
  }

  public setActiveCount(count: number): void {
    this.activeCount = Math.max(0, Math.min(this.maxCapacity, Math.round(count)));
    this.bodyInst.count = this.activeCount;
    this.cabinInst.count = this.activeCount;
    this.semiTrailerInst.count = this.activeCount;
    this.wheelInst.count = this.activeCount * 2;
    this.headlightInst.count = this.activeCount * 2;
    this.taillightInst.count = this.activeCount * 2;
    if (this.shadowInst) {
      this.shadowInst.count = this.activeCount;
    }
  }

  private pickLaneSlot(seg: CompiledRoadSegment, archetype: TrafficArchetype, seedIdx: number): 0 | 1 {
    if (seg.def.lanes < 4) return 0;
    if (archetype === 'semi' || archetype === 'van') return 0;
    return seedIdx % 4 === 0 ? 0 : 1;
  }

  private getLaneOffsetMeters(seg: CompiledRoadSegment, laneSlot: 0 | 1): number {
    if (seg.def.lanes >= 4) {
      return laneSlot === 0 ? seg.def.width * 0.36 : seg.def.width * 0.14;
    }
    return seg.def.width * 0.25;
  }

  private speedForAgent(
    seg: CompiledRoadSegment,
    archetype: TrafficArchetype,
    laneSlot: 0 | 1
  ): number {
    if (seg.def.roadClass === 'motorway') {
      if (archetype === 'semi') return 80 / 3.6;
      if (archetype === 'van') return 86 / 3.6;
      return (laneSlot === 1 ? 102 : 90) / 3.6;
    }
    const mult = archetype === 'semi' ? 0.78 : archetype === 'van' ? 0.86 : 0.94;
    return (seg.def.speedLimitKmh * mult) / 3.6;
  }

  private spawnAgents(count: number, focusX: number, focusZ: number, focusYaw: number): void {
    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const archetype: TrafficArchetype =
        i % 5 === 0 ? 'semi' : i % 3 === 0 ? 'van' : 'sedan';
      const colorHex =
        archetype === 'semi'
          ? SEMI_COLORS[i % SEMI_COLORS.length]!
          : archetype === 'van'
          ? VAN_COLORS[i % VAN_COLORS.length]!
          : SEDAN_COLORS[i % SEDAN_COLORS.length]!;
      const fallbackSeg = this.roadPool[i % this.roadPool.length]!;
      const laneSlot = this.pickLaneSlot(fallbackSeg, archetype, i);

      const agent: TrafficAgent = {
        segment: fallbackSeg,
        dir: i % 2 === 0 ? 1 : -1,
        laneSlot,
        targetLaneSlot: laneSlot,
        lateralShift: this.getLaneOffsetMeters(fallbackSeg, laneSlot),
        sMeters: Math.min(fallbackSeg.lengthMeters - 10, 15 + i * 24),
        speedMs: 14,
        targetSpeedMs: 14,
        archetype,
        isTruck: archetype !== 'sedan',
        colorHex,
        braking: false,
        yieldTimerSec: 0,
        accidentTimerSec: 0,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        trailerX: 0,
        trailerY: 0,
        trailerZ: 0,
        trailerYaw: 0,
        trailerPitch: 0,
      };
      this.placeAgentInBubble(agent, i, focusX, focusZ, focusYaw, true);
      this.agents.push(agent);

      tmpColor.set(colorHex);
      this.bodyInst.setColorAt(i, tmpColor);
      tmpColor.set(TRAILER_COLORS[i % TRAILER_COLORS.length]!);
      this.semiTrailerInst.setColorAt(i, tmpColor);
    }
    if (this.bodyInst.instanceColor) {
      this.bodyInst.instanceColor.needsUpdate = true;
    }
    if (this.semiTrailerInst.instanceColor) {
      this.semiTrailerInst.instanceColor.needsUpdate = true;
    }
  }

  private placeAgentInBubble(
    agent: TrafficAgent,
    slotIndex: number,
    playerX: number,
    playerZ: number,
    playerYaw: number,
    isInitialSpawn: boolean
  ): void {
    const pFwdX = Math.sin(playerYaw);
    const pFwdZ = Math.cos(playerYaw);
    const wantOncoming = slotIndex % 2 === 0;
    const wantBehind = !wantOncoming && slotIndex % 4 === 3;

    const minDist = isInitialSpawn ? BUBBLE_MIN_M : wantBehind ? 160 : 280;
    const maxDist = isInitialSpawn ? BUBBLE_MAX_M : wantBehind ? 260 : BUBBLE_MAX_M;

    const candidates: {
      seg: CompiledRoadSegment;
      dir: 1 | -1;
      laneSlot: 0 | 1;
      sMeters: number;
      x: number;
      z: number;
      score: number;
    }[] = [];

    for (let sIdx = 0; sIdx < this.roadPool.length; sIdx++) {
      const seg = this.roadPool[sIdx]!;
      if (seg.samples.length < 3 || seg.lengthMeters < 40) continue;
      const laneSlot = this.pickLaneSlot(seg, agent.archetype, slotIndex);
      const laneOff = this.getLaneOffsetMeters(seg, laneSlot);

      const step = Math.max(1, Math.floor(seg.samples.length / 18));
      for (let pIdx = 1; pIdx < seg.samples.length - 1; pIdx += step) {
        const pt = seg.samples[pIdx]!;
        const dx = pt.x - playerX;
        const dz = pt.z - playerZ;
        const dist = Math.hypot(dx, dz);
        if (dist < minDist || dist > maxDist) continue;

        const dirX = dx / dist;
        const dirZ = dz / dist;
        const alongPlayer = dirX * pFwdX + dirZ * pFwdZ;

        if (!isInitialSpawn) {
          if (wantBehind && alongPlayer > -0.2) continue;
          if (!wantBehind && alongPlayer < 0.1) continue;
        }

        const dirDot = pt.tx * pFwdX + pt.tz * pFwdZ;
        let travelDir: 1 | -1;
        if (seg.def.oneWay) {
          travelDir = 1;
        } else if (wantOncoming) {
          travelDir = dirDot >= 0 ? -1 : 1;
        } else {
          travelDir = dirDot >= 0 ? 1 : -1;
        }

        const sMeters = THREE.MathUtils.clamp(pt.t * seg.lengthMeters, 12, seg.lengthMeters - 12);
        const rx = -pt.tz * travelDir;
        const rz = pt.tx * travelDir;
        const candX = pt.x + rx * laneOff;
        const candZ = pt.z + rz * laneOff;

        if (Math.hypot(candX - playerX, candZ - playerZ) < BUBBLE_MIN_M) continue;

        let tooClose = false;
        for (let j = 0; j < this.agents.length; j++) {
          const other = this.agents[j]!;
          if (other === agent) continue;
          if (Math.hypot(candX - other.x, candZ - other.z) < MIN_SAFE_GAP_M) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        const alignBonus = wantOncoming
          ? pt.tx * travelDir * pFwdX + pt.tz * travelDir * pFwdZ < -0.25
            ? 2
            : 0
          : pt.tx * travelDir * pFwdX + pt.tz * travelDir * pFwdZ > 0.25
          ? 2
          : 0;
        const score = alignBonus + Math.abs(alongPlayer) + Math.random() * 0.6;
        candidates.push({ seg, dir: travelDir, laneSlot, sMeters, x: candX, z: candZ, score });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const topSpan = Math.min(candidates.length, 6);
      const pick = candidates[(slotIndex + Math.floor(Math.random() * topSpan)) % topSpan]!;
      agent.segment = pick.seg;
      agent.dir = pick.dir;
      agent.laneSlot = pick.laneSlot;
      agent.targetLaneSlot = pick.laneSlot;
      agent.lateralShift = this.getLaneOffsetMeters(pick.seg, pick.laneSlot);
      agent.sMeters = pick.sMeters;
      agent.targetSpeedMs = this.speedForAgent(pick.seg, agent.archetype, pick.laneSlot);
      agent.speedMs = agent.targetSpeedMs;
      agent.yieldTimerSec = 0;
      agent.accidentTimerSec = 0;
      this.syncAgentPose(agent);
      return;
    }

    for (let sIdx = 0; sIdx < this.builtMap.segments.length; sIdx++) {
      const seg = this.builtMap.segments[(sIdx + slotIndex) % this.builtMap.segments.length]!;
      if (seg.samples.length < 3) continue;
      const mid = seg.samples[Math.floor(seg.samples.length * 0.5)]!;
      const dist = Math.hypot(mid.x - playerX, mid.z - playerZ);
      if (dist >= 90 && dist <= BUBBLE_MAX_M) {
        agent.segment = seg;
        agent.dir = seg.def.oneWay || slotIndex % 2 === 0 ? 1 : -1;
        agent.laneSlot = this.pickLaneSlot(seg, agent.archetype, slotIndex);
        agent.targetLaneSlot = agent.laneSlot;
        agent.lateralShift = this.getLaneOffsetMeters(seg, agent.laneSlot);
        agent.sMeters = seg.lengthMeters * 0.5;
        agent.targetSpeedMs = this.speedForAgent(seg, agent.archetype, agent.laneSlot);
        agent.speedMs = agent.targetSpeedMs;
        agent.yieldTimerSec = 0;
        agent.accidentTimerSec = 0;
        this.syncAgentPose(agent);
        return;
      }
    }

    this.syncAgentPose(agent);
  }

  private samplePitch(seg: CompiledRoadSegment, sMeters: number, dir: 1 | -1): number {
    const tAhead = THREE.MathUtils.clamp((sMeters + dir * 2.6) / seg.lengthMeters, 0, 1);
    const tBehind = THREE.MathUtils.clamp((sMeters - dir * 2.6) / seg.lengthMeters, 0, 1);
    const pA = seg.curve.getPointAt(tAhead);
    const pB = seg.curve.getPointAt(tBehind);
    const dHoriz = Math.hypot(pA.x - pB.x, pA.z - pB.z) || 1;
    return THREE.MathUtils.clamp(-Math.atan2(pA.y - pB.y, dHoriz), -0.25, 0.25);
  }

  private syncAgentPose(agent: TrafficAgent, dtSec = 0.016): void {
    const seg = agent.segment;
    const t = THREE.MathUtils.clamp(agent.sMeters / seg.lengthMeters, 0, 1);
    const p = seg.curve.getPointAt(t);
    const tan = seg.curve.getTangentAt(t);
    const hLen = Math.hypot(tan.x, tan.z) || 1;
    const tx = tan.x / hLen;
    const tz = tan.z / hLen;

    if (agent.accidentTimerSec <= 0) {
      const targetLat = this.getLaneOffsetMeters(seg, agent.targetLaneSlot);
      agent.lateralShift += (targetLat - agent.lateralShift) * Math.min(1, dtSec * 3.5);
      if (Math.abs(targetLat - agent.lateralShift) < 0.2) {
        agent.laneSlot = agent.targetLaneSlot;
      }
    }

    const rx = -tz * agent.dir;
    const rz = tx * agent.dir;
    agent.x = p.x + rx * agent.lateralShift;
    agent.y = p.y;
    agent.z = p.z + rz * agent.lateralShift;
    agent.yaw = Math.atan2(tx * agent.dir, tz * agent.dir);
    agent.pitch = this.samplePitch(seg, agent.sMeters, agent.dir);

    if (agent.archetype === 'semi') {
      const sTr = THREE.MathUtils.clamp(agent.sMeters - agent.dir * 5.9, 0, seg.lengthMeters);
      const tTr = THREE.MathUtils.clamp(sTr / seg.lengthMeters, 0, 1);
      const pTr = seg.curve.getPointAt(tTr);
      const tanTr = seg.curve.getTangentAt(tTr);
      const hLenTr = Math.hypot(tanTr.x, tanTr.z) || 1;
      const txTr = tanTr.x / hLenTr;
      const tzTr = tanTr.z / hLenTr;
      const rxTr = -tzTr * agent.dir;
      const rzTr = txTr * agent.dir;
      agent.trailerX = pTr.x + rxTr * agent.lateralShift;
      agent.trailerY = pTr.y;
      agent.trailerZ = pTr.z + rzTr * agent.lateralShift;
      agent.trailerYaw = Math.atan2(txTr * agent.dir, tzTr * agent.dir);
      agent.trailerPitch = this.samplePitch(seg, sTr, agent.dir);
    } else {
      agent.trailerX = agent.x;
      agent.trailerY = agent.y;
      agent.trailerZ = agent.z;
      agent.trailerYaw = agent.yaw;
      agent.trailerPitch = agent.pitch;
    }
  }

  private transitionNextSegment(agent: TrafficAgent, slotIndex: number): void {
    const arrivedNodeId = agent.dir === 1 ? agent.segment.def.toNodeId : agent.segment.def.fromNodeId;
    const connected = this.nodeConnections.get(arrivedNodeId) ?? [];
    const arterialOptions = connected.filter(
      (s) => s.def.id !== agent.segment.def.id && s.def.roadClass !== 'urban'
    );
    const anyOptions =
      arterialOptions.length > 0
        ? arterialOptions
        : connected.filter((s) => s.def.id !== agent.segment.def.id);
    const nextSeg =
      anyOptions.length > 0 ? anyOptions[Math.floor(Math.random() * anyOptions.length)]! : agent.segment;

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
    agent.laneSlot = this.pickLaneSlot(agent.segment, agent.archetype, slotIndex);
    agent.targetLaneSlot = agent.laneSlot;
    agent.lateralShift = this.getLaneOffsetMeters(agent.segment, agent.laneSlot);
    agent.targetSpeedMs = this.speedForAgent(agent.segment, agent.archetype, agent.laneSlot);
  }

  private isAdjacentLaneClear(
    agent: TrafficAgent,
    candidateLane: 0 | 1,
    playerCircles: readonly { x: number; z: number }[]
  ): boolean {
    const candLat = this.getLaneOffsetMeters(agent.segment, candidateLane);
    const t = THREE.MathUtils.clamp(agent.sMeters / agent.segment.lengthMeters, 0, 1);
    const p = agent.segment.curve.getPointAt(t);
    const tan = agent.segment.curve.getTangentAt(t);
    const hLen = Math.hypot(tan.x, tan.z) || 1;
    const tx = (tan.x / hLen) * agent.dir;
    const tz = (tan.z / hLen) * agent.dir;
    const rx = -tz;
    const rz = tx;
    const candX = p.x + rx * candLat;
    const candZ = p.z + rz * candLat;

    for (let k = 0; k < playerCircles.length; k++) {
      const pc = playerCircles[k]!;
      const dx = pc.x - candX;
      const dz = pc.z - candZ;
      const fwd = dx * tx + dz * tz;
      const lat = Math.abs(dx * rx + dz * rz);
      if (Math.abs(fwd) < 35 && lat < 3.4) return false;
    }
    for (let j = 0; j < this.activeCount; j++) {
      const other = this.agents[j]!;
      if (other === agent || Math.abs(other.y - agent.y) > 5) continue;
      const dx = other.x - candX;
      const dz = other.z - candZ;
      const fwd = dx * tx + dz * tz;
      const lat = Math.abs(dx * rx + dz * rz);
      if (Math.abs(fwd) < 35 && lat < 3.2) return false;
    }
    return true;
  }

  public update(
    dtSec: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    playerYaw: number,
    trailerX: number,
    trailerZ: number,
    nightFactor = 0,
    rainIntensity = 0,
    playerHorn = false,
    trailerYaw = playerYaw,
    trailerAttached = true,
    playerSpeedMs = 0
  ): CollisionEvent | null {
    this.hazardClockSec += dtSec;
    const hazardFlashOn = Math.floor(this.hazardClockSec * 3.0) % 2 === 0;
    const lightsOn = nightFactor > 0.25 || rainIntensity > 0.25;
    this.headlightMat.color.setHex(lightsOn ? 0xfffbeb : 0xe2e8f0);
    let collision: CollisionEvent | null = null;
    if (this.collisionCooldownSec > 0) {
      this.collisionCooldownSec = Math.max(0, this.collisionCooldownSec - dtSec);
    }

    const pFwdX = Math.sin(playerYaw);
    const pFwdZ = Math.cos(playerYaw);
    const trFwdX = Math.sin(trailerYaw);
    const trFwdZ = Math.cos(trailerYaw);
    const playerCircles: { x: number; z: number }[] = [
      { x: playerX + pFwdX * 1.9, z: playerZ + pFwdZ * 1.9 },
      { x: playerX - pFwdX * 1.8, z: playerZ - pFwdZ * 1.8 },
    ];
    if (trailerAttached) {
      playerCircles.push(
        { x: trailerX + trFwdX * 3.2, z: trailerZ + trFwdZ * 3.2 },
        { x: trailerX - trFwdX * 4.4, z: trailerZ - trFwdZ * 4.4 }
      );
    }

    for (let i = 0; i < this.activeCount; i++) {
      const a = this.agents[i]!;

      const distSqToPlayer = (a.x - playerX) * (a.x - playerX) + (a.z - playerZ) * (a.z - playerZ);
      if (distSqToPlayer > RECYCLE_DIST_M * RECYCLE_DIST_M) {
        this.placeAgentInBubble(a, i, playerX, playerZ, playerYaw, false);
      }

      if (a.yieldTimerSec > 0) {
        a.yieldTimerSec = Math.max(0, a.yieldTimerSec - dtSec);
      }
      if (a.accidentTimerSec > 0) {
        a.accidentTimerSec = Math.max(0, a.accidentTimerSec - dtSec);
      }

      const isSemi = a.archetype === 'semi';
      const frontHalf = isSemi ? 5.15 : a.archetype === 'van' ? 2.65 : 2.3;
      const stopDist = (a.speedMs * a.speedMs) / (2 * 5.5) + 8.0;

      let desiredSpeed = a.accidentTimerSec > 0 ? 0 : a.targetSpeedMs;
      const fwdX = Math.sin(a.yaw);
      const fwdZ = Math.cos(a.yaw);

      if (a.accidentTimerSec <= 0) {
        // 1. Traffic lights at approaching signalized nodes
        const remainingToNode = a.dir === 1 ? a.segment.lengthMeters - a.sMeters : a.sMeters;
        if (remainingToNode < 32 && remainingToNode > 7) {
          const destNodeId = a.dir === 1 ? a.segment.def.toNodeId : a.segment.def.fromNodeId;
          const signal = this.builtMap.getTrafficLightState(destNodeId, fwdX, fwdZ);
          if (signal !== 'green') {
            desiredSpeed =
              remainingToNode < 14 ? 0 : Math.min(desiredSpeed, ((remainingToNode - 14) / 18) * 7);
          }
        }

        // 2. Predictive physical braking against all 4 player hull circles (tractor + trailer)
        if (Math.abs(a.y - playerY) < 6) {
          const laneBand = isSemi ? 3.2 : 2.9;
          for (let k = 0; k < playerCircles.length; k++) {
            const pc = playerCircles[k]!;
            const dx = pc.x - a.x;
            const dz = pc.z - a.z;
            const forwardDot = dx * fwdX + dz * fwdZ;
            const lateralDist = Math.abs(dx * -fwdZ + dz * fwdX);
            const netGap = forwardDot - frontHalf - PLAYER_HULL_RADIUS;
            if (lateralDist < laneBand && netGap > -4.0 && netGap < stopDist + 16) {
              if (netGap <= 6.0) {
                desiredSpeed = 0;
              } else {
                const ramp = (netGap - 6.0) / (stopDist + 10.0);
                desiredSpeed = Math.min(desiredSpeed, ramp * a.targetSpeedMs);
              }
            }
            if (playerHorn && Math.hypot(dx, dz) < 36) {
              a.yieldTimerSec = 1.4;
            } else if (Math.abs(forwardDot) < 12 && lateralDist < 3.4 && lateralDist > 1.8) {
              a.yieldTimerSec = Math.max(a.yieldTimerSec, 0.7);
            }
          }
        }

        if (a.yieldTimerSec > 0) {
          desiredSpeed = Math.min(desiredSpeed, a.targetSpeedMs * 0.72);
        }

        // 3. Predictive braking & motorway lane-change overtaking against leading AI vehicles
        for (let j = 0; j < this.activeCount; j++) {
          if (i === j) continue;
          const b = this.agents[j]!;
          if (Math.abs(a.y - b.y) > 5) continue;

          const bIsSemi = b.archetype === 'semi';
          const bRefX = bIsSemi ? b.trailerX : b.x;
          const bRefZ = bIsSemi ? b.trailerZ : b.z;
          const bRearHalf = bIsSemi ? 4.9 : 2.3;

          const dx = bRefX - a.x;
          const dz = bRefZ - a.z;
          const forwardDot = dx * fwdX + dz * fwdZ;
          const lateralDist = Math.abs(dx * -fwdZ + dz * fwdX);
          const netGap = forwardDot - frontHalf - bRearHalf;

          if (lateralDist < 2.65 && netGap > -2.0 && netGap < stopDist + 14) {
            // Try clean motorway lane change around stopped accident vehicles or slower outer trucks
            if (
              a.segment.def.lanes >= 4 &&
              (b.accidentTimerSec > 0 || b.targetSpeedMs < a.targetSpeedMs - 2.0) &&
              netGap < 40
            ) {
              const altLane: 0 | 1 = a.targetLaneSlot === 0 ? 1 : 0;
              if (this.isAdjacentLaneClear(a, altLane, playerCircles)) {
                a.targetLaneSlot = altLane;
                a.targetSpeedMs = this.speedForAgent(a.segment, a.archetype, altLane);
              }
            }

            if (netGap <= 5.0) {
              desiredSpeed = 0;
            } else {
              const ramp = Math.min(1, (netGap - 5.0) / (stopDist + 5.0));
              desiredSpeed = Math.min(desiredSpeed, Math.max(b.speedMs * 0.92, ramp * a.targetSpeedMs));
              if (b.speedMs < 1.0 && netGap < stopDist + 6) {
                desiredSpeed = Math.min(desiredSpeed, ramp * a.targetSpeedMs);
              }
            }
          }
        }
      }

      a.braking = a.accidentTimerSec > 0 || desiredSpeed < a.speedMs - 0.8 || a.speedMs < 1.2;

      if (a.accidentTimerSec > 0) {
        a.speedMs = 0;
      } else if (desiredSpeed < a.speedMs) {
        a.speedMs = Math.max(desiredSpeed, a.speedMs - 9.5 * dtSec);
      } else {
        a.speedMs += (desiredSpeed - a.speedMs) * Math.min(1, dtSec * 3.2);
      }

      a.sMeters += a.dir * a.speedMs * dtSec;
      if (a.sMeters >= a.segment.lengthMeters - 1 || a.sMeters <= 1) {
        this.transitionNextSegment(a, i);
      }
      this.syncAgentPose(a, dtSec);

      // 4. Multi-circle hull collision detection (covers AI semi tractor + trailer vs player tractor + trailer)
      if (Math.abs(a.y - playerY) < 4.5) {
        const aiFwdX = Math.sin(a.yaw);
        const aiFwdZ = Math.cos(a.yaw);
        const aiTrFwdX = Math.sin(a.trailerYaw);
        const aiTrFwdZ = Math.cos(a.trailerYaw);
        const aiCircles: { x: number; z: number; r: number }[] = isSemi
          ? [
              { x: a.x + aiFwdX * 3.8, z: a.z + aiFwdZ * 3.8, r: 1.3 },
              { x: a.x + aiFwdX * 1.5, z: a.z + aiFwdZ * 1.5, r: 1.3 },
              { x: a.trailerX + aiTrFwdX * 2.5, z: a.trailerZ + aiTrFwdZ * 2.5, r: 1.35 },
              { x: a.trailerX - aiTrFwdX * 3.0, z: a.trailerZ - aiTrFwdZ * 3.0, r: 1.35 },
            ]
          : [
              { x: a.x + aiFwdX * 1.15, z: a.z + aiFwdZ * 1.15, r: 1.15 },
              { x: a.x - aiFwdX * 1.15, z: a.z - aiFwdZ * 1.15, r: 1.15 },
            ];

        let maxPen = 0;
        let bestCa: { x: number; z: number; r: number } | null = null;
        let bestCp: { x: number; z: number } | null = null;
        for (let ac = 0; ac < aiCircles.length; ac++) {
          const cA = aiCircles[ac]!;
          for (let pc = 0; pc < playerCircles.length; pc++) {
            const cP = playerCircles[pc]!;
            const dist = Math.hypot(cA.x - cP.x, cA.z - cP.z);
            const minSep = cA.r + PLAYER_HULL_RADIUS;
            if (dist < minSep) {
              const pen = minSep - dist;
              if (pen > maxPen) {
                maxPen = pen;
                bestCa = cA;
                bestCp = cP;
              }
            }
          }
        }

        if (maxPen > 0 && bestCa && bestCp) {
          const relVx = aiFwdX * a.speedMs - pFwdX * playerSpeedMs;
          const relVz = aiFwdZ * a.speedMs - pFwdZ * playerSpeedMs;
          const relSpeedKmh = Math.hypot(relVx, relVz) * 3.6;

          // Push AI cleanly away from the player along impact direction so crashed vehicles remain visible
          const sepX = bestCa.x - bestCp.x;
          const sepZ = bestCa.z - bestCp.z;
          const aiRightX = -aiFwdZ;
          const aiRightZ = aiFwdX;
          const alongFwd = sepX * aiFwdX + sepZ * aiFwdZ;
          const alongRight = sepX * aiRightX + sepZ * aiRightZ;

          if (Math.abs(alongFwd) >= Math.abs(alongRight) * 0.45) {
            const pushSign = alongFwd >= 0 ? 1 : -1;
            const pushDist = Math.min(maxPen + 0.35, 1.8);
            a.sMeters = THREE.MathUtils.clamp(
              a.sMeters + a.dir * pushSign * pushDist,
              2,
              a.segment.lengthMeters - 2
            );
          } else {
            const latSign = alongRight >= 0 ? 1 : -1;
            const latPush = Math.min(maxPen + 0.25, 1.4);
            a.lateralShift = THREE.MathUtils.clamp(
              a.lateralShift + latSign * latPush,
              0.8,
              a.segment.def.width * 0.46
            );
            const longSign = alongFwd >= 0 ? 1 : -1;
            a.sMeters = THREE.MathUtils.clamp(
              a.sMeters + a.dir * longSign * 0.35,
              2,
              a.segment.lengthMeters - 2
            );
          }
          a.speedMs = 0;
          a.accidentTimerSec = 3.5;
          this.syncAgentPose(a, dtSec);

          if (relSpeedKmh > 8 && this.collisionCooldownSec <= 0) {
            this.collisionCooldownSec = 2.5;
            collision = {
              impactSpeedKmh: Math.round(relSpeedKmh),
              label:
                a.archetype === 'semi'
                  ? '竞争对手半挂车'
                  : a.archetype === 'van'
                  ? '欧系厢式货车'
                  : '社会乘用车',
            };
          }
        }
      }
    }

    this.syncInstanceMatrices(lightsOn, hazardFlashOn);
    return collision;
  }

  private syncInstanceMatrices(lightsOn: boolean, hazardFlashOn: boolean): void {
    for (let i = 0; i < this.activeCount; i++) {
      const a = this.agents[i]!;
      const isSemi = a.archetype === 'semi';
      const scaleZ = isSemi ? 0.9 : a.archetype === 'van' ? 1.16 : 0.96;
      const scaleY = isSemi ? 1.28 : a.archetype === 'van' ? 1.52 : 0.95;
      const frontHalf = isSemi ? 5.15 : a.archetype === 'van' ? 2.65 : 2.3;

      // 5. Update instanced matrices with exact road pitch & independent semi-trailer articulation
      const updatedFwdX = Math.sin(a.yaw);
      const updatedFwdZ = Math.cos(a.yaw);
      const updatedTrFwdX = Math.sin(a.trailerYaw);
      const updatedTrFwdZ = Math.cos(a.trailerYaw);

      const bodyCenterOff = isSemi ? 3.1 : 0;
      this.dummy.position.set(
        a.x + updatedFwdX * bodyCenterOff,
        a.y + 0.62 * scaleY,
        a.z + updatedFwdZ * bodyCenterOff
      );
      this.dummy.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
      this.dummy.scale.set(isSemi ? 1.05 : 1, scaleY, scaleZ);
      this.dummy.updateMatrix();
      this.bodyInst.setMatrixAt(i, this.dummy.matrix);

      const cabOff = isSemi ? 3.55 : a.archetype === 'van' ? 1.55 : -0.2;
      const cabY = isSemi ? 1.98 : a.archetype === 'van' ? 1.58 : 1.35;
      const cabScaleZ = isSemi ? 0.72 : a.archetype === 'van' ? 0.58 : 1.0;
      this.dummy.position.set(a.x + updatedFwdX * cabOff, a.y + cabY, a.z + updatedFwdZ * cabOff);
      this.dummy.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
      this.dummy.scale.set(isSemi ? 1.1 : 1, isSemi ? 1.38 : 1, cabScaleZ);
      this.dummy.updateMatrix();
      this.cabinInst.setMatrixAt(i, this.dummy.matrix);

      if (isSemi) {
        this.dummy.position.set(a.trailerX, a.trailerY + 1.88, a.trailerZ);
        this.dummy.rotation.set(a.trailerPitch, a.trailerYaw, 0, 'YXZ');
        this.dummy.scale.set(1, 1, 1);
      } else {
        this.dummy.position.set(a.x, a.y - 20, a.z);
        this.dummy.rotation.set(0, a.yaw, 0);
        this.dummy.scale.set(0, 0, 0);
      }
      this.dummy.updateMatrix();
      this.semiTrailerInst.setMatrixAt(i, this.dummy.matrix);

      const frontAxle = isSemi ? 3.8 : a.archetype === 'van' ? 1.65 : 1.35;
      this.dummy.position.set(a.x + updatedFwdX * frontAxle, a.y + 0.36, a.z + updatedFwdZ * frontAxle);
      this.dummy.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.wheelInst.setMatrixAt(i * 2, this.dummy.matrix);

      if (isSemi) {
        this.dummy.position.set(a.trailerX - updatedTrFwdX * 3.1, a.trailerY + 0.36, a.trailerZ - updatedTrFwdZ * 3.1);
        this.dummy.rotation.set(a.trailerPitch, a.trailerYaw, 0, 'YXZ');
      } else {
        const rearAxle = a.archetype === 'van' ? 1.65 : 1.35;
        this.dummy.position.set(a.x - updatedFwdX * rearAxle, a.y + 0.36, a.z - updatedFwdZ * rearAxle);
        this.dummy.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
      }
      this.dummy.updateMatrix();
      this.wheelInst.setMatrixAt(i * 2 + 1, this.dummy.matrix);

      // Front headlights & dynamic brake/hazard taillights
      const rightX = -updatedFwdZ;
      const rightZ = updatedFwdX;
      const rearFwdX = isSemi ? updatedTrFwdX : updatedFwdX;
      const rearFwdZ = isSemi ? updatedTrFwdZ : updatedFwdZ;
      const rearRightX = -rearFwdZ;
      const rearRightZ = rearFwdX;
      const rearBaseX = isSemi ? a.trailerX : a.x;
      const rearBaseY = isSemi ? a.trailerY : a.y;
      const rearBaseZ = isSemi ? a.trailerZ : a.z;
      const rearHalf = isSemi ? 4.82 : 2.3 * scaleZ;

      if (a.accidentTimerSec > 0) {
        this.tmpBrakeColor.setHex(hazardFlashOn ? 0xf59e0b : 0x7f1d1d);
      } else {
        this.tmpBrakeColor.setHex(a.braking ? 0xff2626 : lightsOn ? 0x991b1b : 0x450a0a);
      }

      for (const [idxOffset, side] of [
        [0, -0.74],
        [1, 0.74],
      ] as const) {
        this.dummy.position.set(
          a.x + updatedFwdX * frontHalf + rightX * side,
          a.y + 0.68,
          a.z + updatedFwdZ * frontHalf + rightZ * side
        );
        this.dummy.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.headlightInst.setMatrixAt(i * 2 + idxOffset, this.dummy.matrix);

        this.dummy.position.set(
          rearBaseX - rearFwdX * rearHalf + rearRightX * side,
          rearBaseY + 0.7,
          rearBaseZ - rearFwdZ * rearHalf + rearRightZ * side
        );
        this.dummy.rotation.set(isSemi ? a.trailerPitch : a.pitch, isSemi ? a.trailerYaw : a.yaw, 0, 'YXZ');
        this.dummy.updateMatrix();
        this.taillightInst.setMatrixAt(i * 2 + idxOffset, this.dummy.matrix);
        this.taillightInst.setColorAt(i * 2 + idxOffset, this.tmpBrakeColor);
      }

      if (this.shadowInst) {
        this.dummy.position.set(
          isSemi ? (a.x + a.trailerX) * 0.5 : a.x,
          a.y + 0.032,
          isSemi ? (a.z + a.trailerZ) * 0.5 : a.z
        );
        this.dummy.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
        this.dummy.scale.set(1, 1, isSemi ? 2.35 : scaleZ * 0.96);
        this.dummy.updateMatrix();
        this.shadowInst.setMatrixAt(i, this.dummy.matrix);
      }
    }

    this.bodyInst.instanceMatrix.needsUpdate = true;
    this.cabinInst.instanceMatrix.needsUpdate = true;
    this.semiTrailerInst.instanceMatrix.needsUpdate = true;
    this.wheelInst.instanceMatrix.needsUpdate = true;
    this.headlightInst.instanceMatrix.needsUpdate = true;
    this.taillightInst.instanceMatrix.needsUpdate = true;
    if (this.taillightInst.instanceColor) {
      this.taillightInst.instanceColor.needsUpdate = true;
    }
    if (this.shadowInst) {
      this.shadowInst.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.bodyInst.dispose();
    this.cabinInst.dispose();
    this.semiTrailerInst.dispose();
    this.wheelInst.dispose();
    this.headlightInst.dispose();
    this.taillightInst.dispose();
    this.shadowInst?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
