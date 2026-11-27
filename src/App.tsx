import { useCallback, useEffect, useRef } from 'react';
import { GameEngine, MobileActionType } from './core/GameEngine';
import { useGameStore } from './store/useGameStore';
import { MapRegistry } from './map/MapRegistry';
import { A2ExamLevelId } from './exam/types';
import { MainMenu } from './ui/MainMenu';
import { HUD } from './ui/HUD';
import { VirtualMirrors } from './ui/VirtualMirrors';
import { JobMarketModal } from './ui/JobMarketModal';
import { GarageModal } from './ui/GarageModal';
import { MobileControls } from './ui/MobileControls';

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const gamePhase = useGameStore((s) => s.gamePhase);
  const gameMode = useGameStore((s) => s.gameMode);
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

  const handleStartCareer = useCallback(() => {
    if (useGameStore.getState().gameMode === 'a2_exam') {
      engineRef.current?.exitA2ExamToCareer(false);
    }
    useGameStore.getState().setGamePhase('playing');
  }, []);

  const handleEnterA2Exam = useCallback((levelId: A2ExamLevelId) => {
    engineRef.current?.enterA2Exam(levelId);
  }, []);

  const handleBeginExam = useCallback(() => {
    engineRef.current?.beginActiveExamRun();
  }, []);

  const handleRestartExam = useCallback(() => {
    engineRef.current?.restartA2Exam();
  }, []);

  const handleExitExamToCareer = useCallback(() => {
    engineRef.current?.exitA2ExamToCareer(true);
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

  const handleStationRest = useCallback(() => {
    engineRef.current?.handleStationRest();
  }, []);

  const handleRoadsideRescue = useCallback(() => {
    engineRef.current?.performRoadsideRescue();
  }, []);

  const getNearestStation = useCallback(() => {
    return engineRef.current?.getNearestServiceStation() ?? null;
  }, []);

  const getRoutePoints = useCallback(() => {
    return engineRef.current?.getActiveRoutePoints() ?? [];
  }, []);

  const handleTouchSteer = useCallback((steerNorm: number | null) => {
    engineRef.current?.setTouchSteer(steerNorm);
  }, []);

  const handleTouchThrottle = useCallback((val: number) => {
    engineRef.current?.setTouchThrottle(val);
  }, []);

  const handleTouchBrake = useCallback((val: number) => {
    engineRef.current?.setTouchBrake(val);
  }, []);

  const handleTouchHorn = useCallback((active: boolean) => {
    engineRef.current?.setTouchHorn(active);
  }, []);

  const handleMobileAction = useCallback((action: MobileActionType) => {
    engineRef.current?.triggerMobileAction(action);
  }, []);

  const mapManifest = MapRegistry.getMapById(selectedMapId);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      {gamePhase === 'menu' ? (
        <MainMenu
          onSelectMap={handleSelectMap}
          onStartCareer={handleStartCareer}
          onEnterA2Exam={handleEnterA2Exam}
        />
      ) : (
        <>
          <VirtualMirrors />
          <HUD
            mapManifest={mapManifest}
            getRoutePoints={getRoutePoints}
            onRefreshJobs={handleRefreshJobs}
            onCompleteDelivery={handleCompleteDelivery}
            onSetTimeOfDay={handleSetTimeOfDay}
            onRest={handleStationRest}
            onRoadsideRescue={handleRoadsideRescue}
            getNearestStation={getNearestStation}
            onBeginExam={handleBeginExam}
            onRestartExam={handleRestartExam}
            onSelectExamLevel={handleEnterA2Exam}
            onExitExamToCareer={handleExitExamToCareer}
          />
          <MobileControls
            onTouchSteer={handleTouchSteer}
            onTouchThrottle={handleTouchThrottle}
            onTouchBrake={handleTouchBrake}
            onTouchHorn={handleTouchHorn}
            onMobileAction={handleMobileAction}
          />
          {gameMode === 'career' && (
            <>
              <JobMarketModal onRefreshJobs={handleRefreshJobs} />
              <GarageModal />
            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;
