# EuroHaul Web 🚛

致敬《欧洲卡车模拟 2 (ETS2)》的浏览器端 3D 重卡驾驶与货运模拟游戏。基于 **Three.js + React 18 + TypeScript + Zustand + Tailwind CSS** 从零构建，**100% 程序化纹理与 Web Audio 实时合成声浪**，无需任何外部模型或贴图文件，开箱即用并针对核显笔记本 60FPS 优化。

---

## 核心特性

- **专业卡车铰接物理**：基于轴距的阿克曼转向（速度自适应转向衰减与自动回正）、第五轮鞍座半挂车铰接演化（支持倒车反打与折头/Jackknife 物理限位）、12 档自动/序列手动变速箱、定速巡航、液力缓速器、坡道重力与驾驶室弹簧阻尼动态。
- **零外部资源程序化管线**：沥青路噪/磨损粗糙度、集装箱涂装、欧式限速路标、仪表台均由 `CanvasTexture` 生成；柴油机低频轰鸣、涡轮哨音、气刹泄压、转向灯继电器与双音气喇叭由 `Web Audio API` 实时合成。
- **中欧黄金货运走廊 (`centralEurope`)**：连接慕尼黑物流枢纽、汉堡北海港、法兰克福中央区、因斯布鲁克阿尔卑斯山谷（+40m 海拔攀爬），涵盖四车道高速、盘山国道、区间测速抓拍、加油站与装卸货场。
- **完整货运经济循环**：货运市场接单（货重/易碎/加急）、Dijkstra 最短路径实时旋转小地图（Route Advisor）、双侧实时电子后视镜（可一键开关）、手动倒车入库 +30% 技巧奖金与车库引擎/油箱/车漆改装（`localStorage` 持久化存档）。
- **低配硬件友好**：护栏、路灯与数百棵生态群系树木全部采用 `THREE.InstancedMesh` 合批渲染，AI 车流仅占 3 个 Draw Call，并提供 低/中/高 三档画质预设。

---

## 按键操作表

| 按键 | 功能 |
| :--- | :--- |
| `W` / `S` 或 `↑` / `↓` | 油门 / 刹车（自动档下停稳继续按 `S` 自动挂倒档） |
| `A` / `D` 或 `←` / `→` | 渐进转向（松手自动平滑回正） |
| `Space` | 驻车手刹启闭（起步前请先按 `Space` 松开手刹） |
| `Q` / `E` | 左 / 右转向灯（转弯回正后自动复位） |
| `F` | 双闪警示灯 |
| `L` | 车灯循环（关闭 → 近光/示廓 → 远光灯） |
| `C` | 定速巡航（车速 ≥ 25 km/h 时激活/取消） |
| `B` | 液力缓速器档位循环（0 → 1 → 2 → 3） |
| `T` | 挂接 / 摘除半挂车 |
| `H` | 按住鸣响重卡气喇叭 |
| `Shift` / `Ctrl` | 手动升档 / 降档（可在仪表盘点击 `AT/MT` 切换模式） |
| `1` / `2` / `3` / `4` | 切换视角（驾驶室第一人称 / 追尾 / 倒车侧视 / 电影环绕） |
| `M` | 打开 / 关闭欧陆全图 |
| `Tab` | 切换右下角路线顾问（Route Advisor）标签页 |
| `Enter` | 区域交互（接单 / 加油 / 修车 / 交货） |
| `Esc` | 关闭当前弹窗或返回主菜单 |

---

## 本地运行与构建

```bash
npm install
npm run dev
```

执行类型检查与生产构建：

```bash
npm run build
```

---

## 部署到 GitHub Pages

工程已内置 `vite.config.ts`（`base: './'` 相对路径资源配置）及 `.github/workflows/deploy.yml`：

1. 将代码推送到 GitHub 仓库的 `main` 分支。
2. 打开仓库的 **Settings → Pages**。
3. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
4. 每次推送到 `main` 后，Workflow 会自动执行 `npm ci && npm run build` 并将 `dist/` 发布至 GitHub Pages。

---

## 地图扩展入口

地图数据与构建逻辑完全解耦：
- 数据契约定义：[src/map/types.ts](src/map/types.ts)
- 地图注册中心：[src/map/MapRegistry.ts](src/map/MapRegistry.ts)
- 详细扩展指南：[docs/MAP_EXTENSION_GUIDE.md](docs/MAP_EXTENSION_GUIDE.md)
