import { useMemo } from "react";

/** Deterministic, symmetric 5x5 identicon derived from a wallet address (monochrome with a red accent). */
export function Identicon({ address, size = 40, className }: { address: string; size?: number; className?: string }) {
  const { cells, color } = useMemo(() => {
    const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
    const bytes = Array.from({ length: 20 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    const filled: Array<[number, number]> = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (bytes[1 + row * 3 + col] % 2 === 0) {
          filled.push([col, row]);
          if (col < 2) filled.push([4 - col, row]);
        }
      }
    }
    const palette = ["#FAFAFA", "#D4D4D8", "#A1A1AA", "#E84142"];
    return { cells: filled, color: palette[bytes[0] % palette.length] };
  }, [address]);

  return (
    <svg
      viewBox="0 0 70 70"
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: size * 0.22 }}
      aria-hidden
    >
      <rect width="70" height="70" fill="#18181B" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={10 + x * 10} y={10 + y * 10} width="10" height="10" fill={color} />
      ))}
    </svg>
  );
}
