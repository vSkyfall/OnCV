import { ArrowLeft, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { IconTile } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Sayfa bulunamadı",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="page-shell flex flex-col items-center py-32 text-center">
      <IconTile className="h-11 w-11">
        <SearchX className="h-5 w-5" />
      </IconTile>
      <h1 className="mt-5 text-xl font-semibold tracking-tight text-zinc-50">Sayfa bulunamadı</h1>
      <p className="mt-2 text-sm text-zinc-500">Aradığınız sayfa ya da cüzdan adresi geçerli değil.</p>
      <Link href="/" className="btn-secondary mt-6">
        <ArrowLeft className="h-4 w-4" /> Ana sayfa
      </Link>
    </div>
  );
}
