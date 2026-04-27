import { useEffect, useMemo, useState } from "react";
import {
  type Connector,
  useConnect,
  useConnection,
  useDisconnect,
  useSignMessage,
} from "wagmi";
import { API_PATHS } from "@/lib/apiPaths";
import { APIClientError, apiClient } from "@/lib/apiClient";
import { compactAddress, normalizeAddress } from "@/lib/address";

interface AuthSessionPayload {
  authenticated?: boolean;
  address?: string;
  relay_address?: string;
  is_admin?: boolean;
  is_relay_owner?: boolean;
}

interface AuthSIWEChallengePayload {
  challenge_id: string;
  siwe_message: string;
}

interface WalletSession {
  authenticated: boolean;
  address: string;
  relayAddress: string;
  isAdmin: boolean;
  isRelayOwner: boolean;
}

const emptySession: WalletSession = {
  authenticated: false,
  address: "",
  relayAddress: "",
  isAdmin: false,
  isRelayOwner: false,
};

const walletProviderMissingMessage =
  "No browser wallet found. Install or enable an Ethereum wallet, then retry.";

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeAddress(a).toLowerCase();
  const right = normalizeAddress(b).toLowerCase();
  return left !== "" && left === right;
}

function walletLabel(address: string): string {
  return compactAddress(address, 6, 4);
}

function toWalletSession(
  data: AuthSessionPayload | undefined,
  fallbackAddress = "",
  fallbackRelayAddress = ""
): WalletSession {
  const address = normalizeAddress(data?.address || fallbackAddress);
  const relayAddress = normalizeAddress(
    data?.relay_address || fallbackRelayAddress
  );
  const authenticated = data?.authenticated === true && address !== "";
  const isRelayOwner =
    authenticated &&
    (data?.is_relay_owner === true || sameAddress(address, relayAddress));
  return {
    authenticated,
    address,
    relayAddress,
    isAdmin: data?.is_admin === true,
    isRelayOwner,
  };
}

function toWalletError(error: unknown): string {
  if (isProviderNotFoundError(error)) {
    return walletProviderMissingMessage;
  }
  if (isWalletRejectedError(error)) {
    return "Wallet request was rejected.";
  }
  if (isWalletRequestPendingError(error)) {
    return "A wallet request is already pending. Open your wallet and finish it.";
  }

  if (error instanceof APIClientError) {
    if (error.code === "invalid_address") {
      return "Wallet address is invalid.";
    }
    if (error.code === "unauthorized") {
      return "Signature was not accepted.";
    }
    return error.message || "Wallet sign-in failed.";
  }
  if (error instanceof Error) {
    return error.message || "Wallet sign-in failed.";
  }
  return "Wallet sign-in failed.";
}

function errorCode(error: unknown): number | undefined {
  return error instanceof Error
    ? (error as Error & { code?: number }).code
    : undefined;
}

function isProviderNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ProviderNotFoundError" ||
      error.message.includes("Provider not found"))
  );
}

function isWalletRejectedError(error: unknown): boolean {
  return errorCode(error) === 4001;
}

function isWalletRequestPendingError(error: unknown): boolean {
  return errorCode(error) === -32002;
}

async function findAvailableConnector(
  connectors: readonly Connector[]
): Promise<Connector | undefined> {
  const connector = await findInjectedConnector(connectors);
  if (connector) {
    return connector;
  }

  await waitForInjectedProvider();
  return findInjectedConnector(connectors);
}

async function findInjectedConnector(
  connectors: readonly Connector[]
): Promise<Connector | undefined> {
  for (const connector of connectors) {
    try {
      if (await connector.getProvider()) {
        return connector;
      }
    } catch {
      // Try the next connector.
    }
  }
  return undefined;
}

async function waitForInjectedProvider(): Promise<void> {
  if (typeof window === "undefined" || "ethereum" in window) {
    return;
  }

  await new Promise<void>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener("ethereum#initialized", done);
      resolve();
    };
    timeoutId = setTimeout(done, 1_000);
    window.addEventListener("ethereum#initialized", done, { once: true });
  });
}

async function loadSession(): Promise<WalletSession> {
  const data = await apiClient.get<AuthSessionPayload>(API_PATHS.auth.session);
  return toWalletSession(data);
}

export function useWalletAuth() {
  const connection = useConnection();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [session, setSession] = useState<WalletSession>(emptySession);
  const [isSessionLoading, setSessionLoading] = useState(true);
  const [isSigningIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  const walletAddress = normalizeAddress(connection.address);
  const sessionAddress = normalizeAddress(session.address);
  const address = walletAddress || sessionAddress;
  const relayAddress = normalizeAddress(session.relayAddress);
  const isAuthenticated =
    session.authenticated &&
    sessionAddress !== "" &&
    (walletAddress === "" || sameAddress(sessionAddress, walletAddress));
  const isRelayOwner =
    isAuthenticated &&
    (session.isRelayOwner || sameAddress(sessionAddress, relayAddress));

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const nextSession = await loadSession();
        if (mounted) {
          setSession(nextSession);
        }
      } catch {
        if (mounted) {
          setSession(emptySession);
        }
      } finally {
        if (mounted) {
          setSessionLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = async () => {
    if (isSigningIn) {
      return;
    }

    setSigningIn(true);
    setError("");

    try {
      let signerAddress = walletAddress;
      let signerConnector = connection.connector;
      if (signerAddress === "") {
        const connector = await findAvailableConnector(connectors);
        if (!connector) {
          throw new Error(walletProviderMissingMessage);
        }
        const connected = await connectAsync({ connector });
        signerAddress = normalizeAddress(connected.accounts[0]);
        signerConnector = connector;
      }
      if (signerAddress === "") {
        throw new Error("Wallet did not return an address.");
      }

      if (sameAddress(session.address, signerAddress) && session.authenticated) {
        return;
      }

      const challenge = await apiClient.post<AuthSIWEChallengePayload>(
        API_PATHS.auth.siweChallenge,
        { address: signerAddress }
      );
      const signature = await signMessageAsync({
        connector: signerConnector,
        message: challenge.siwe_message,
      });
      const verified = await apiClient.post<AuthSessionPayload>(
        API_PATHS.auth.siweVerify,
        {
          challenge_id: challenge.challenge_id,
          siwe_message: challenge.siwe_message,
          siwe_signature: signature,
        }
      );
      setSession(toWalletSession(verified, signerAddress, session.relayAddress));
    } catch (err: unknown) {
      const message = toWalletError(err);
      setError(message);
      throw new Error(message);
    } finally {
      setSigningIn(false);
    }
  };

  const logout = async () => {
    setError("");
    try {
      await apiClient.post<unknown>(API_PATHS.auth.logout);
    } catch {
      // Best-effort logout.
    }
    try {
      await disconnectAsync();
    } catch {
      // Wallet may already be disconnected.
    }
    setSession((prev) => ({
      ...emptySession,
      relayAddress: prev.relayAddress,
    }));
  };

  const label = useMemo(() => walletLabel(address), [address]);
  const relayLabel = useMemo(() => walletLabel(relayAddress), [relayAddress]);

  return {
    address,
    error,
    isAuthenticated,
    isAdmin: isAuthenticated && (session.isAdmin || isRelayOwner),
    isLoading:
      isSessionLoading || connection.isConnecting || connection.isReconnecting,
    isSigningIn,
    isRelayOwner,
    label,
    relayAddress,
    relayLabel,
    signIn,
    logout,
  };
}
