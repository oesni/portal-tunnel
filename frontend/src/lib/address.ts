export function normalizeAddress(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function compactAddress(
  value: string | undefined | null,
  leading: number = 8,
  trailing: number = 6
): string {
  const address = normalizeAddress(value);
  if (address.length <= leading + trailing + 3) {
    return address;
  }

  return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
}
