import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectView } from "@/components/projects/ProjectView";
import { isRegistryConfigured, projectRegistry } from "@/config/contract";
import { stageMeta } from "@/lib/projects";
import { serverClient } from "@/lib/server/chain";

type Props = { params: Promise<{ id: string }> };

function parseId(raw: string): bigint | null {
  return /^\d{1,20}$/.test(raw) && raw !== "0" ? BigInt(raw) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const projectId = parseId(id);
  if (projectId === null) return { title: "Proje bulunamadı", robots: { index: false } };

  const base: Metadata = {
    title: `Proje #${id}`,
    description: "Hackathon sonrası proje takibi: 3. ve 6. ay kontrol noktaları, zincirde doğrulanmış ilerleme.",
    alternates: { canonical: `/projects/${id}` },
  };
  if (!isRegistryConfigured) return base;
  try {
    const project = await serverClient.readContract({ ...projectRegistry, functionName: "getProject", args: [projectId] });
    // Moderated projects keep their page but are not indexed and do not repeat their content in previews.
    if (project.hidden) return { ...base, robots: { index: false, follow: false } };
    const status = project.stage === 0 ? "" : ` · ${stageMeta(project.stage).label}${project.stageAttested ? " (onaylı)" : ""}`;
    return {
      ...base,
      title: `${project.title} · Proje takibi`,
      description: `${project.pitch.slice(0, 120)}${project.pitch.length > 120 ? "…" : ""} Durum${status || ": kaydedildi"}.`,
    };
  } catch {
    return base; // RPC unavailable or unknown id: generic title, the page itself shows the error.
  }
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const projectId = parseId(id);
  if (projectId === null) notFound();
  return <ProjectView projectId={projectId} />;
}
