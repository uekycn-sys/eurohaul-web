/**
 * @fileoverview Core extensible map data contracts for EuroHaul Web.
 * Any new country, corridor, or DLC-style expansion only needs to export
 * a valid MapManifest object and register it in MapRegistry.
 */

export type Vec3Tuple = [number, number, number];

export type BiomeType =
  | 'highway'
  | 'alpine'
  | 'countryside'
  | 'industrial'
  | 'coastal';

export type NodeKind =
  | 'intersection'
  | 'highway_ramp'
  | 'city_entry'
  | 'roundabout';

export type RoadClass = 'motorway' | 'national' | 'urban';

export interface RoadNode {
  /** Unique node identifier within the map manifest */
  id: string;
  /** World space coordinate [x, y (elevation), z] in meters */
  position: Vec3Tuple;
  /** Topological role of this junction */
  kind: NodeKind;
  /** Optional display name for navigation or debug inspection */
  label?: string;
  /** Whether AI traffic and player violations observe signalized intersection rules */
  trafficLight?: boolean;
}

export interface RoadSegment {
  /** Unique road segment identifier */
  id: string;
  /** Origin RoadNode ID */
  fromNodeId: string;
  /** Destination RoadNode ID */
  toNodeId: string;
  /**
   * Optional intermediate world-space control points between fromNode and toNode.
   * MapBuilder builds a smooth Catmull-Rom spline through [fromNode, ...controlPoints, toNode].
   */
  controlPoints?: Vec3Tuple[];
  /** Total bidirectional lane count (e.g., 2 for national road, 4 for motorway) */
  lanes: number;
  /** Total paved asphalt width in meters (excluding shoulders/guardrails) */
  width: number;
  /** Posted speed limit in km/h */
  speedLimitKmh: number;
  /** Surrounding visual biome used for roadside foliage, terrain tint, and props */
  biome: BiomeType;
  /** Road hierarchy class influencing lane markings and AI speed profiles */
  roadClass: RoadClass;
  /** Whether procedural street light poles are placed along this segment */
  hasStreetLights: boolean;
  /** Whether metallic safety guardrails are generated on shoulders */
  hasGuardrails: boolean;
  /** Optional acoustic noise barriers along suburban/motorway stretches */
  hasNoiseBarrier?: boolean;
  /** If true, traffic flows only from fromNode -> toNode */
  oneWay?: boolean;
}

export type DepotType = 'logistics' | 'port' | 'factory' | 'farm' | 'mine';

export interface CityDepot {
  id: string;
  name: string;
  type: DepotType;
  /** World center of the freight yard */
  position: Vec3Tuple;
  /** Orientation of the yard in radians (0 = facing +Z) */
  headingRad: number;
  /** World-space position of the illuminated delivery/parking bay */
  parkingBayPosition: Vec3Tuple;
  /** Target trailer/truck heading in radians when parked inside the bay */
  parkingBayHeadingRad: number;
  /** Trigger zone position for picking up freight or opening the job board */
  officePosition: Vec3Tuple;
}

export type StationKind = 'fuel' | 'repair' | 'service_hub';

export interface ServiceStation {
  id: string;
  name: string;
  kind: StationKind;
  position: Vec3Tuple;
  headingRad: number;
  /** Interaction radius in meters */
  radius: number;
}

export type CityRegionStyle =
  | 'german_industrial'
  | 'alpine_wood'
  | 'coastal_port'
  | 'countryside_farm';

export interface CityDefinition {
  id: string;
  name: string;
  country: string;
  economyTag: string;
  /** Optional architectural/atmosphere theme for city depots and props */
  regionStyle?: CityRegionStyle;
  /** Approximate city center coordinate */
  position: Vec3Tuple;
  /** Radius in meters used for city zone detection and minimap labels */
  radius: number;
  /** Primary road node connecting this city to the highway/national network */
  entryNodeId: string;
  depots: CityDepot[];
  stations: ServiceStation[];
}

export type LandmarkKind =
  | 'wind_turbine'
  | 'bridge_pylon'
  | 'toll_booth'
  | 'mountain_peak'
  | 'lake'
  | 'warehouse_block'
  | 'port_crane'
  | 'power_pylon'
  | 'rural_barn';

export interface HighwayGantryDef {
  id: string;
  segmentId: string;
  /** Normalized spline position [0..1] along the segment */
  t: number;
  routeCode: string;
  destinationLabel: string;
  distanceLabel: string;
  style: 'motorway' | 'national';
}

export interface LandmarkDefinition {
  id: string;
  kind: LandmarkKind;
  position: Vec3Tuple;
  rotationY?: number;
  scale?: Vec3Tuple;
  color?: string;
  label?: string;
}

export interface SpeedCameraDef {
  id: string;
  segmentId: string;
  /** Normalized spline position [0..1] along the segment */
  t: number;
  speedLimitKmh: number;
}

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapManifest {
  id: string;
  name: string;
  subtitle: string;
  version: string;
  region: string;
  description: string;
  recommendedDurationMin: number;
  defaultSpawnPosition: Vec3Tuple;
  defaultSpawnHeadingRad: number;
  worldBounds: MapBounds;
  nodes: RoadNode[];
  segments: RoadSegment[];
  cities: CityDefinition[];
  landmarks: LandmarkDefinition[];
  speedCameras: SpeedCameraDef[];
  /** Optional overhead highway/national route gantry signs */
  gantries?: HighwayGantryDef[];
}
