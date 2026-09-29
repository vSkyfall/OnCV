import { OG_SIZE, renderProfileOg } from "@/lib/og";

export const alt = "onCV Web3 CV";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return renderProfileOg(address);
}