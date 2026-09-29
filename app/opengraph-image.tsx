import { OG_SIZE, renderHomeOg } from "@/lib/og";

export const alt = "onCV · Verifiable On-Chain Credentials & Attendance Infrastructure";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderHomeOg();
}
