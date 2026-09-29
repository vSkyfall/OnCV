"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/primitives";

/**
 * The camera scanner (and its jsQR decoder) is downloaded only when someone actually opens it, keeping it out
 * of the check-in page and organizer console bundles.
 */
export const QrScanner = dynamic(() => import("./QrScanner").then((m) => m.QrScanner), {
  ssr: false,
  loading: () => (
    <div className="card flex aspect-square w-full items-center justify-center">
      <Spinner className="h-5 w-5 text-zinc-500" />
    </div>
  ),
});
