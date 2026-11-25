import { MapManifest } from './types';
import { centralEuropeMap } from './maps/centralEurope';

/**
 * Central registry for modular EuroHaul Web map packs.
 * To add a new region/country, import its MapManifest and register it here.
 */
class MapRegistryImpl {
  private readonly maps = new Map<string, MapManifest>();

  constructor() {
    this.registerMap(centralEuropeMap);
  }

  public registerMap(manifest: MapManifest): void {
    this.maps.set(manifest.id, manifest);
  }

  public getMapById(id: string): MapManifest {
    return this.maps.get(id) ?? centralEuropeMap;
  }

  public getAllMaps(): MapManifest[] {
    return Array.from(this.maps.values());
  }
}

export const MapRegistry = new MapRegistryImpl();
