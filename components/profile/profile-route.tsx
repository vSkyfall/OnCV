import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ProfileView } from "@/components/profile/ProfileView";
import { shortenAddress } from "@/lib/utils";

export type AddressRouteProps = { params: Promise<{ address: string }> };

/** Shared by /profile/[address] and the short share link /[address]. */
export async function profileMetadata({ params }: AddressRouteProps): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) return { title: "Profil bulunamadı", robots: { index: false } };
  const checksum = getAddress(address);
  const short = shortenAddress(checksum);
  return {
    title: `Web3 CV · ${short}`,
    description: `${short} adresinin Avalanche üzerinde doğrulanmış etkinlik katılımları, Proof Score'u, projeleri ve beceri alanları.`,
    // Both /[address] and /profile/[address] point to the short share link.
    alternates: { canonical: `/${checksum}` },
    // /profile (the connected wallet's own page) is noindex; public CVs are indexable.
    robots: { index: true, follow: true },
  };
}

export async function ProfileRoute({ params }: AddressRouteProps) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) notFound();
  return <ProfileView address={getAddress(address)} />;
}
