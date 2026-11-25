import { useCallback, useEffect, useRef } from 'react';
import { GameEngine } from './core/GameEngine';
import { useGameStore } from './store/useGameStore';
import { MapRegistry } from './map/MapRegistry';
import { MainMenu } from './ui/MainMenu';
import { HUD } from './ui/HUD';
import { VirtualMirrors } from './ui/VirtualMirrors';
import { JobMarketModal } from './ui/JobMarketModal';
import { GarageModal } from './ui/GarageModal';

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const gamePhase = useGameStore((s) => s.gamePhase);
  const selectedMapId = useGameStore((s) => s.selectedMapId);
  const qualityPreset = useGameStore((s) => s.qualityPreset);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const engine = new GameEngine(el);
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.applyQualityPreset(qualityPreset);
  }, [qualityPreset]);

  const handleSelectMap = useCallback((mapId: string) => {
    engineRef.current?.loadMap(mapId);
  }, []);

  const handleRefreshJobs = useCallback(() => {
    engineRef.current?.refreshJobs();
  }, []);

  const handleCompleteDelivery = useCallback((manual: boolean) => {
    engineRef.current?.completeDelivery(manual);
  }, []);

  const handleSetTimeOfDay = useCallback((hours: number) => {
    engineRef.current?.setTimeOfDay(hours);
  }, []);

  const getRoutePoints = useCallback(() => {
    return engineRef.current?.getActiveRoutePoints() ?? [];
  }, []);

  const mapManifest = MapRegistry.getMapById(selectedMapId);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      {gamePhase === 'menu' ? (
        <MainMenu onSelectMap={handleSelectMap} />
      ) : (
        <>
          <VirtualMirrors />
          <HUD
            mapManifest={mapManifest}
            getRoutePoints={getRoutePoints}
            onRefreshJobs={handleRefreshJobs}
            onCompleteDelivery={handleCompleteDelivery}
            onSetTimeOfDay={handleSetTimeOfDay}
          />
          <JobMarketModal onRefreshJobs={handleRefreshJobs} />
          <GarageModal />
        </>
      )}
    </div>
  );
}

export default App;
