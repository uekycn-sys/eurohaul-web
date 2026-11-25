# EuroHaul Web 地图扩展开发指南

EuroHaul Web 采用 **“数据契约与 3D 编译引擎彻底分离”** 的架构。新增一个国家、跨海大桥走廊或 DLC 级别地图包，**无需修改任何渲染、物理、寻路或 UI 代码**，只需编写一份符合 `MapManifest` 规范的数据文件并在 `MapRegistry` 中注册即可。

---

## 1. 核心架构文件

| 文件路径 | 职责 |
| :--- | :--- |
| `src/map/types.ts` | 定义 `MapManifest`、`RoadNode`、`RoadSegment`、`CityDefinition`、`CityDepot`、`ServiceStation`、`LandmarkDefinition` 等严格 TypeScript 契约 |
| `src/map/maps/centralEurope.ts` | 首发地图《中欧货运走廊》参考实现 |
| `src/map/MapBuilder.ts` | 读取任意 `MapManifest`，自动编译连续带坡度路面、交叉口垫片、护栏/路灯/生态植被 `InstancedMesh`、地形高度场与碰撞体 |
| `src/map/MapRegistry.ts` | 地图注册中心，主菜单会自动枚举其中注册的所有地图 |

---

## 2. 三步添加新地图

### 第一步：创建地图数据文件
在 `src/map/maps/` 下新建文件，例如 `src/map/maps/scandinavia.ts`：

```ts
import { MapManifest } from '../types';

export const scandinaviaMap: MapManifest = {
  id: 'scandinavia',
  name: '北欧峡湾专线 (Scandinavia)',
  subtitle: '奥斯陆 · 哥德堡 · 卑尔根',
  version: '1.0.0',
  region: 'Nordics',
  description: '沿北欧海岸线与跨海大桥穿梭的高纬度货运走廊。',
  recommendedDurationMin: 12,
  defaultSpawnPosition: [-600, 0, 400],
  defaultSpawnHeadingRad: Math.PI / 2,
  worldBounds: { minX: -1600, maxX: 1600, minZ: -1600, maxZ: 1600 },
  nodes: [
    { id: 'oslo_yard', position: [-650, 0, 400], kind: 'city_entry', label: '奥斯陆港区' },
    { id: 'oslo_jct', position: [-420, 0, 400], kind: 'highway_ramp', label: 'E6 互通' },
    // ...更多节点
  ],
  segments: [
    {
      id: 'seg_oslo_spur',
      fromNodeId: 'oslo_yard',
      toNodeId: 'oslo_jct',
      lanes: 2,
      width: 13,
      speedLimitKmh: 50,
      biome: 'coastal',
      roadClass: 'urban',
      hasStreetLights: true,
      hasGuardrails: false,
    },
    // ...更多路段
  ],
  cities: [
    // 至少配置 2 座城市及各自的 depots / stations 才能正常生成货运市场订单
  ],
  landmarks: [],
  speedCameras: [],
};
```

### 第二步：在 `MapRegistry.ts` 注册
打开 `src/map/MapRegistry.ts`，导入并注册新地图：

```ts
import { scandinaviaMap } from './maps/scandinavia';

constructor() {
  this.registerMap(centralEuropeMap);
  this.registerMap(scandinaviaMap);
}
```

### 第三步：类型校验与构建验证
运行 `npm run build` 确保无类型错误，主菜单“选择货运版图”卡片会自动列出新地图。

---

## 3. 设计规范与避坑指南

1. **坐标与朝向约定**：
   - 单位为米 (`1 unit = 1m`)，`Y` 轴为海拔高度。
   - `headingRad = 0` 表示车头朝向 `+Z`，`Math.PI / 2` 表示朝向 `+X`。
2. **城市坪台与货场对齐**：
   - `MapBuilder` 会在每座 `CityDefinition.position` 半径 `165m` 范围内自动铺设平坦的物流园区硬化地面（高度锁定为 `city.position[1]`）。
   - 请确保城市下属所有 `depots`（包含 `parkingBayPosition` 和 `officePosition`）以及 `stations` 距离 `city.position` 不超过 `140m`，且高度 `Y` 与 `city.position[1]` 一致。
3. **平滑坡道与山路**：
   - `RoadSegment.controlPoints` 之间会通过向心 Catmull-Rom 样条 (`centripetal`) 插值。
   - 爬坡路段的相邻控制点高度差建议控制在 `10m / 150m` 以内（约 6%~7% 欧洲公路坡度上限），以保证重货（24t）爬坡体验真实而不卡顿。
4. **生态群系 (`biome`) 与区域风格 (`regionStyle`)**：
   - `RoadSegment.biome` 可选 `'highway' | 'alpine' | 'countryside' | 'industrial' | 'coastal'`，影响沿途自动生成的云杉/橡树/灌木比例。
   - `CityDefinition.regionStyle`（可选）：`'german_industrial' | 'alpine_wood' | 'coastal_port' | 'countryside_farm'`，用于定制场站建筑与围栏外观。
5. **可选高速设施扩展**：
   - `RoadSegment.hasNoiseBarrier?: boolean`：开启高速隔音墙批处理。
   - `MapManifest.gantries?: HighwayGantryDef[]`：在指定路段跨越车道生成欧式蓝底/黄底龙门架指路牌。
   - 远郊与公路中段可通过 `CityDefinition.stations` 布置高速服务区加油站（`MapBuilder` 会自动为其生成独立硬化坪台），`landmarks` 支持 `'power_pylon'` 与 `'rural_barn'`。
6. **寻路连通性**：
   - 确保每座城市的 `entryNodeId` 通过 `segments` 与主路网相连，且全图构成连通图，否则 `NavigationSystem`（Dijkstra）与 `EconomyManager` 无法规划跨城航线。
