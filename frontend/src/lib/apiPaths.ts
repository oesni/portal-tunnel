export const API_PATHS = {
  admin: {
    prefix: "/admin",
    snapshot: "/admin/snapshot",
    leases: "/admin/leases",

    settings: "/admin/settings",
  },
  auth: {
    session: "/auth/session",
    logout: "/auth/logout",
    siweChallenge: "/auth/siwe/challenge",
    siweVerify: "/auth/siwe/verify",
  },
  sdk: {
    prefix: "/sdk",
    register: "/sdk/register",
    unregister: "/sdk/unregister",
    renew: "/sdk/renew",
    domain: "/sdk/domain",
    connect: "/sdk/connect",
  },
  tunnel: {
    status: "/tunnel/status",
  },
  discovery: "/discovery",
  healthz: "/healthz",
  install: {
    shell: "/install.sh",
    powershell: "/install.ps1",
  },
  appPrefix: "/app/",
} as const;

export const ROUTE_PATHS = {
  home: "/",
  serverDetail: "/server/:id",
  admin: "/admin",
} as const;

export function encodePathPart(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function adminLeasePath(
  name: string,
  address: string,
  action: "ban" | "bps" | "approve" | "deny"
): string {
  const encodedName = encodePathPart(name);
  const encodedAddress = encodePathPart(address);
  return `${API_PATHS.admin.leases}/${encodeURIComponent(encodedName)}/${encodeURIComponent(encodedAddress)}/${action}`;
}

export function adminIPBanPath(ip: string): string {
  return `${API_PATHS.admin.prefix}/ips/${encodeURIComponent(ip.trim())}/ban`;
}
