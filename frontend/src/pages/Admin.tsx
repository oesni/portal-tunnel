import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SsgoiTransition } from "@ssgoi/react";
import {
  Check,
  Copy,
  Loader2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Header } from "@/components/Header";
import { useAdmin } from "@/hooks/useAdmin";
import { useWalletAuth } from "@/hooks/useWalletAuth";
import { ServerListView } from "@/components/ServerListView";
import { compactAddress, normalizeAddress } from "@/lib/address";

export function Admin() {
  const navigate = useNavigate();
  const wallet = useWalletAuth();
  const loadAdmin = !wallet.isLoading && wallet.isAdmin;
  const relayIdentityAddress = normalizeAddress(wallet.relayAddress);
  const relayIdentityLabel = compactAddress(relayIdentityAddress);
  const [relayAddressCopied, setRelayAddressCopied] = useState(false);

  const admin = useAdmin(loadAdmin);

  const handleLogout = async () => {
    await wallet.logout();
    navigate("/admin", { replace: true });
  };

  const handleWalletSignIn = async () => {
    if (wallet.isSigningIn || wallet.isLoading) {
      return;
    }
    try {
      await wallet.signIn();
    } catch {
      // useWalletAuth owns the user-facing error message.
    }
  };

  const handleRelayAddressCopy = async () => {
    if (!relayIdentityAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(relayIdentityAddress);
      setRelayAddressCopied(true);
      window.setTimeout(() => setRelayAddressCopied(false), 1600);
    } catch (error) {
      console.error("Failed to copy relay address", error);
    }
  };

  const relayIdentityPanel = relayIdentityAddress ? (
    <div className="w-full rounded-lg border border-border/70 bg-secondary/50 px-3 py-3 text-left">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
        <span className="font-mono text-primary">{relayIdentityLabel}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
          {relayIdentityAddress}
        </code>
        <button
          type="button"
          onClick={handleRelayAddressCopy}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors hover:bg-background/70 hover:text-primary"
          aria-label="Copy relay address"
          title={relayAddressCopied ? "Copied" : "Copy relay address"}
        >
          {relayAddressCopied ? (
            <Check className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  ) : null;

  if (wallet.isLoading) {
    return <div className="p-8 text-foreground">Checking authentication...</div>;
  }

  if (!wallet.isAuthenticated || !wallet.isAdmin) {
    const walletBusy = wallet.isSigningIn || wallet.isLoading;
    const accessDenied = wallet.isAuthenticated && !wallet.isAdmin;

    return (
      <SsgoiTransition id={accessDenied ? "admin-denied" : "admin-access"}>
        <div className="relative flex h-auto min-h-screen w-full flex-col">
          <div className="flex h-full grow flex-col">
            <div className="flex flex-1 justify-center py-5">
              <div className="flex w-full max-w-6xl flex-1 flex-col px-4 md:px-8">
                <Header
                  title="PORTAL ADMIN"
                  isAdmin={true}
                  relayAddress={wallet.relayAddress}
                />

                <main className="flex flex-1 flex-col items-center justify-center py-16">
                  <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-xl bg-card p-8 text-center shadow-lg">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <ShieldCheck
                        className={
                          accessDenied
                            ? "h-10 w-10 text-destructive"
                            : "h-10 w-10 text-primary"
                        }
                      />
                      <h1 className="text-2xl font-bold text-foreground">
                        {accessDenied ? "Admin access denied" : "Wallet Access"}
                      </h1>
                    </div>

                    {accessDenied ? (
                      <>
                        <p className="text-sm text-text-muted">
                          {wallet.label || wallet.address} is not authorized
                          for this relay.
                        </p>
                        {relayIdentityPanel}
                        <button
                          type="button"
                          onClick={() => {
                            void handleLogout();
                          }}
                          className="flex h-12 w-full cursor-pointer items-center justify-center rounded-lg bg-primary text-base font-bold text-white transition-colors hover:bg-primary/90"
                        >
                          Sign out
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleWalletSignIn}
                          disabled={walletBusy}
                          className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary text-base font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {walletBusy ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Wallet className="h-5 w-5" />
                          )}
                          <span className="truncate">Connect Wallet</span>
                        </button>

                        {wallet.error && (
                          <div className="rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
                            {wallet.error}
                          </div>
                        )}

                        {relayIdentityPanel}
                      </>
                    )}
                  </div>
                </main>
              </div>
            </div>
          </div>
        </div>
      </SsgoiTransition>
    );
  }

  if (loadAdmin && admin.loading && admin.servers.length === 0) {
    return <div className="p-8 text-foreground">Loading...</div>;
  }
  if (loadAdmin && admin.error && admin.servers.length === 0) {
    return <div className="p-8 text-red-500">Error: {admin.error}</div>;
  }

  return (
    <SsgoiTransition id="admin">
      <ServerListView
        title="PORTAL ADMIN"
        searchQuery={admin.searchQuery}
        status={admin.status}
        sortBy={admin.sortBy}
        selectedTags={admin.selectedTags}
        availableTags={admin.availableTags}
        filteredServers={admin.filteredServers}
        favorites={admin.favorites}
        onSearchChange={admin.handleSearchChange}
        onStatusChange={admin.handleStatusChange}
        onSortByChange={admin.handleSortByChange}
        onTagToggle={admin.handleTagToggle}
        onToggleFavorite={admin.handleToggleFavorite}
        isAdmin={true}
        banFilter={admin.banFilter}
        approvalMode={admin.approvalMode}
        landingPageEnabled={admin.landingPageEnabled}
        udpSettings={admin.udpSettings}
        tcpPortSettings={admin.tcpPortSettings}
        onBanFilterChange={admin.handleBanFilterChange}
        onBanStatusChange={admin.handleBanStatus}
        onBPSChange={admin.handleBPSChange}
        onApprovalModeChange={admin.handleApprovalModeChange}
        onLandingPageEnabledChange={admin.handleLandingPageEnabledChange}
        onUDPSettingsChange={admin.handleUDPSettingsChange}
        onTCPPortSettingsChange={admin.handleTCPPortSettingsChange}
        onApproveStatusChange={admin.handleApproveStatus}
        onDenyStatusChange={admin.handleDenyStatus}
        onIPBanStatusChange={admin.handleIPBanStatus}
        onBulkApprove={admin.handleBulkApprove}
        onBulkDeny={admin.handleBulkDeny}
        onBulkBan={admin.handleBulkBan}
        onLogout={handleLogout}
        relayAddress={wallet.relayAddress}
      />
    </SsgoiTransition>
  );
}
