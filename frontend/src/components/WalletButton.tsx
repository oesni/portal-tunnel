import { BadgeCheck, Loader2, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWalletAuth } from "@/hooks/useWalletAuth";

interface WalletButtonProps {
  onLogout?: () => void | Promise<void>;
}

export function WalletButton({ onLogout }: WalletButtonProps) {
  const wallet = useWalletAuth();
  const busy = wallet.isLoading || wallet.isSigningIn;
  const signedIn = wallet.isAuthenticated && wallet.address !== "";
  const label = signedIn ? wallet.label : "Wallet";

  const handleClick = () => {
    if (busy) {
      return;
    }
    if (signedIn) {
      return;
    }
    void wallet.signIn().catch(() => undefined);
  };

  const handleLogout = () => {
    if (busy) {
      return;
    }
    void (onLogout ? onLogout() : wallet.logout());
  };

  const tooltip = wallet.error
    ? wallet.error
    : signedIn
      ? "Wallet connected"
      : "Connect wallet";

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              onClick={handleClick}
              disabled={busy}
              className="h-12 max-w-44 cursor-pointer rounded-full border-border/70 bg-background/90 px-3 text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 data-[connected=true]:cursor-default data-[connected=true]:hover:translate-y-0 data-[connected=true]:hover:border-border/70 data-[connected=true]:hover:text-foreground"
              data-connected={signedIn}
              aria-label={tooltip}
            >
              {busy ? (
                <Loader2 className="h-4.5 w-4.5 animate-spin" />
              ) : signedIn ? (
                <BadgeCheck className="h-4.5 w-4.5 text-primary" />
              ) : (
                <Wallet className="h-4.5 w-4.5" />
              )}
              <span className="hidden max-w-28 overflow-hidden text-ellipsis whitespace-nowrap sm:inline">
                {busy ? "Wallet" : label}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>

        {signedIn && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleLogout}
                disabled={busy}
                className="h-12 w-12 cursor-pointer rounded-full border-border/70 bg-background/90 text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-destructive/40 hover:bg-background hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Sign out wallet"
              >
                <LogOut className="h-4.5 w-4.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sign out wallet</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
