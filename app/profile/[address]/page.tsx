import { ProfileRoute, profileMetadata, type AddressRouteProps } from "@/components/profile/profile-route";

export const generateMetadata = profileMetadata;

export default function PublicProfilePage(props: AddressRouteProps) {
  return <ProfileRoute {...props} />;
}
