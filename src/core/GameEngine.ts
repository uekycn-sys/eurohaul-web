import * as THREE from 'three';
import { QualityPreset, useGameStore } from '../store/useGameStore';
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

/**
 * Core WebGL / Fixed-timestep simulation engine.
 * Owns 3D rendering, physics, AI traffic, audio synthesis, navigation, and economy checks.
 * Decoupled from React; pushes telemetry to Zustand at ~18 Hz.
 */
export class GameEngine {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly leftMirrorCam: THREE.PerspectiveCamera;
  private readonly rightMirrorCam: THREE.PerspectiveCamera;

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

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
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

    this.textures = new ProceduralTextures();
    this.env = new EnvironmentSystem(this.scene);
    this.mapBuilder = new MapBuilder(this.textures, this.env);

    const store = useGameStore.getState();
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

    this.traffic = new TrafficSystem(this.builtMap, 20);
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
      onToggleCruiseControl: () => this.physics.toggleCruiseControl(),
      onCycleRetarder: () => this.physics.cycleRetarder(),
      onToggleTrailer: () => {
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
      },
      onShiftUp: () => this.physics.shiftUp(useGameStore.getState().transmissionMode),
      onShiftDown: () => this.physics.shiftDown(useGameStore.getState().transmissionMode),
      onCameraMode: (mode) => useGameStore.getState().setCameraMode(mode),
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

    this.applyQualityPreset(store.qualityPreset);
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  private readonly unlockAudioOnce = (): void => {
    this.audio.unlock();
  };

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

  public loadMap(mapId: string): void {
    const manifest = MapRegistry.getMapById(mapId);
    this.traffic.dispose();
    this.scene.remove(this.builtMap.root);
    this.builtMap.dispose();

    this.builtMap = this.mapBuilder.build(manifest);
    this.scene.add(this.builtMap.root);

    this.traffic = new TrafficSystem(this.builtMap, 20);
    this.nav = new NavigationSystem(this.builtMap);
    this.economy = new EconomyManager(this.builtMap, this.nav);
    this.physics.resetToSpawn(manifest.defaultSpawnPosition, manifest.defaultSpawnHeadingRad);
    this.activeRoute = null;
    this.trackedJobId = null;
    this.refreshJobs();
  }

  public applyQualityPreset(preset: QualityPreset): void {
    const dpr = window.devicePixelRatio || 1;
    if (preset === 'low') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.0));
      this.renderer.shadowMap.enabled = false;
      this.env.configureQuality(false, 512, 1.35);
      this.camera.far = 950;
    } else if (preset === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.25));
      this.renderer.shadowMap.enabled = true;
      this.env.configureQuality(true, 1024, 1.0);
      this.camera.far = 1400;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      this.renderer.shadowMap.enabled = true;
      this.env.configureQuality(true, 2048, 0.85);
      this.camera.far = 1900;
    }
    this.camera.updateProjectionMatrix();
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
    if (this.rafId !== null) return;
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
    this.input.dispose();
    this.cameraRig.dispose();
    this.audio.dispose();
    this.traffic.dispose();
    this.truckVisuals.dispose();
    this.builtMap.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private readonly loop = (nowMs: number): void => {
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
    });

    this.telemetryAccumSec += frameDtSec;
    if (this.telemetryAccumSec >= this.telemetryIntervalSec) {
      this.telemetryAccumSec = 0;
      this.syncTelemetry();
    }

    this.renderFrame(store.gamePhase === 'playing' && store.activeModal === 'none' && store.mirrorsEnabled);
  };

  private renderFrame(renderMirrors: boolean): void {
    const w = this.viewportWidth;
    const h = this.viewportHeight;

    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    if (!renderMirrors || w < 640) return;

    const mirrorW = 196;
    const mirrorH = 108;
    const marginX = 18;
    const topY = 66;
    const scissorY = Math.max(0, h - topY - mirrorH);

    // Update mirror cameras from tractor exterior mirror mounts looking backward
    this.truckVisuals.tractorRoot.updateMatrixWorld(true);
    this.renderer.setScissorTest(true);

    // Left mirror (+X side)
    this.tempVecA.set(1.52, 2.55, 2.5);
    this.truckVisuals.tractorRoot.localToWorld(this.tempVecA);
    this.tempVecB.set(2.3, 1.9, -18);
    this.truckVisuals.tractorRoot.localToWorld(this.tempVecB);
    this.leftMirrorCam.position.copy(this.tempVecA);
    this.leftMirrorCam.lookAt(this.tempVecB);

    this.renderer.setViewport(marginX, scissorY, mirrorW, mirrorH);
    this.renderer.setScissor(marginX, scissorY, mirrorW, mirrorH);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.leftMirrorCam);

    // Right mirror (-X side)
    this.tempVecA.set(-1.52, 2.55, 2.5);
    this.truckVisuals.tractorRoot.localToWorld(this.tempVecA);
    this.tempVecB.set(-2.3, 1.9, -18);
    this.truckVisuals.tractorRoot.localToWorld(this.tempVecB);
    this.rightMirrorCam.position.copy(this.tempVecA);
    this.rightMirrorCam.lookAt(this.tempVecB);

    const rightX = w - marginX - mirrorW;
    this.renderer.setViewport(rightX, scissorY, mirrorW, mirrorH);
    this.renderer.setScissor(rightX, scissorY, mirrorW, mirrorH);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.rightMirrorCam);

    this.renderer.setScissorTest(false);
  }

  private fixedStep(dtSec: number): void {
    this.elapsedSec += dtSec;
    const store = useGameStore.getState();

    if (store.paintHex !== this.lastPaintHex) {
      this.lastPaintHex = store.paintHex;
      this.truckVisuals.setPaintColor(store.paintHex);
    }

    // Track active job changes for routing & container livery
    const currentJobId = store.activeJob?.job.id ?? null;
    if (currentJobId !== this.trackedJobId) {
      this.trackedJobId = currentJobId;
      if (store.activeJob) {
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
        this.physics.trailerZ
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

      // Speed camera enforcement
      const kmh = Math.abs(this.physics.speedMs) * 3.6;
      const fine = this.economy.checkSpeedCameras(this.physics.x, this.physics.z, kmh, performance.now());
      if (fine !== null) {
        store.applyFine(fine, `区间测速抓拍超速 (${Math.round(kmh)} km/h)`);
        store.triggerSpeedCameraFlash();
        this.audio.playCameraFlash();
      }

      // Active job timer & auto-complete on steady manual parking
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
        this.physics.trailerZ
      );
    }

    this.builtMap.update(dtSec, this.elapsedSec);
    this.env.update(dtSec, this.physics.x, this.physics.z);
  }

  private syncTelemetry(): void {
    const store = useGameStore.getState();
    const kmh = Math.abs(this.physics.speedMs) * 3.6;
    const gearLabel =
      this.physics.gear === -1 ? 'R' : this.physics.gear === 0 ? 'N' : `A${this.physics.gear}`;
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
