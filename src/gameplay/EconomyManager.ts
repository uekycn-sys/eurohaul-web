import { BuiltMap } from '../map/MapBuilder';
import { CityDefinition, CityDepot } from '../map/types';
import { FreightJob, NearbyInteraction, TrailerCargoType } from '../store/useGameStore';
import { NavigationSystem } from './NavigationSystem';

interface CargoTemplate {
  name: string;
  category: string;
  weightTons: number;
  fragile: boolean;
  urgent: boolean;
  rateMultiplier: number;
  containerColor: string;
  trailerType: TrailerCargoType;
}

const CARGO_POOL: CargoTemplate[] = [
  {
    name: '精密工业 CNC 机床',
    category: '重型机械',
    weightTons: 22,
    fragile: true,
    urgent: false,
    rateMultiplier: 1.32,
    containerColor: '#1e40af',
    trailerType: 'machinery',
  },
  {
    name: '医用冷链疫苗制剂',
    category: '医药冷链',
    weightTons: 9,
    fragile: true,
    urgent: true,
    rateMultiplier: 1.48,
    containerColor: '#f8fafc',
    trailerType: 'reefer',
  },
  {
    name: '巴伐利亚汽车动力总成',
    category: '汽车工业',
    weightTons: 17,
    fragile: false,
    urgent: false,
    rateMultiplier: 1.15,
    containerColor: '#b91c1c',
    trailerType: 'reefer',
  },
  {
    name: '风力发电机复合叶片',
    category: '新能源装备',
    weightTons: 24,
    fragile: true,
    urgent: true,
    rateMultiplier: 1.55,
    containerColor: '#047857',
    trailerType: 'machinery',
  },
  {
    name: '北海远洋标准集装箱',
    category: '海运联运',
    weightTons: 20,
    fragile: false,
    urgent: false,
    rateMultiplier: 1.18,
    containerColor: '#c2410c',
    trailerType: 'container',
  },
  {
    name: '蒂罗尔松木板材',
    category: '建材林木',
    weightTons: 23,
    fragile: false,
    urgent: false,
    rateMultiplier: 1.12,
    containerColor: '#78350f',
    trailerType: 'logs',
  },
  {
    name: '高纯度半导体晶圆设备',
    category: '精密电子',
    weightTons: 8,
    fragile: true,
    urgent: true,
    rateMultiplier: 1.52,
    containerColor: '#334155',
    trailerType: 'reefer',
  },
  {
    name: '黑森林有机谷物饲料',
    category: '农副食品',
    weightTons: 15,
    fragile: false,
    urgent: false,
    rateMultiplier: 1.0,
    containerColor: '#65a30d',
    trailerType: 'reefer',
  },
];

/**
 * Generates freight market contracts, tracks city presence, evaluates speed cameras,
 * and resolves depot/service-station interaction zones.
 */
export class EconomyManager {
  private readonly builtMap: BuiltMap;
  private readonly nav: NavigationSystem;
  private jobCounter = 100;

  constructor(builtMap: BuiltMap, nav: NavigationSystem) {
    this.builtMap = builtMap;
    this.nav = nav;
  }

  public generateJobs(originCityId?: string): FreightJob[] {
    const cities = this.builtMap.manifest.cities;
    if (cities.length < 2) return [];

    const jobs: FreightJob[] = [];
    const primaryOrigins = originCityId
      ? cities.filter((c) => c.id === originCityId)
      : cities;

    const orderedOrigins = [
      ...primaryOrigins,
      ...cities.filter((c) => c.id !== originCityId),
    ];

    for (const origCity of orderedOrigins) {
      const otherCities = cities.filter((c) => c.id !== origCity.id);
      for (const destCity of otherCities) {
        const origDepot = origCity.depots[jobs.length % origCity.depots.length]!;
        const destDepot = destCity.depots[(jobs.length + 1) % destCity.depots.length]!;
        const cargo = CARGO_POOL[this.jobCounter % CARGO_POOL.length]!;
        this.jobCounter += 1;

        const route = this.nav.computeRoute(
          origDepot.officePosition[0],
          origDepot.officePosition[2],
          destDepot.parkingBayPosition[0],
          destDepot.parkingBayPosition[2]
        );
        // Scale to realistic Euro Truck display kilometers
        const distanceKm = Math.max(1.2, Number((route.totalDistanceMeters / 1000).toFixed(1)));
        const basePayEur = Math.round(
          (950 + distanceKm * 780) * cargo.rateMultiplier * (1 + cargo.weightTons * 0.012)
        );
        const xpReward = Math.round(120 + distanceKm * 85 * cargo.rateMultiplier);
        const timeLimitMin = Math.max(6, Math.round(distanceKm * 2.8 + (cargo.urgent ? 2 : 5)));

        jobs.push({
          id: `JOB-${this.jobCounter}`,
          cargoName: cargo.name,
          cargoCategory: cargo.category,
          weightTons: cargo.weightTons,
          fragile: cargo.fragile,
          urgent: cargo.urgent,
          originCityId: origCity.id,
          originCityName: origCity.name,
          originDepotId: origDepot.id,
          originDepotName: origDepot.name,
          destinationCityId: destCity.id,
          destinationCityName: destCity.name,
          destinationDepotId: destDepot.id,
          destinationDepotName: destDepot.name,
          distanceKm,
          basePayEur,
          xpReward,
          timeLimitMin,
          trailerColor: cargo.containerColor,
          trailerType: cargo.trailerType,
        });
        if (jobs.length >= 8) return jobs;
      }
    }

    return jobs;
  }

  public detectCurrentCity(x: number, z: number): CityDefinition | null {
    for (const city of this.builtMap.manifest.cities) {
      if (Math.hypot(x - city.position[0], z - city.position[2]) <= city.radius) {
        return city;
      }
    }
    return null;
  }

  public findDepotById(depotId: string): { city: CityDefinition; depot: CityDepot } | null {
    for (const city of this.builtMap.manifest.cities) {
      for (const depot of city.depots) {
        if (depot.id === depotId) {
          return { city, depot };
        }
      }
    }
    return null;
  }

  public checkSpeedCameras(x: number, z: number, speedKmh: number, nowMs: number): number | null {
    for (const cam of this.builtMap.speedCameras) {
      if (nowMs - cam.lastTriggeredMs < 15000) continue;
      const dist = Math.hypot(x - cam.x, z - cam.z);
      if (dist < 14 && speedKmh > cam.def.speedLimitKmh + 6) {
        cam.lastTriggeredMs = nowMs;
        const excess = speedKmh - cam.def.speedLimitKmh;
        return excess > 22 ? 550 : 320;
      }
    }
    return null;
  }

  public detectNearbyInteraction(
    x: number,
    z: number,
    activeDestinationDepotId: string | null
  ): NearbyInteraction | null {
    for (const city of this.builtMap.manifest.cities) {
      for (const st of city.stations) {
        if (Math.hypot(x - st.position[0], z - st.position[2]) <= st.radius) {
          return {
            kind: st.kind,
            label: st.name,
            sublabel:
              st.kind === 'fuel'
                ? '按 Enter 加满柴油 (€1.65/L) · 按 R 休息 8 小时'
                : '按 Enter 加油与整修 · 按 R 休息 8 小时',
            cityId: city.id,
          };
        }
      }

      for (const depot of city.depots) {
        if (
          activeDestinationDepotId === depot.id &&
          Math.hypot(x - depot.parkingBayPosition[0], z - depot.parkingBayPosition[2]) <= 34
        ) {
          return {
            kind: 'delivery_bay',
            label: `${depot.name} · 卸货区`,
            sublabel: '将半挂车倒车停入绿色发光框可获 +30% 技巧奖金，或按 Enter 快速停靠',
            depotId: depot.id,
            cityId: city.id,
          };
        }

        if (Math.hypot(x - depot.officePosition[0], z - depot.officePosition[2]) <= 15) {
          return {
            kind: 'depot_job',
            label: depot.name,
            sublabel: '按 Enter 打开货运市场接单 / 查看订单',
            depotId: depot.id,
            cityId: city.id,
          };
        }
      }
    }
    return null;
  }
}
