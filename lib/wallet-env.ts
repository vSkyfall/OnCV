type InjectedWindow = Window & {
  ethereum?: unknown;
  okxwallet?: unknown;
};

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** True inside a wallet's in-app browser or when a browser extension wallet is installed. */
export function hasInjectedWallet(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as InjectedWindow;
  return Boolean(w.okxwallet || w.ethereum);
}

/** Opens the current page inside the OKX Wallet app's dApp browser. */
export function okxDappDeepLink(url: string): string {
  const deepLink = `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`;
  return `https://www.okx.com/download?deeplink=${encodeURIComponent(deepLink)}`;
}

/** Opens the current page inside the MetaMask mobile in-app browser. */
export function metaMaskDappDeepLink(url: string): string {
  return `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`;
}
