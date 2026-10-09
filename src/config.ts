// Papertrade deployment constants (read from the official frontend's deployment bundle).
export const ORIGIN = process.env.PAPERTRADE_ORIGIN ?? "https://exchange.papertrade.xyz";
export const RPC_URL = process.env.PAPERTRADE_RPC ?? "https://rpc.hyperliquid.xyz/evm";
export const EXCHANGE = "0x6cd5661646289fb6e65ea5c032310fded797d0a2" as const;
