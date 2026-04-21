---
title: Admin API
description: Portal relay admin endpoints for managing leases, settings, and access control.
---

<script>
import Mermaid from '$lib/components/Mermaid.svelte'

const adminWorkflowDiagram = `sequenceDiagram
    participant Admin
    participant Relay as Portal Relay
    Admin->>Relay: POST /auth/siwe/challenge
    Relay->>Admin: SIWE message
    Admin->>Relay: POST /auth/siwe/verify
    Relay->>Admin: Set-Cookie portal_session
    Admin->>Relay: GET /admin/snapshot
    Relay->>Admin: Full relay state
    Note left of Relay: leases, settings, bans
    alt Manage Leases
        Admin->>Relay: POST /admin/leases/.../ban
        Relay->>Admin: OK
    end
    alt Configure Settings
        Admin->>Relay: POST /admin/settings
        Relay->>Admin: Updated settings
    end
    Admin->>Relay: POST /auth/logout
    Relay->>Admin: Wallet session cleared`
</script>

# Admin API

These endpoints allow relay operators to manage leases, configure settings, and control access. Protected admin endpoints require a wallet session whose address matches the relay admin address.

## Admin Workflow

<Mermaid code={adminWorkflowDiagram} />

---

## Authentication

Admin uses the wallet SIWE session from `/auth/*`. A wallet is an admin only when its address matches `admin_address` in `IDENTITY_PATH/admin_settings.json`.

---

## State

### `GET /admin/snapshot`

Get a full snapshot of the relay's current state including all active leases, approval mode, and transport settings.

**Auth:** Admin Wallet Session

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `approval_mode` | `string` | Current mode: `"auto"` or `"manual"` |
| `landing_page_enabled` | `bool` | Whether the landing page is active |
| `leases` | `AdminLease[]` | All active leases (see below) |
| `udp` | `object` | UDP settings |
| `udp.enabled` | `bool` | Whether UDP transport is enabled |
| `udp.max_leases` | `int` | Maximum concurrent UDP leases (0 = unlimited) |
| `tcp_port` | `object` | TCP port settings |
| `tcp_port.enabled` | `bool` | Whether TCP port transport is enabled |
| `tcp_port.max_leases` | `int` | Maximum concurrent TCP port leases (0 = unlimited) |

**AdminLease fields:**

| Field | Type | Description |
|-------|------|-------------|
| `identity_key` | `string` | Unique identity key |
| `address` | `string` | Ethereum address |
| `name` | `string` | Lease name |
| `hostname` | `string` | Assigned hostname |
| `expires_at` | `string` | ISO 8601 lease expiration |
| `first_seen_at` | `string` | ISO 8601 first registration time |
| `last_seen_at` | `string` | ISO 8601 last activity time |
| `client_ip` | `string` | Client IP address |
| `reported_ip` | `string` | Client-reported public IP |
| `udp_addr` | `string` | UDP transport address |
| `tcp_addr` | `string` | TCP transport address |
| `metadata` | `object` | Lease metadata (description, tags, thumbnail) |
| `ready` | `int` | Number of ready reverse connections |
| `bps` | `int` | Bandwidth limit in bytes per second (0 = unlimited) |

**Example:**

```bash
curl https://relay.example.com/admin/snapshot \
  -b cookies.txt
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "approval_mode": "auto",
    "landing_page_enabled": true,
    "leases": [
      {
        "identity_key": "my-app:0x1234...5678",
        "address": "0x1234...5678",
        "name": "my-app",
        "hostname": "my-app.relay.example.com",
        "expires_at": "2025-01-01T00:01:00Z",
        "first_seen_at": "2025-01-01T00:00:00Z",
        "last_seen_at": "2025-01-01T00:00:30Z",
        "client_ip": "203.0.113.1",
        "ready": 2,
        "bps": 0
      }
    ],
    "udp": {
      "enabled": true,
      "max_leases": 10
    },
    "tcp_port": {
      "enabled": false,
      "max_leases": 0
    }
  }
}
```

---

## Settings

### `POST /admin/settings`

Update relay settings. Fields are optional; omitted fields keep their current values.

**Auth:** Admin Wallet Session

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `approval_mode` | `string` | No | `"auto"` or `"manual"` |
| `landing_page_enabled` | `bool` | No | Show or hide the relay landing page |
| `udp.enabled` | `bool` | No | Enable or disable UDP transport |
| `udp.max_leases` | `int` | No | Maximum concurrent UDP leases (0 = unlimited) |
| `tcp_port.enabled` | `bool` | No | Enable or disable TCP port transport |
| `tcp_port.max_leases` | `int` | No | Maximum concurrent TCP port leases (0 = unlimited) |

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `approval_mode` | `string` | Current approval mode |
| `landing_page_enabled` | `bool` | Current landing page state |
| `udp` | `object` | Current UDP settings |
| `tcp_port` | `object` | Current TCP port settings |

**Error codes:**

| Code | Status | Description |
|------|--------|-------------|
| `invalid_mode` | 400 | Mode must be `"auto"` or `"manual"` |
| `invalid_request` | 400 | `max_leases` must be non-negative |

**Example:**

```bash
curl -X POST https://relay.example.com/admin/settings \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "approval_mode": "manual",
    "landing_page_enabled": true,
    "udp": { "enabled": true, "max_leases": 10 },
    "tcp_port": { "enabled": false, "max_leases": 0 }
  }'
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "approval_mode": "manual",
    "landing_page_enabled": true,
    "udp": { "enabled": true, "max_leases": 10 },
    "tcp_port": { "enabled": false, "max_leases": 0 }
  }
}
```

---

## Lease Management

Lease management endpoints use base64url-encoded identity components in the URL path:

```
/admin/leases/{name_b64}/{addr_b64}/{action}
```

Where `{name_b64}` is the base64url-encoded lease name and `{addr_b64}` is the base64url-encoded Ethereum address.

All lease management endpoints return an empty data object on success. All changes are persisted to the admin state file.

### `POST|DELETE /admin/leases/{name}/{addr}/ban`

Ban or unban a lease identity. Banned identities cannot register new leases or renew existing ones.

**Auth:** Admin Wallet Session

| Method | Description |
|--------|-------------|
| `POST` | Ban the identity |
| `DELETE` | Remove the ban |

**Example:**

```bash
# Ban an identity
curl -X POST https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/ban \
  -b cookies.txt

# Unban an identity
curl -X DELETE https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/ban \
  -b cookies.txt
```

---

### `POST|DELETE /admin/leases/{name}/{addr}/bps`

Set or remove a bandwidth limit (bytes per second) for a specific lease identity.

**Auth:** Admin Wallet Session

| Method | Description |
|--------|-------------|
| `POST` | Set bandwidth limit |
| `DELETE` | Remove bandwidth limit |

**Request body (POST only):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bps` | `int` | Yes | Bandwidth limit in bytes per second (must be > 0) |

**Error codes:**

| Code | Status | Description |
|------|--------|-------------|
| `invalid_request` | 400 | `bps` must be greater than zero |

**Example:**

```bash
# Set 1 MB/s bandwidth limit
curl -X POST https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/bps \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{ "bps": 1048576 }'

# Remove bandwidth limit
curl -X DELETE https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/bps \
  -b cookies.txt
```

---

### `POST|DELETE /admin/leases/{name}/{addr}/approve`

Approve or revoke approval for a lease identity. Only relevant when approval mode is `manual`.

**Auth:** Admin Wallet Session

| Method | Description |
|--------|-------------|
| `POST` | Approve the identity (also removes any deny) |
| `DELETE` | Revoke approval |

**Example:**

```bash
# Approve an identity
curl -X POST https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/approve \
  -b cookies.txt

# Revoke approval
curl -X DELETE https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/approve \
  -b cookies.txt
```

---

### `POST|DELETE /admin/leases/{name}/{addr}/deny`

Deny or remove denial for a lease identity. Denied identities are blocked from routing even in `auto` mode.

**Auth:** Admin Wallet Session

| Method | Description |
|--------|-------------|
| `POST` | Deny the identity |
| `DELETE` | Remove the denial |

**Example:**

```bash
# Deny an identity
curl -X POST https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/deny \
  -b cookies.txt

# Remove denial
curl -X DELETE https://relay.example.com/admin/leases/bXktYXBw/MHgxMjM0/deny \
  -b cookies.txt
```

---

## IP Management

### `POST|DELETE /admin/ips/{ip}/ban`

Ban or unban an IP address. Banned IPs are rejected at the SDK registration and renewal endpoints.

**Auth:** Admin Wallet Session

| Method | Description |
|--------|-------------|
| `POST` | Ban the IP address |
| `DELETE` | Unban the IP address |

**Error codes:**

| Code | Status | Description |
|------|--------|-------------|
| `invalid_ip` | 400 | Invalid IP address format |

**Example:**

```bash
# Ban an IP
curl -X POST https://relay.example.com/admin/ips/203.0.113.50/ban \
  -b cookies.txt

# Unban an IP
curl -X DELETE https://relay.example.com/admin/ips/203.0.113.50/ban \
  -b cookies.txt
```

**Response:**

```json
{
  "ok": true,
  "data": {}
}
```
