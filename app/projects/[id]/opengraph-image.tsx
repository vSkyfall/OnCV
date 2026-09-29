import { OG_SIZE, renderProjectOg } from "@/lib/og";

export const alt = "onCV project tracking";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderProjectOg(id);
}