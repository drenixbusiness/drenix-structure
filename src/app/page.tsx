"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { DEFAULT_TRUCKS, type DeptKey, type TruckStop } from "@/data/drenix-data";
import { modelFor, totalStaff } from "@/lib/org";
import { resolveTarget, type JDTarget } from "@/lib/targets";
import { Header, type ViewMode } from "@/components/Header";
import { TruckSelector } from "@/components/TruckSelector";
import { ChartView } from "@/components/ChartView";
import { JDModal } from "@/components/JDModal";
import { DeptOverview } from "@/components/DeptOverview";
import { HiringForm } from "@/components/HiringForm";

const Map3D = dynamic(() => import("@/components/Map3D").then((m) => m.Map3D), {
  ssr: false,
  loading: () => null,
});

export default function Home() {
  const [trucks, setTrucks] = useState<TruckStop>(DEFAULT_TRUCKS);
  const [prev, setPrev] = useState<TruckStop | null>(null);
  const [changeKey, setChangeKey] = useState(0);
  const [view, setView] = useState<ViewMode>("chart");
  const [mounted3d, setMounted3d] = useState(false);
  const [jd, setJd] = useState<JDTarget | null>(null);
  const [deptOpen, setDeptOpen] = useState<DeptKey | null>(null);
  const [hireOpen, setHireOpen] = useState(false);

  const model = modelFor(trucks);
  const prevModel = prev ? modelFor(prev) : null;
  const total = totalStaff(model);
  const totalDelta = prevModel ? total - totalStaff(prevModel) : 0;

  const changeTrucks = useCallback(
    (t: TruckStop) => {
      if (t === trucks) return;
      setPrev(trucks);
      setTrucks(t);
      setChangeKey((k) => k + 1);
    },
    [trucks],
  );

  const switchView = (v: ViewMode) => {
    if (v === "3d") setMounted3d(true);
    setView(v);
  };

  const print = () => {
    if (view !== "chart") {
      setView("chart");
      setTimeout(() => window.print(), 450);
    } else window.print();
  };

  const pos = useMemo(() => (jd ? resolveTarget(jd, model) : null), [jd, model]);
  const closeJd = useCallback(() => setJd(null), []);
  const closeDept = useCallback(() => setDeptOpen(null), []);
  const closeHire = useCallback(() => setHireOpen(false), []);

  return (
    <div className="app">
      <Header view={view} onView={switchView} onPrint={print} onHire={() => setHireOpen(true)} />
      <TruckSelector
        trucks={trucks}
        onChange={changeTrucks}
        total={total}
        totalDelta={totalDelta}
        modelName={`Office staff · ${model.name}`}
        changeKey={changeKey}
      />
      <main className="main">
        <div className="view view-chart" hidden={view !== "chart"}>
          <ChartView model={model} prevModel={prevModel} changeKey={changeKey} active={view === "chart"} onOpen={setJd} onOpenDept={setDeptOpen} />
        </div>
        {mounted3d && (
          <div className="view view-3d" hidden={view !== "3d"}>
            <Map3D model={model} prevModel={prevModel} trucks={trucks} active={view === "3d"} />
          </div>
        )}
      </main>
      {deptOpen && view === "chart" && (
        <DeptOverview
          dept={deptOpen}
          model={model}
          prevModel={prevModel}
          trucks={trucks}
          paused={!!jd}
          onClose={closeDept}
          onNavigate={setDeptOpen}
          onOpen={setJd}
        />
      )}
      {pos && view === "chart" && <JDModal pos={pos} trucks={trucks} onClose={closeJd} />}
      {hireOpen && <HiringForm model={model} onClose={closeHire} />}
    </div>
  );
}
