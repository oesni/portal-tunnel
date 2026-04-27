import { SsgoiTransition } from "@ssgoi/react";
import { useEffect, useState } from "react";
import { Check, Copy, Fingerprint } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { compactAddress, normalizeAddress } from "@/lib/address";

interface ServerDetailState {
  id: number;
  name: string;
  description: string;
  tags: string[];
  thumbnail: string;
  owner: string;
  address?: string;
  online: boolean;
  serverUrl: string;
}

export function ServerDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const server = location.state as ServerDetailState;
  const [addressCopied, setAddressCopied] = useState(false);

  // Detect back navigation using pageshow event
  useEffect(() => {
    const handlePageShow = () => {
      // Navigate to home if restored from bfcache or has push flag in localStorage
      const hasPushFlag = localStorage.getItem("isPush") === "true";

      if (hasPushFlag) {
        localStorage.removeItem("isPush");
        navigate("/", { replace: true });
      }
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [navigate]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (!server) {
      navigate("/");
      return;
    }

    // Check localStorage immediately (before pageshow)
    const hasPushFlag = localStorage.getItem("isPush") === "true";

    if (hasPushFlag) {
      // If flag already exists, go home (double-check with pageshow handler)
      localStorage.removeItem("isPush");
      navigate("/");
      return;
    }

    // Redirect after animation
    const timer = setTimeout(() => {
      localStorage.setItem("isPush", "true");
      window.location.href = server.serverUrl;
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [server, navigate]);

  // If no server data, show nothing (will redirect)
  if (!server) {
    return null;
  }

  const { id, thumbnail, name, online, description, tags, owner, address } =
    server;
  const identityAddress = normalizeAddress(address);
  const displayAddress = compactAddress(identityAddress, 10, 8);

  const handleAddressCopy = async () => {
    if (!identityAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(identityAddress);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1600);
    } catch (error) {
      console.error("Failed to copy tunnel address", error);
    }
  };

  // Base size multiplier (1 = default, 2 = 2x size)
  const basicSize = 2.5;

  return (
    <SsgoiTransition id={`/server/${id}`}>
      <div
        data-hero-key={`server-bg-${id}`}
        className="fixed inset-0 bg-center bg-no-repeat bg-cover w-screen h-screen"
        style={{ ...(thumbnail && { backgroundImage: `url(${thumbnail})` }) }}
      >
        {/* Content overlay - Full screen */}
        <div className="absolute inset-0 flex items-center justify-center p-6 md:p-12">
          <div className="w-full h-full max-w-7xl bg-background/70 backdrop-blur-sm rounded-xl flex flex-col gap-6 p-8 md:p-12 items-start text-start">
            <div className="w-full h-full flex flex-col justify-center gap-6 md:gap-8">
              <div
                className="flex flex-col"
                style={{ gap: `${1 * basicSize}%` }}
              >
                <div
                  className="flex items-center"
                  style={{ gap: `${0.8 * basicSize}%` }}
                >
                  <div
                    className={`rounded-full ${
                      online ? "bg-green-status" : "bg-red-500"
                    }`}
                    style={{
                      width: `${1 * basicSize}vw`,
                      height: `${1 * basicSize}vw`,
                    }}
                  />
                  <p
                    className={`font-medium leading-normal ${
                      online ? "text-green-status" : "text-red-500"
                    }`}
                    style={{ fontSize: `${1.8 * basicSize}vw` }}
                  >
                    {online ? "Online" : "Offline"}
                  </p>
                </div>
                <p
                  className="text-foreground font-bold leading-tight"
                  style={{ fontSize: `${6 * basicSize}vw` }}
                >
                  {name}
                </p>
                {description && (
                  <p
                    className="text-text-muted font-normal leading-normal max-w-4xl"
                    style={{ fontSize: `${2.5 * basicSize}vw` }}
                  >
                    {description}
                  </p>
                )}
                {tags && tags.length > 0 && (
                  <div
                    className="flex flex-wrap"
                    style={{
                      gap: `${0.8 * basicSize}vw`,
                      marginTop: `${0.5 * basicSize}%`,
                    }}
                  >
                    {tags.map((tag, index) => (
                      <span
                        key={index}
                        className="bg-secondary text-primary font-medium rounded-lg"
                        style={{
                          padding: `${0.6 * basicSize}vw ${1.2 * basicSize}vw`,
                          fontSize: `${1.5 * basicSize}vw`,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {owner && (
                  <p
                    className="text-text-muted font-normal leading-normal"
                    style={{
                      fontSize: `${1.8 * basicSize}vw`,
                      marginTop: `${1 * basicSize}%`,
                    }}
                  >
                    by {owner}
                  </p>
                )}
                {identityAddress && (
                  <div
                    className="flex max-w-4xl flex-col gap-2 border-t border-border/70 pt-4"
                    style={{ marginTop: `${0.8 * basicSize}%` }}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-text-muted">
                      <Fingerprint className="h-4 w-4 text-primary" />
                      <span>Tunnel identity</span>
                      <span className="font-mono text-primary">
                        {displayAddress}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-3">
                      <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground md:text-base">
                        {identityAddress}
                      </code>
                      <button
                        type="button"
                        onClick={handleAddressCopy}
                        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-background/70 text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
                        aria-label="Copy tunnel address"
                        title={addressCopied ? "Copied" : "Copy tunnel address"}
                      >
                        {addressCopied ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SsgoiTransition>
  );
}
