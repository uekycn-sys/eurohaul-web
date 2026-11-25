import * as THREE from 'three';
import {
  QUALITY_SPECS,
  QualityPreset,
  getMaxFuelLiters,
  useGameStore,
} from '../store/useGameStore';
import { ProceduralTextures } from '../graphics/ProceduralTextures';
import { EnvironmentSystem } from '../graphics/EnvironmentSystem';
import { MapRegistry } from '../map/MapRegistry';
import { BuiltMap, MapBuilder } from '../map/MapBuilder';
import { TruckMeshBuilder, TruckVisualRefs } from '../graphics/TruckMeshBuilder';
import { TruckPhysics } from '../physics/TruckPhysics';
import { InputManager } from './InputManager';
import { CameraRig } from '../graphics/CameraRig';
import { AudioSynthesizer } from './AudioSynthesizer';
import { TrafficSystem } from '../physics/TrafficSystem';
import { ActiveRoute, NavigationSystem, RoutePoint } from '../gameplay/NavigationSystem';
import { EconomyManager } from '../gameplay/EconomyManager';
import { ParkingValidator } from '../gameplay/ParkingValidator';
import { MapManifest } from '../map/types';

export type MobileActionType =
  | 'camera'
  | 'lights'
  | 'left_blinker'
  | 'right_blinker'
  | 'parking_brake'
  | 'trailer'
  | 'interact';

/**
 * Core WebGL / Fixed-timestep simulation engine.
 * Owns 3D rendering, physics, AI traffic, audio synthesis, navigation, and economy checks.
 * Supports 4-tier hardware scaling, cached frame-skipped mirrors, and visibility lifecycle protection.
 */
export class GameEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly leftMirrorCam: THREE.PerspectiveCamera;
  private readonly rightMirrorCam: THREE.PerspectiveCamera;

  // Offscreen render targets & orthographic blit quad for zero-flicker frame-skipped mirrors
  private readonly mirrorRtLeft: THREE.WebGLRenderTarget;
  private readonly mirrorRtRight: THREE.WebGLRenderTarget;
  private readonly mirrorBlitScene: THREE.Scene;
  private readonly mirrorBlitCam: THREE.OrthographicCamera;
  private readonly mirrorBlitMat: THREE.MeshBasicMaterial;
  private mirrorUpdateInterval = 2;
  private frameIndex = 0;

  private readonly textures: ProceduralTextures;
  private readonly env: EnvironmentSystem;
  private readonly mapBuilder: MapBuilder;
  private builtMap: BuiltMap;

  private readonly truckMeshBuilder: TruckMeshBuilder;
  private readonly truckVisuals: TruckVisualRefs;
  private readonly physics: TruckPhysics;
  private readonly input: InputManager;
  private readonly cameraRig: CameraRig;
  private readonly audio: AudioSynthesizer;

  private traffic: TrafficSystem;
  private nav: NavigationSystem;
  private economy: EconomyManager;
  private readonly parkingValidator = new ParkingValidator();

  private activeRoute: ActiveRoute | null = null;
  private trackedJobId: string | null = null;
  private manualParkHoldSec = 0;

  private rafId: number | null = null;
  private isPausedHidden = false;
  private lastTimeMs = 0;
  private accumulatorSec = 0;
  private readonly fixedDtSec = 1 / 60;
  private elapsedSec = 0;

  private telemetryAccumSec = 0;
  private readonly telemetryIntervalSec = 1 / 18;
  private fpsFrames = 0;
  private fpsAccumSec = 0;
  private currentFps = 60;

  private lastPaintHex = '';
  private viewportWidth = 1280;
  private viewportHeight = 720;
  private readonly tempVecA = new THREE.Vector3();
  private readonly tempVecB = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.container = container;
    const store = useGameStore.getState();

    // Disable hardware MSAA on touch/mobile devices to save mobile tile-GPU bandwidth
    this.renderer = new THREE.WebGLRenderer({
      antialias: !store.isTouchDevice,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(58, width / height, 0.25, 1600);
    this.leftMirrorCam = new THREE.PerspectiveCamera(46, 196 / 108, 0.4, 240);
    this.rightMirrorCam = new THREE.PerspectiveCamera(46, 196 / 108, 0.4, 240);

    this.mirrorRtLeft = new THREE.WebGLRenderTarget(196, 108, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.mirrorRtRight = new THREE.WebGLRenderTarget(196, 108, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.mirrorBlitScene = new THREE.Scene();
    this.mirrorBlitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mirrorBlitMat = new THREE.MeshBasicMaterial({
      map: this.mirrorRtLeft.texture,
      depthTest: false,
      depthWrite: false,
    });
    const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mirrorBlitMat);
    this.mirrorBlitScene.add(blitQuad);

    this.textures = new ProceduralTextures();
    this.textures.configureQuality(store.qualityPreset);
    this.env = new EnvironmentSystem(this.scene, this.renderer);
    this.mapBuilder = new MapBuilder(this.textures, this.env);

    const manifest = MapRegistry.getMapById(store.selectedMapId);
    this.builtMap = this.mapBuilder.build(manifest);
    this.scene.add(this.builtMap.root);

    this.truckMeshBuilder = new TruckMeshBuilder(this.textures);
    this.lastPaintHex = store.paintHex;
    this.truckVisuals = this.truckMeshBuilder.build(store.paintHex);
    this.scene.add(this.truckVisuals.tractorRoot);
    this.scene.add(this.truckVisuals.trailerRoot);

    this.physics = new TruckPhysics();
    this.physics.resetToSpawn(manifest.defaultSpawnPosition, manifest.defaultSpawnHeadingRad);

    const initialSpec = QUALITY_SPECS[store.qualityPreset];
    this.traffic = new TrafficSystem(this.builtMap, initialSpec.maxTraffic, 28);
    this.nav = new NavigationSystem(this.builtMap);
    this.economy = new EconomyManager(this.builtMap, this.nav);

    store.setAvailableJobs(this.economy.generateJobs('munich'));

    this.audio = new AudioSynthesizer();
    this.audio.setSettings(store.audioEnabled, store.masterVolume);

    this.cameraRig = new CameraRig(this.camera, this.renderer.domElement);

    this.input = new InputManager({
      onToggleLeftBlinker: () => this.physics.toggleLeftBlinker(),
      onToggleRightBlinker: () => this.physics.toggleRightBlinker(),
      onToggleHazards: () => this.physics.toggleHazards(),
      onCycleHeadlights: () => this.physics.cycleHeadlights(),
      onToggleParkingBrake: () => this.physics.toggleParkingBrake(),
      onToggleCruiseControl: () =>
        this.physics.toggleCruiseControl(useGameStore.getState().speedLimiterEnabled),
      onCycleRetarder: () => this.physics.cycleRetarder(),
      onToggleTrailer: () => this.handleToggleTrailer(),
      onShiftUp: () => this.physics.shiftUp(useGameStore.getState().transmissionMode),
      onShiftDown: () => this.physics.shiftDown(useGameStore.getState().transmissionMode),
      onCameraMode: (mode) => useGameStore.getState().setCameraMode(mode),
      onCycleCamera: () => {
        const s = useGameStore.getState();
        s.setCameraMode(((s.cameraMode % 4) + 1) as 1 | 2 | 3 | 4);
      },
      onRest: () => this.handleStationRest(),
      onToggleMap: () => {
        const s = useGameStore.getState();
        if (s.gamePhase !== 'playing') return;
        s.setActiveModal(s.activeModal === 'map' ? 'none' : 'map');
      },
      onCycleAdvisorTab: () => {
        const s = useGameStore.getState();
        const order = ['nav', 'cargo', 'truck', 'controls'] as const;
        const idx = order.indexOf(s.advisorTab);
        s.setAdvisorTab(order[(idx + 1) % order.length]!);
      },
      onInteract: () => this.handleZoneInteract(),
      onEscape: () => {
        const s = useGameStore.getState();
        if (s.activeModal !== 'none') {
          s.setActiveModal('none');
        } else if (s.gamePhase === 'playing') {
          s.setGamePhase('menu');
        }
      },
    });

    this.physics.syncVisuals(this.truckVisuals, this.input, this.env.nightFactor);

    window.addEventListener('keydown', this.unlockAudioOnce);
    window.addEventListener('pointerdown', this.unlockAudioOnce);
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.applyQualityPreset(store.qualityPreset);
    this.handleResize();
  }

  private readonly unlockAudioOnce = (): void => {
    this.audio.unlock();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.isPausedHidden = true;
      this.accumulatorSec = 0;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.audio.suspend();
    } else {
      this.isPausedHidden = false;
      this.audio.resume();
      this.lastTimeMs = performance.now();
      if (this.rafId === null) {
        this.rafId = requestAnimationFrame(this.loop);
      }
    }
  };

  private handleToggleTrailer(): void {
    const res = this.physics.tryToggleTrailer();
    if (res.changed) {
      this.audio.playAirBrake();
      useGameStore
        .getState()
        .pushNotification(
          'info',
          res.attached ? '半挂车已挂接' : '半挂车已摘除',
          res.attached ? '气路与第五轮锁止完成' : '支腿已放下，可单独驾驶牵引车'
        );
    } else if (res.reason) {
      useGameStore.getState().pushNotification('warning', '操作受限', res.reason);
    }
  }

  public setTouchSteer(steerNorm: number | null): void {
    this.input.setTouchSteer(steerNorm);
  }

  public setTouchThrottle(val: number): void {
    this.input.setTouchThrottle(val);
  }

  public setTouchBrake(val: number): void {
    this.input.setTouchBrake(val);
  }

  public setTouchHorn(active: boolean): void {
    this.input.setTouchHorn(active);
  }

  public triggerMobileAction(action: MobileActionType): void {
    this.audio.unlock();
    const s = useGameStore.getState();
    switch (action) {
      case 'camera': {
        const nextMode = ((s.cameraMode % 4) + 1) as 1 | 2 | 3 | 4;
        s.setCameraMode(nextMode);
        break;
      }
      case 'lights':
        this.physics.cycleHeadlights();
        break;
      case 'left_blinker':
        this.physics.toggleLeftBlinker();
        break;
      case 'right_blinker':
        this.physics.toggleRightBlinker();
        break;
      case 'parking_brake':
        this.physics.toggleParkingBrake();
        break;
      case 'trailer':
        this.handleToggleTrailer();
        break;
      case 'interact':
        this.handleZoneInteract();
        break;
    }
  }

  public getMapManifest(): MapManifest {
    return this.builtMap.manifest;
  }

  public getActiveRoutePoints(): RoutePoint[] {
    return this.activeRoute?.points ?? [];
  }

  public refreshJobs(originCityId?: string): void {
    const city = originCityId ?? this.economy.detectCurrentCity(this.physics.x, this.physics.z)?.id;
    useGameStore.getState().setAvailableJobs(this.economy.generateJobs(city));
  }

  public completeDelivery(manualParking: boolean): void {
    const res = useGameStore.getState().completeDelivery(manualParking);
    if (res) {
      this.audio.playSuccess();
      this.builtMap.highlightDestinationDepot(null);
      this.activeRoute = null;
      this.trackedJobId = null;
      this.manualParkHoldSec = 0;
    }
  }

  public setTimeOfDay(hours: number): void {
    this.env.timeOfDayHours = ((hours % 24) + 24) % 24;
  }

  private handleZoneInteract(): void {
    const s = useGameStore.getState();
    const inter = s.nearbyInteraction;
    if (!inter) return;

    if (inter.kind === 'depot_job') {
      this.refreshJobs(inter.cityId);
      s.setActiveModal('jobs');
    } else if (inter.kind === 'fuel') {
      s.refuelFull();
      this.audio.playAirBrake();
    } else if (inter.kind === 'repair') {
      s.repairTruckFull();
      this.audio.playSuccess();
    } else if (inter.kind === 'service_hub') {
      s.refuelFull();
      s.repairTruckFull();
      this.audio.playSuccess();
    } else if (inter.kind === 'delivery_bay') {
      const manual = s.parkingGuide.readyToDeliver;
      this.completeDelivery(manual);
    }
  }

  public handleStationRest(): void {
    const s = useGameStore.getState();
    const inter = s.nearbyInteraction;
    if (!inter || (inter.kind !== 'fuel' && inter.kind !== 'repair' && inter.kind !== 'service_hub')) {
      return;
    }
    if (Math.abs(this.physics.speedMs) > 1.2) {
      s.pushNotification('warning', '请先刹停车辆', '服务区停车后方可休息 8 小时');
      return;
    }
    this.env.timeOfDayHours = (this.env.timeOfDayHours + 8) % 24;
    this.audio.playAirBrake();
    s.pushNotification('info', '服务区休息完成 (+8 小时)', '精力已恢复，注意随时关注昼夜灯光变化');
  }

  public loadMap(mapId: string): void {
    const manifest = MapRegistry.getMapById(mapId);
    const preset = useGameStore.getState().qualityPreset;
    const spec = QUALITY_SPECS[preset];
    this.traffic.dispose();
    this.scene.remove(this.builtMap.root);
    this.builtMap.dispose();

    this.builtMap = this.mapBuilder.build(manifest);
    this.builtMap.setFoliageDensity(spec.foliageDensity, preset === 'mobile_fast');
    this.builtMap.setPbrDetailEnabled(preset !== 'mobile_fast');
    this.scene.add(this.builtMap.root);

    this.traffic = new TrafficSystem(this.builtMap, spec.maxTraffic, 28);
    this.nav = new NavigationSystem(this.builtMap);
    this.economy = new EconomyManager(this.builtMap, this.nav);
    this.physics.resetToSpawn(manifest.defaultSpawnPosition, manifest.defaultSpawnHeadingRad);
    this.activeRoute = null;
    this.trackedJobId = null;
    this.refreshJobs();
  }

  public applyQualityPreset(preset: QualityPreset): void {
    const spec = QUALITY_SPECS[preset];
    const dpr = window.devicePixelRatio || 1;
    const enableDetailMaps = preset !== 'mobile_fast';

    this.textures.configureQuality(preset);
    this.renderer.setPixelRatio(Math.min(dpr, spec.maxDpr));
    this.renderer.shadowMap.enabled = spec.shadowsEnabled;
    this.truckVisuals.setBlobShadowVisible(!spec.shadowsEnabled);
    this.truckVisuals.setPbrDetailEnabled(enableDetailMaps);

    this.env.configureForPreset(preset, spec.shadowsEnabled, spec.shadowMapSize, spec.fogScale);
    this.camera.far = spec.cameraFar;
    this.camera.updateProjectionMatrix();

    this.builtMap.setFoliageDensity(spec.foliageDensity, preset === 'mobile_fast');
    this.builtMap.setPbrDetailEnabled(enableDetailMaps);
    this.traffic.setActiveCount(spec.maxTraffic);
    this.mirrorUpdateInterval = Math.max(1, spec.mirrorUpdateInterval);

    this.handleResize();
  }

  private readonly handleResize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  public start(): void {
    if (this.rafId !== null || this.isPausedHidden) return;
    this.lastTimeMs = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  public dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.unlockAudioOnce);
    window.removeEventListener('pointerdown', this.unlockAudioOnce);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.input.dispose();
    this.cameraRig.dispose();
    this.audio.dispose();
    this.traffic.dispose();
    this.truckVisuals.dispose();
    this.builtMap.dispose();
    this.env.dispose();
    this.textures.dispose();
    this.mirrorRtLeft.dispose();
    this.mirrorRtRight.dispose();
    this.mirrorBlitMat.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private readonly loop = (nowMs: number): void => {
    if (this.isPausedHidden) {
      this.rafId = null;
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);

    const frameDtSec = Math.min(0.1, Math.max(0, (nowMs - this.lastTimeMs) / 1000));
    this.lastTimeMs = nowMs;

    this.fpsFrames += 1;
    this.fpsAccumSec += frameDtSec;
    if (this.fpsAccumSec >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccumSec);
      this.fpsFrames = 0;
      this.fpsAccumSec = 0;
    }

    this.accumulatorSec += frameDtSec;
    while (this.accumulatorSec >= this.fixedDtSec) {
      this.fixedStep(this.fixedDtSec);
      this.accumulatorSec -= this.fixedDtSec;
    }

    const store = useGameStore.getState();
    this.physics.syncVisuals(this.truckVisuals, this.input, this.env.nightFactor);
    this.cameraRig.update(
      frameDtSec,
      store.cameraMode,
      this.physics,
      this.truckVisuals,
      store.gamePhase === 'menu'
    );

    this.audio.setSettings(store.audioEnabled, store.masterVolume);
    this.audio.update({
      playing: store.gamePhase === 'playing' && store.activeModal === 'none',
      rpm: this.physics.rpm,
      throttle: this.input.throttle,
      horn: this.input.horn,
      blinkerLit: this.physics.blinkerLit,
      parkingBrake: this.physics.parkingBrake,
      gear: this.physics.gear,
      retarderActive:
        this.physics.retarderLevel > 0 &&
        Math.abs(this.physics.speedMs) > 2 &&
        this.input.throttle < 0.05,
      dtSec: frameDtSec,
    });

    this.telemetryAccumSec += frameDtSec;
    if (this.telemetryAccumSec >= this.telemetryIntervalSec) {
      this.telemetryAccumSec = 0;
      this.syncTelemetry();
    }

    this.frameIndex += 1;
    this.renderFrame(store.gamePhase === 'playing' && store.activeModal === 'none' && store.mirrorsEnabled);
  };

  private renderFrame(renderMirrors: boolean): void {
    const w = this.viewportWidth;
    const h = this.viewportHeight;

    // Update cached offscreen mirror RenderTargets at configured cadence (1/2/4 frames)
    const canShowMirrors = renderMirrors && w >= 640;
    if (canShowMirrors && this.frameIndex % this.mirrorUpdateInterval === 0) {
      this.truckVisuals.tractorRoot.updateMatrixWorld(true);

      // Left mirror (+X)
      this.tempVecA.set(1.52, 2.55, 2.5);
      this.truckVisuals.tractorRoot.localToWorld(this.tempVecA);
      this.tempVecB.set(2.3, 1.9, -18);
      this.truckVisuals.tractorRoot.localToWorld(this.tempVecB);
      this.leftMirrorCam.position.copy(this.tempVecA);
      this.leftMirrorCam.lookAt(this.tempVecB);

      this.renderer.setRenderTarget(this.mirrorRtLeft);
      this.renderer.setScissorTest(false);
      this.renderer.clear();
      this.renderer.render(this.scene, this.leftMirrorCam);

      // Right mirror (-X)
      this.tempVecA.set(-1.52, 2.55, 2.5);
      this.truckVisuals.tractorRoot.localToWorld(this.tempVecA);
      this.tempVecB.set(-2.3, 1.9, -18);
      this.truckVisuals.tractorRoot.localToWorld(this.tempVecB);
      this.rightMirrorCam.position.copy(this.tempVecA);
      this.rightMirrorCam.lookAt(this.tempVecB);

      this.renderer.setRenderTarget(this.mirrorRtRight);
      this.renderer.clear();
      this.renderer.render(this.scene, this.rightMirrorCam);

      this.renderer.setRenderTarget(null);
    }

    // Main camera pass
    this.renderer.setRenderTarget(null);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    if (!canShowMirrors) return;

    // Blit cached mirror textures into top-corner viewports (ultra-low cost every frame, zero flicker)
    const mirrorW = 196;
    const mirrorH = 108;
    const marginX = 18;
    const topY = 66;
    const scissorY = Math.max(0, h - topY - mirrorH);

    this.renderer.setScissorTest(true);

    this.mirrorBlitMat.map = this.mirrorRtLeft.texture;
    this.renderer.setViewport(marginX, scissorY, mirrorW, mirrorH);
    this.renderer.setScissor(marginX, scissorY, mirrorW, mirrorH);
    this.renderer.render(this.mirrorBlitScene, this.mirrorBlitCam);

    const rightX = w - marginX - mirrorW;
    this.mirrorBlitMat.map = this.mirrorRtRight.texture;
    this.renderer.setViewport(rightX, scissorY, mirrorW, mirrorH);
    this.renderer.setScissor(rightX, scissorY, mirrorW, mirrorH);
    this.renderer.render(this.mirrorBlitScene, this.mirrorBlitCam);

    this.renderer.setScissorTest(false);
  }

  private fixedStep(dtSec: number): void {
    this.elapsedSec += dtSec;
    const store = useGameStore.getState();

    if (store.paintHex !== this.lastPaintHex) {
      this.lastPaintHex = store.paintHex;
      this.truckVisuals.setPaintColor(store.paintHex);
    }

    const currentJobId = store.activeJob?.job.id ?? null;
    if (currentJobId !== this.trackedJobId) {
      this.trackedJobId = currentJobId;
      if (store.activeJob) {
        const origin = this.economy.findDepotById(store.activeJob.job.originDepotId);
        if (origin) {
          const distFromOrigin = Math.hypot(
            this.physics.x - origin.depot.officePosition[0],
            this.physics.z - origin.depot.officePosition[2]
          );
          // If player accepted a contract originating in another city, relocate tractor+trailer cleanly to that city hub
          if (distFromOrigin > 260) {
            const dx = origin.city.position[0] - origin.depot.officePosition[0];
            const dz = origin.city.position[2] - origin.depot.officePosition[2];
            const heading = Math.hypot(dx, dz) > 1 ? Math.atan2(dx, dz) : origin.depot.headingRad;
            this.physics.resetToSpawn(origin.depot.officePosition, heading);
            this.physics.parkingBrake = true;
          }
        }
        const dest = this.economy.findDepotById(store.activeJob.job.destinationDepotId);
        if (dest) {
          this.activeRoute = this.nav.computeRoute(
            this.physics.x,
            this.physics.z,
            dest.depot.parkingBayPosition[0],
            dest.depot.parkingBayPosition[2]
          );
          this.builtMap.highlightDestinationDepot(dest.depot.id);
        }
        this.truckVisuals.setTrailerCargoVisual(
          store.activeJob.job.trailerColor,
          store.activeJob.job.cargoCategory
        );
        if (!this.physics.trailerAttached) {
          this.physics.trailerAttached = true;
        }
      } else {
        this.activeRoute = null;
        this.builtMap.highlightDestinationDepot(null);
        this.truckVisuals.setTrailerCargoVisual('#e2e8f0', 'EUROHAUL');
      }
    }

    const drivingActive = store.gamePhase === 'playing' && store.activeModal === 'none';
    this.input.setDrivingEnabled(drivingActive);
    this.input.update(dtSec, this.physics.speedMs * 3.6);

    if (drivingActive) {
      this.physics.step(dtSec, this.input, this.builtMap, {
        engineTier: store.engineTier,
        cargoWeightTons: store.activeJob?.job.weightTons ?? 0,
        fuelLiters: store.fuelLiters,
        transmissionMode: store.transmissionMode,
        speedLimiterEnabled: store.speedLimiterEnabled,
        truckHealth: store.truckHealth,
        onFuelBurned: (liters) => store.consumeFuel(liters),
        onDistanceKm: (km) => store.addCareerDistance(km),
      });

      const trafficCollision = this.traffic.update(
        dtSec,
        this.physics.x,
        this.physics.y,
        this.physics.z,
        this.physics.trailerX,
        this.physics.trailerZ,
        this.env.nightFactor
      );

      const impact = this.physics.lastCollision ?? trafficCollision;
      if (impact) {
        const dmg = Math.min(18, Math.max(1.5, impact.impactSpeedKmh * 0.25));
        store.damageTruck(dmg);
        store.damageCargo(dmg * 1.25);
        this.audio.playCollision(Math.min(1, impact.impactSpeedKmh / 60));
        store.pushNotification(
          'warning',
          `碰撞: ${impact.label}`,
          `车损 +${dmg.toFixed(1)}%${store.activeJob ? ' · 货物受损' : ''}`
        );
      }

      const kmh = Math.abs(this.physics.speedMs) * 3.6;
      const fine = this.economy.checkSpeedCameras(this.physics.x, this.physics.z, kmh, performance.now());
      if (fine !== null) {
        store.applyFine(fine, `区间测速抓拍超速 (${Math.round(kmh)} km/h)`);
        store.triggerSpeedCameraFlash();
        this.audio.playCameraFlash();
      }

      if (store.activeJob) {
        store.tickJobTimer(dtSec);
        if (store.parkingGuide.readyToDeliver) {
          this.manualParkHoldSec += dtSec;
          if (this.manualParkHoldSec >= 0.9) {
            this.completeDelivery(true);
          }
        } else {
          this.manualParkHoldSec = 0;
        }
      }
    } else {
      this.traffic.update(
        dtSec * 0.35,
        this.physics.x,
        this.physics.y,
        this.physics.z,
        this.physics.trailerX,
        this.physics.trailerZ,
        this.env.nightFactor
      );
    }

    this.builtMap.update(dtSec, this.elapsedSec);
    this.env.update(dtSec, this.physics.x, this.physics.z);
  }

  private syncTelemetry(): void {
    const store = useGameStore.getState();
    const kmh = Math.abs(this.physics.speedMs) * 3.6;
    const gearLabel =
      this.physics.gear <= -2
        ? 'R2'
        : this.physics.gear === -1
        ? 'R1'
        : this.physics.gear === 0
        ? 'N'
        : `${store.transmissionMode === 'auto' ? 'A' : 'M'}${this.physics.gear}`;
    const hitchDeg = (this.physics.hitchAngleRad * 180) / Math.PI;

    const currentCity = this.economy.detectCurrentCity(this.physics.x, this.physics.z);
    const activeDest = store.activeJob
      ? this.economy.findDepotById(store.activeJob.job.destinationDepotId)?.depot ?? null
      : null;

    const guidance = this.nav.getGuidance(
      this.physics.x,
      this.physics.z,
      this.physics.yaw,
      activeDest?.parkingBayPosition[0] ?? this.physics.x,
      activeDest?.parkingBayPosition[2] ?? this.physics.z,
      this.activeRoute
    );

    const nearby = this.economy.detectNearbyInteraction(
      this.physics.x,
      this.physics.z,
      activeDest?.id ?? null
    );
    store.setNearbyInteraction(nearby);

    const parkingGuide = this.parkingValidator.evaluate(
      activeDest,
      this.physics.trailerX,
      this.physics.trailerZ,
      this.physics.trailerYaw,
      this.physics.trailerAttached,
      kmh
    );
    store.setParkingGuide(parkingGuide);

    // Update 3D cockpit instrument cluster & SatNav CanvasTexture cleanly when in 1st-person view
    if (store.cameraMode === 1 && store.gamePhase === 'playing') {
      const maxFuel = getMaxFuelLiters(store.tankTier);
      this.textures.updateDynamicDashboard({
        speedKmh: Math.round(kmh),
        rpm: this.physics.rpm,
        gearLabel,
        fuelPct: (store.fuelLiters / maxFuel) * 100,
        parkingBrake: this.physics.parkingBrake,
        leftBlinker: this.physics.blinkerLit && (this.physics.leftBlinker || this.physics.hazardLights),
        rightBlinker: this.physics.blinkerLit && (this.physics.rightBlinker || this.physics.hazardLights),
      });
      this.textures.updateDynamicCabGps({
        speedKmh: Math.round(kmh),
        speedLimitKmh: this.physics.speedLimitKmh,
        distanceMeters: guidance.distanceMeters,
        hasActiveJob: Boolean(store.activeJob),
        instruction: guidance.instruction,
      });
    }

    store.updateTelemetry({
      speedKmh: Math.round(kmh),
      rpm: Math.round(this.physics.rpm),
      gear: this.physics.gear,
      gearLabel,
      throttle: this.input.throttle,
      brake: this.input.brake,
      steerAngleNorm: this.input.steer,
      cruiseControlKmh: this.physics.cruiseControlKmh,
      retarderLevel: this.physics.retarderLevel,
      parkingBrake: this.physics.parkingBrake,
      headlightMode: this.physics.headlightMode,
      leftBlinker: this.physics.leftBlinker,
      rightBlinker: this.physics.rightBlinker,
      hazardLights: this.physics.hazardLights,
      blinkerLit: this.physics.blinkerLit,
      trailerAttached: this.physics.trailerAttached,
      hitchAngleDeg: Math.round(hitchDeg),
      jackknifeWarning: Math.abs(hitchDeg) > 52,
      speedLimitKmh: this.physics.speedLimitKmh,
      isSpeeding: kmh > this.physics.speedLimitKmh + 5,
      odometerKm: this.physics.odometerKm,
      fps: this.currentFps,
      timeOfDayHours: this.env.timeOfDayHours,
      currentCityName: currentCity?.name ?? '欧陆干线公路',
      navDistanceMeters: Math.round(guidance.distanceMeters),
      navEtaSeconds: Math.round(guidance.etaSeconds),
      navInstruction: guidance.instruction,
      truckX: this.physics.x,
      truckZ: this.physics.z,
      truckHeadingRad: this.physics.yaw,
      trailerX: this.physics.trailerX,
      trailerZ: this.physics.trailerZ,
      trailerHeadingRad: this.physics.trailerYaw,
    });
  }
}
