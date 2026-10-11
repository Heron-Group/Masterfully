import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth";
import { MapView } from "@/components/map/map-view";

export const metadata: Metadata = { title: "Map" };

const fill = { height: "calc(var(--app-height, 100dvh) - var(--header-height))" };

export default function MapPage() {
  return (
    <Suspense fallback={<div style={fill} />}>
      <MapLoader />
    </Suspense>
  );
}

// The graph itself is fetched by the client from /api/map.
async function MapLoader() {
  await requireSession();
  return (
    <div className="flex flex-col" style={fill}>
      <MapView />
    </div>
  );
}
