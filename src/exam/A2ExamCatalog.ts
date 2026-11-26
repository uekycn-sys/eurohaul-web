import { A2ExamLevelDef, A2ExamLevelId } from './types';

export interface PolyPoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
  s: number;
}

export const A2_LAYOUT = {
  reverseBay: {
    apronMinX: -24,
    apronMaxX: 24,
    apronMinZ: -26,
    apronMaxZ: 40,
    bayMinX: -2.25,
    bayMaxX: 2.25,
    bayMinZ: -20.5,
    bayMaxZ: -1.0,
    startZoneMinX: 4.5,
    startZoneMaxX: 10.5,
    startZoneMinZ: 6.0,
    startZoneMaxZ: 28.0,
  },
  hillStart: {
    minX: -2.6,
    maxX: 5.0,
    minZ: -35,
    maxZ: 128,
    rampStartZ: 0,
    rampEndZ: 48,
    crestHeight: 4.8, // 10% average grade
    stopLineZ: 28.0,
    finishZ: 60.0,
  },
  parallelPark: {
    laneMinX: -2.0,
    laneMaxX: 4.8,
    minZ: -25,
    maxZ: 68,
    bayMinX: -6.4,
    bayMaxX: -2.0,
    bayMinZ: 3.0,
    bayMaxZ: 28.5,
    passBayRearZ: 29.5,
    finishZ: 44.0,
  },
  singleBridge: {
    minX: -5.5,
    maxX: 5.5,
    minZ: -25,
    maxZ: 96,
    leftCenterX: 1.12,
    leftStartZ: 18,
    leftEndZ: 34,
    rightCenterX: -1.12,
    rightStartZ: 50,
    rightEndZ: 66,
    bridgeWidth: 0.64,
    bridgeHeight: 0.14,
    rampLen: 1.2,
    finishZ: 82,
  },
  sCurve: {
    radius: 26,
    arcDeg: 122,
    halfWidth: 3.45,
    entryStartZ: -24,
    exitLen: 30,
  },
  rightAngleGates: {
    legHalfW: 3.4,
    entryMinZ: -22,
    cornerOuterZ: 24.5,
    cornerInnerZ: 17.7,
    exitMaxX: 128,
    gateGapWidth: 3.55,
    gates: [
      { x: 46, centerZ: 21.8 },
      { x: 74, centerZ: 20.1 },
      { x: 102, centerZ: 21.5 },
    ],
    finishX: 118,
  },
  mountainHazard: {
    minZ: -22,
    maxZ: 340,
    halfW: 4.3,
    tunnelStartZ: 15,
    tunnelEndZ: 75,
    downgradeStartZ: 75,
    downgradeEndZ: 215,
    topY: 11.2,
    rainStartZ: 215,
    triggerZ: 250,
    barricadeZ: 296,
    stopMinZ: 262,
    stopMaxZ: 291,
  },
  subject3: {
    minX: -7.5,
    maxX: 7.5,
    minZ: -20,
    maxZ: 525,
    curbX: -7.5,
    laneDividerX: -3.75,
    startCheckZ: 55,
    laneChangeTriggerZ: 65,
    laneChangeEndZ: 165,
    signalStopZ: 222,
    signalLineZ: 225,
    schoolStartZ: 240,
    schoolEndZ: 295,
    gearZoneStartZ: 305,
    gearZoneEndZ: 420,
    pulloverStartZ: 430,
    pulloverFinishZ: 505,
  },
} as const;

export function hillStartHeight(z: number): number {
  const { rampStartZ, rampEndZ, crestHeight } = A2_LAYOUT.hillStart;
  if (z <= rampStartZ) return 0;
  if (z >= rampEndZ && z <= 82) return crestHeight;
  if (z > 82) {
    const tDown = Math.min(1, Math.max(0, (z - 82) / 42));
    return crestHeight * (1 - tDown * tDown * (3 - 2 * tDown));
  }
  const t = (z - rampStartZ) / (rampEndZ - rampStartZ);
  // Smooth ease at bottom/top (10% steady slope in middle)
  if (t < 0.08) {
    const u = t / 0.08;
    return crestHeight * 0.04 * (u * u);
  }
  if (t > 0.92) {
    const u = (1 - t) / 0.08;
    return crestHeight * (1 - 0.04 * u * u);
  }
  return crestHeight * (0.04 + ((t - 0.08) / 0.84) * 0.92);
}

export function mountainCenterX(z: number): number {
  if (z <= 78 || z >= 212) return 0;
  const u = (z - 78) / (212 - 78);
  const env = Math.sin(u * Math.PI);
  return Math.sin(u * Math.PI * 2) * 8.5 * env;
}

export function mountainHeight(z: number): number {
  const { downgradeStartZ, downgradeEndZ, topY } = A2_LAYOUT.mountainHazard;
  if (z <= downgradeStartZ) return topY;
  if (z >= downgradeEndZ) return 0;
  const t = (z - downgradeStartZ) / (downgradeEndZ - downgradeStartZ);
  const smooth = t * t * (3 - 2 * t);
  return topY * (1 - smooth);
}

let cachedSCurve: PolyPoint[] | null = null;

export function getSCurveCenterline(): PolyPoint[] {
  if (cachedSCurve) return cachedSCurve;
  const { radius, arcDeg, entryStartZ, exitLen } = A2_LAYOUT.sCurve;
  const maxRad = (arcDeg * Math.PI) / 180;
  const pts: { x: number; z: number }[] = [];

  for (let z = entryStartZ; z < 0; z += 1.0) {
    pts.push({ x: 0, z });
  }

  // Left curve: center (+radius, 0)
  const arcSteps = Math.ceil(radius * maxRad);
  for (let i = 0; i <= arcSteps; i++) {
    const a = (i / arcSteps) * maxRad;
    pts.push({
      x: radius - radius * Math.cos(a),
      z: radius * Math.sin(a),
    });
  }

  // Tangent-matched Right curve
  const pEnd = pts[pts.length - 1]!;
  const c2x = pEnd.x - radius * Math.cos(maxRad);
  const c2z = pEnd.z + radius * Math.sin(maxRad);

  for (let i = 1; i <= arcSteps; i++) {
    const a = maxRad * (1 - i / arcSteps);
    pts.push({
      x: c2x + radius * Math.cos(a),
      z: c2z - radius * Math.sin(a),
    });
  }

  const exitStart = pts[pts.length - 1]!;
  for (let d = 1; d <= exitLen; d += 1.0) {
    pts.push({ x: exitStart.x, z: exitStart.z + d });
  }

  const poly: PolyPoint[] = [];
  let accumS = 0;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    if (i > 0) {
      accumS += Math.hypot(cur.x - prev.x, cur.z - prev.z);
    }
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    poly.push({ x: cur.x, z: cur.z, tx: dx / len, tz: dz / len, s: accumS });
  }

  cachedSCurve = poly;
  return poly;
}

export const A2_EXAM_LEVELS: A2ExamLevelDef[] = [
  {
    id: 'reverse_bay',
    order: 1,
    subjectLabel: '科目二 · 01',
    title: '桩考 / 半挂倒车入库',
    subtitle: '牵引车与半挂车整体直线/曲线倒库',
    difficulty: 4,
    timeLimitSec: 360,
    passingScore: 90,
    spawnPosition: [7.5, 0, 14.5],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '将 16.6m 重型半挂列车从起始区域倒车入库，要求车身及半挂车全车入库且不碰杆、不压黄线，停稳保持 1.2 秒。',
    rulesSummary: [
      '车身出线或碰撞标杆：直接扣 100 分（不合格）',
      '倒车折头夹角超过 68°：每次扣 10 分',
      '中途停车超过 2 秒：每次扣 5 分',
      '手动熄火：每次扣 10 分（按 I 重新点火）',
    ],
    coachTip: '口诀：倒车“打左车尾右摆”，观察电子后视镜或 [3] 侧视视角，先微调让挂车进库再快速回顺车头！',
  },
  {
    id: 'hill_start',
    order: 2,
    subjectLabel: '科目二 · 02',
    title: '坡道定点停车和起步',
    subtitle: '10% 陡坡精准停靠 + 半联动防溜坡起步',
    difficulty: 3,
    timeLimitSec: 180,
    passingScore: 90,
    spawnPosition: [-1.18, 0, -12.0],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '驾驶半挂车驶上 10% 坡道，前保险杠精准停在桩杆红白线上（±50cm），右侧距边线 ≤35cm，随后拉手刹并平稳起步通过坡顶。',
    rulesSummary: [
      '车头未停在定点线 ±1.5m 内或后溜 >30cm：扣 100 分',
      '前保险杠偏差 50~150cm 或边距 35~55cm：扣 10 分',
      '起步后溜 10~30cm 或未拉手刹/熄火：扣 10 分',
      '右侧车轮压边线：扣 100 分',
    ],
    coachTip: '口诀：上坡贴右看标杆，停稳拉手刹 [Space]；MT 模式可按住离合 [Z] 配合油门防溜，松手刹平稳冲过坡顶。',
  },
  {
    id: 'parallel_park',
    order: 3,
    subjectLabel: '科目二 · 03',
    title: '侧方停车',
    subtitle: '半挂右侧泊车入位 + 规范打灯出库',
    difficulty: 4,
    timeLimitSec: 300,
    passingScore: 90,
    spawnPosition: [0.6, 0, -6.0],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '向前行驶越过侧方库位后，将整辆半挂车倒车入右侧凹形车位停稳，最后开启左转向灯安全驶出考区。',
    rulesSummary: [
      '行驶中轮胎压实线或出库触线：扣 100 分',
      '出库未提前开启左转向灯 [Q]：扣 10 分',
      '中途停车超过 2 秒：每次扣 5 分',
      '入库后车身与半挂必须全部进入库位线内',
    ],
    coachTip: '口诀：先向前拉过库位线，挂 R 档右打方向让挂车尾进库，挂车进库一半后左反打拉直车身，出库必打左灯 [Q]。',
  },
  {
    id: 'single_bridge',
    order: 4,
    subjectLabel: '科目二 · 04',
    title: '通过单边桥',
    subtitle: '左桥右桥连续精准碾压（半挂多轴全检）',
    difficulty: 3,
    timeLimitSec: 180,
    passingScore: 90,
    spawnPosition: [0.0, 0, -6.0],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '依次让左侧车轮精准碾过左单边桥（+14cm 凸起桥面），随后修正方向让右侧车轮通过右单边桥，全程半挂车轴不得掉桥。',
    rulesSummary: [
      '牵引车或半挂车任意一轴车轮未上桥/掉桥：每次扣 10 分',
      '车身驶出考道边界线：扣 100 分',
      '中途停车超过 2 秒：每次扣 5 分',
    ],
    coachTip: '口诀：左轮对准左桥中心低速怠速通过，下左桥后不要急打方向，待挂车也完全下桥后再平滑向右对齐右桥！',
  },
  {
    id: 's_curve',
    order: 5,
    subjectLabel: '科目二 · 05',
    title: '曲线行驶 (S 弯)',
    subtitle: '大曲率连续弯道控制半挂内轮差',
    difficulty: 3,
    timeLimitSec: 210,
    passingScore: 90,
    spawnPosition: [0.0, 0, -8.0],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '匀速通过连续 S 形弯道，严禁牵引车及半挂车任何车轮压黄线或驶出车道。半挂存在显著内轮差，入弯须贴外沿！',
    rulesSummary: [
      '牵引车或半挂车轮压边缘黄线：扣 100 分',
      '中途停车超过 2 秒：每次扣 5 分',
      '建议全程保持 12~18 km/h 均匀通过',
    ],
    coachTip: '口诀：左转贴右、右转贴左！S 弯换向时注意给挂车留出回摆半径，可在 [5] 俯视视角练习观察内轮差轨迹。',
  },
  {
    id: 'right_angle_gates',
    order: 6,
    subjectLabel: '科目二 · 06',
    title: '直角转弯与限宽门',
    subtitle: '90° 急弯防内轮扫线 + 连续三道限宽穿行',
    difficulty: 4,
    timeLimitSec: 240,
    passingScore: 90,
    spawnPosition: [-1.0, 0, -6.0],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '靠右驶入直角区完成 90° 左转，随后连续穿过三座错位 3.55m 窄门标杆，考验车宽预判与挂车随动控制。',
    rulesSummary: [
      '直角转弯压线或触碰限宽门标杆：扣 100 分',
      '直角转弯未打左转向灯 [Q]：扣 10 分',
      '通过限宽门车速过低停车 (>2s)：扣 5 分',
    ],
    coachTip: '口诀：直角左转先靠右外沿，车头快抵对侧边线再左打满；过限宽门切忌大角度急打，小幅提前对准门心。',
  },
  {
    id: 'mountain_hazard',
    order: 7,
    subjectLabel: '科目二 · 07',
    title: '隧道 · 山区陡坡 · 雨雾应急',
    subtitle: 'A2 特有恶劣路况综合处置考核',
    difficulty: 5,
    timeLimitSec: 300,
    passingScore: 90,
    spawnPosition: [0.0, 11.2, -10.0],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '依次完成隧道开灯鸣笛限速行驶、8% 山区长下坡（严禁空挡滑行，善用缓速器/排气制动防止热衰减），以及湿滑路面突发障碍紧急制动开双闪！',
    rulesSummary: [
      '进隧道未开近光灯 [L] 或未鸣笛 [H]：各扣 10 分',
      '下坡空挡滑行 (N档) 或撞击前方障碍物：扣 100 分',
      '刹车片过热 (>320°C) 或雨区未开雨刷 [P]：扣 10 分',
      '突发险情停稳后必须开启双闪警示灯 [X]',
    ],
    coachTip: '口诀：入洞先开灯 [L] 鸣笛 [H]；下长坡开启缓速器 [B] 与排气制动 [J] 控速；遇雨开雨刷 [P]，见障急停开双闪 [X]！',
  },
  {
    id: 'subject3_road',
    order: 8,
    subjectLabel: '科目三 · 08',
    title: 'A2 综合道路考试',
    subtitle: '起步 · 变道 · 信号灯 · 学校斑马线 · 加减挡 · 靠边停车',
    difficulty: 5,
    timeLimitSec: 360,
    passingScore: 90,
    spawnPosition: [-5.85, 0, 0.0],
    spawnHeadingRad: 0,
    trailerAttached: true,
    description:
      '完整模拟中国 A2 科目三道路驾驶全流程：规范打灯鸣笛起步、听指令变更车道、信号灯及学校区域控速、加减挡操作、最终靠边 ≤35cm 停稳拉手刹。',
    rulesSummary: [
      '闯红灯、学校区域超 30 km/h、靠边边距 >55cm：扣 100 分',
      '起步/变道/靠边未打转向灯或未满 2 秒变道：扣 10 分',
      '靠边停车边距 35~55cm 或未拉手刹/开双闪：扣 10 分',
    ],
    coachTip: '口诀：打灯至少等 2 秒再动方向！学校斑马线必降到 30 km/h 以下，终点靠边右打灯 [E] 慢蹭路缘至 ≤35cm，拉手刹 [Space] 开双闪 [X]。',
  },
];

export function getA2ExamLevel(id: A2ExamLevelId): A2ExamLevelDef {
  return A2_EXAM_LEVELS.find((l) => l.id === id) ?? A2_EXAM_LEVELS[0]!;
}
