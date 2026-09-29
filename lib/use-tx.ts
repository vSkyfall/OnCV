"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Hash, TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { fuji } from "@/config/chain";
import { parseWeb3Error } from "./errors";

/**
 * Runs one contract write at a time: switches to Fuji if needed, waits for the receipt, refreshes every
 * query and maps errors to UI copy. `pending` holds the key of the running action (for per-button spinners).
 */
export function useContractTx() {
  const { chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: fuji.id });
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, send: () => Promise<Hash>): Promise<TransactionReceipt | null> {
    if (!publicClient) return null;
    setPending(key);
    setError(null);
    try {
      if (chainId !== fuji.id) await switchChainAsync({ chainId: fuji.id });
      const hash = await send();
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("İşlem zincirde başarısız oldu.");
      await queryClient.invalidateQueries();
      return receipt;
    } catch (err) {
      setError(parseWeb3Error(err));
      return null;
    } finally {
      setPending(null);
    }
  }

  return { run, pending, error, setError, busy: pending !== null };
}
