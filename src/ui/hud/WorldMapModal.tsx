import { memo, useEffect, useRef } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import { MapManifest } from '../../map/types';
import { RoutePoint } from '../../gameplay/NavigationSystem';

interface WorldMapModalProps {
  mapManifest: MapManifest;
  getRoutePoints: () => RoutePoint[];
}

export const WorldMapModal = memo(function WorldMapModal({
  mapManifest,
  getRoutePoints,
}: WorldMapModalProps) {
  const worldMapRef = useRef<HTMLCanvasElement | null>(null);
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const activeJob = useGameStore((s) => s.activeJob);
  const truckX = useGameStore((s) => s.telemetry.truckX);
  const truckZ = useGameStore((s) => s.telemetry.truckZ);
  const truckHeadingRad = useGameStore((s) => s.telemetry.truckHeadingRad);

  useEffect(() => {
    if (activeModal !== 'map') return;
    const canvas = worldMapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#09101d';
    ctx.fillRect(0, 0, w, h);

    const { minX, maxX, minZ, maxZ } = mapManifest.worldBounds;
    const pad = 42;
    const scaleX = (w - pad * 2) / (maxX - minX);
    const scaleZ = (h - pad * 2) / (maxZ - minZ);
    const scale = Math.min(scaleX, scaleZ);
    const offsetX = w * 0.5 - (minX + maxX) * 0.5 * scale;
    const offsetZ = h * 0.5 - (minZ + maxZ) * 0.5 * scale;

    const toMap = (wx: number, wz: number): [number, number] => [
      wx * scale + offsetX,
      wz * scale + offsetZ,
    ];

    const nodeLookup = new Map(mapManifest.nodes.map((n) => [n.id, n]));

    ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
    ctx.lineWidth = 1;
    for (let x = -1500; x <= 1500; x += 500) {
      const [gx] = toMap(x, 0);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let z = -1500; z <= 1500; z += 500) {
      const [, gz] = toMap(0, z);
      ctx.beginPath();
      ctx.moveTo(0, gz);
      ctx.lineTo(w, gz);
      ctx.stroke();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of mapManifest.segments) {
      const a = nodeLookup.get(seg.fromNodeId);
      const b = nodeLookup.get(seg.toNodeId);
      if (!a || !b) continue;
      const pts = [a.position, ...(seg.controlPoints ?? []), b.position];
      ctx.strokeStyle =
        seg.roadClass === 'motorway' ? '#f59e0b' : seg.biome === 'alpine' ? '#38bdf8' : '#64748b';
      ctx.lineWidth = seg.lanes >= 4 ? 5 : 3;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [mx, my] = toMap(pts[i]![0], pts[i]![2]);
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }

    const routePts = getRoutePoints();
    if (routePts.length > 1) {
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i < routePts.length; i++) {
        const [mx, my] = toMap(routePts[i]!.x, routePts[i]!.z);
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }

    for (const city of mapManifest.cities) {
      const [cx, cy] = toMap(city.position[0], city.position[2]);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      for (const depot of city.depots) {
        const [dx, dy] = toMap(depot.parkingBayPosition[0], depot.parkingBayPosition[2]);
        const isDest = activeJob?.job.destinationDepotId === depot.id;
        ctx.fillStyle = isDest ? '#10b981' : '#94a3b8';
        ctx.fillRect(dx - 3, dy - 3, 6, 6);
      }

      for (const st of city.stations) {
        const [sx, sy] = toMap(st.position[0], st.position[2]);
        ctx.fillStyle = st.kind === 'fuel' ? '#f59e0b' : '#0ea5e9';
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const labelText = `${city.name} (${city.country})`;
      ctx.font = 'bold 12px Inter, sans-serif';
      const textW = ctx.measureText(labelText).width;
      const lx = cx + 13;
      const ly = cy - 11;
      ctx.fillStyle = 'rgba(9, 16, 29, 0.86)';
      ctx.fillRect(lx - 4, ly - 2, textW + 8, 18);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(labelText, lx, ly + 11);
    }

    const [px, py] = toMap(truckX, truckZ);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-truckHeadingRad);
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(7, -8);
    ctx.lineTo(0, -4);
    ctx.lineTo(-7, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [activeModal, mapManifest, getRoutePoints, truckX, truckZ, truckHeadingRad, activeJob]);

  if (activeModal !== 'map') return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <MapIcon className="h-5 w-5 text-amber-400" />
            {mapManifest.name} — 欧陆导航全图
          </div>
          <button
            type="button"
            onClick={() => setActiveModal('none')}
            className="rounded-lg bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            关闭 [M / Esc]
          </button>
        </div>
        <canvas
          ref={worldMapRef}
          width={860}
          height={520}
          className="w-full rounded-xl border border-slate-800"
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded bg-amber-500" /> 高速公路
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded bg-sky-400" /> 阿尔卑斯山路
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded bg-purple-400" /> GPS 规划航线
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" /> 目的卸货位
          </span>
        </div>
      </div>
    </div>
  );
});
