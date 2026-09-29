import { Rocket } from "lucide-react";
import { IconTile } from "@/components/ui/primitives";

/** Shown when no contract address is configured yet (before `npm run deploy:fuji`). */
export function SetupNotice() {
  return (
    <div className="card mx-auto max-w-2xl p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <IconTile>
          <Rocket className="h-4 w-4" />
        </IconTile>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-50">Registry contract not configured</h2>
          <p className="mt-1 text-sm text-zinc-400">
            onCV kontratını Avalanche Fuji&apos;ye deploy edin; adres otomatik olarak{" "}
            <code className="font-mono text-zinc-200">config/deployment.json</code> dosyasına yazılır.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {`# .env.local içine PRIVATE_KEY ekleyin (test cüzdanı)
npm run contracts:test
npm run deploy:fuji
npm run dev`}
          </pre>
          <p className="mt-3 text-xs text-zinc-500">
            Alternatif: <code className="font-mono">NEXT_PUBLIC_PROOFSKILL_ADDRESS</code> ortam değişkenini ayarlayın.
          </p>
        </div>
      </div>
    </div>
  );
}
