import { ProfileRoute, profileMetadata, type AddressRouteProps } from "@/components/profile/profile-route";

// Short share link: oncv.xyz/0xABCD... renders the same Web3 CV as /profile/0xABCD...
export const generateMetadata = profileMetadata;

export default function ShortProfilePage(props: AddressRouteProps) {
  return <ProfileRoute {...props} />;
}
