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

interface AuthSessionPayload {
  authenticated?: boolean;
  address?: string;
  is_admin?: boolean;
}

interface AuthSIWEChallengePayload {
  challenge_id: string;
  siwe_message: string;
}

interface WalletSession {
  authenticated: boolean;
  address: string;
  isAdmin: boolean;
}

const emptySession: WalletSession = {
  authenticated: false,
  address: "",
  isAdmin: false,
};

const walletProviderMissingMessage =
  "No browser wallet found. Install or enable an Ethereum wallet, then retry.";

function normalizeAddress(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeAddress(a).toLowerCase();
  const right = normalizeAddress(b).toLowerCase();
  return left !== "" && left === right;
}

function walletLabel(address: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
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
  const address = normalizeAddress(data?.address);
  return {
    authenticated: data?.authenticated === true && address !== "",
    address,
    isAdmin: data?.is_admin === true,
  };
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
  const isAuthenticated =
    session.authenticated &&
    sessionAddress !== "" &&
    (walletAddress === "" || sameAddress(sessionAddress, walletAddress));

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
      setSession({
        authenticated: verified?.authenticated === true,
        address: normalizeAddress(verified?.address || signerAddress),
        isAdmin: verified?.is_admin === true,
      });
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
    setSession(emptySession);
  };

  const label = useMemo(() => walletLabel(address), [address]);

  return {
    address,
    error,
    isAuthenticated,
    isAdmin: isAuthenticated && session.isAdmin,
    isLoading:
      isSessionLoading || connection.isConnecting || connection.isReconnecting,
    isSigningIn,
    label,
    signIn,
    logout,
  };
}
