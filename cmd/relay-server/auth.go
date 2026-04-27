package main

import (
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	portalauth "github.com/gosuda/portal-tunnel/v2/portal/auth"
	"github.com/gosuda/portal-tunnel/v2/portal/policy"
	"github.com/gosuda/portal-tunnel/v2/types"
	"github.com/gosuda/portal-tunnel/v2/utils"
)

const (
	adminBodyLimit     = 1 << 16
	walletCookieName   = "portal_session"
	walletChallengeTTL = 5 * time.Minute
	walletCookieTTL    = 24 * time.Hour
)

type walletChallenge = portalauth.SIWEChallenge

func (f *Frontend) serveAuth(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(strings.TrimSpace(r.URL.Path), "/")
	if path == "" {
		path = types.PathRoot
	}

	switch path {
	case types.PathAuthSIWEChallenge:
		if !utils.RequireMethod(w, r, http.MethodPost) {
			return
		}
		req, ok := utils.DecodeJSONRequestAs[types.SIWEChallengeRequest](w, r, adminBodyLimit, utils.InvalidRequestError(errors.New("invalid request body")))
		if !ok {
			return
		}

		scheme := "https"
		if r.TLS == nil {
			scheme = "http"
		}
		domain := strings.TrimSpace(r.Host)
		if domain == "" && f.server != nil {
			if relayURL, err := url.Parse(f.server.PortalURL()); err == nil {
				domain = relayURL.Host
			}
		}
		uri := (&url.URL{
			Scheme: scheme,
			Host:   domain,
			Path:   types.PathAuthSIWEVerify,
		}).String()

		challenge, err := portalauth.NewSIWEChallenge(req.Address, domain, uri, "Sign in to Portal", time.Now().UTC(), walletChallengeTTL)
		if err != nil {
			utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidAddress, err.Error())
			return
		}
		f.storeWalletChallenge(challenge)
		utils.WriteAPIData(w, http.StatusCreated, types.SIWEChallengeResponse{
			ChallengeID: challenge.ChallengeID,
			ExpiresAt:   challenge.ExpiresAt,
			SIWEMessage: challenge.Message,
		})
	case types.PathAuthSIWEVerify:
		if !utils.RequireMethod(w, r, http.MethodPost) {
			return
		}
		req, ok := utils.DecodeJSONRequestAs[types.AuthSIWEVerifyRequest](w, r, adminBodyLimit, utils.InvalidRequestError(errors.New("invalid request body")))
		if !ok {
			return
		}

		challengeID := strings.TrimSpace(req.ChallengeID)
		if challengeID == "" {
			utils.WriteAPIError(w, http.StatusUnauthorized, types.APIErrorCodeUnauthorized, "challenge id is required")
			return
		}
		now := time.Now().UTC()
		challenge, ok := f.loadWalletChallenge(challengeID, now)
		if !ok {
			utils.WriteAPIError(w, http.StatusUnauthorized, types.APIErrorCodeUnauthorized, "challenge not found")
			return
		}
		siweMessage := strings.TrimSpace(req.SIWEMessage)
		if siweMessage == "" || siweMessage != challenge.Message {
			utils.WriteAPIError(w, http.StatusUnauthorized, types.APIErrorCodeUnauthorized, "challenge not found")
			return
		}
		verified, err := portalauth.VerifySIWEMessage(challenge.Message, req.SIWESignature, now)
		if err != nil {
			utils.WriteAPIError(w, http.StatusUnauthorized, types.APIErrorCodeUnauthorized, err.Error())
			return
		}
		if verified.RequestID != challengeID {
			utils.WriteAPIError(w, http.StatusUnauthorized, types.APIErrorCodeUnauthorized, "challenge not found")
			return
		}
		f.deleteWalletChallenge(challengeID)
		signature := strings.TrimSpace(req.SIWESignature)
		http.SetCookie(w, &http.Cookie{
			Name:     walletCookieName,
			Value:    base64.RawURLEncoding.EncodeToString([]byte(siweMessage)) + "." + base64.RawURLEncoding.EncodeToString([]byte(signature)),
			Path:     types.PathRoot,
			HttpOnly: true,
			Secure:   walletCookieSecure(r),
			SameSite: http.SameSiteStrictMode,
			MaxAge:   int(walletCookieTTL / time.Second),
		})
		utils.WriteAPIData(w, http.StatusOK, f.authSessionResponse(true, verified.Address))
	case types.PathAuthSession:
		if !utils.RequireMethod(w, r, http.MethodGet) {
			return
		}
		address, ok := f.currentWalletAddress(r)
		if !ok {
			utils.WriteAPIData(w, http.StatusOK, f.authSessionResponse(false, ""))
			return
		}
		utils.WriteAPIData(w, http.StatusOK, f.authSessionResponse(true, address))
	case types.PathAuthLogout:
		if !utils.RequireMethod(w, r, http.MethodPost) {
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name:     walletCookieName,
			Value:    "",
			Path:     types.PathRoot,
			HttpOnly: true,
			Secure:   walletCookieSecure(r),
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
		})
		utils.WriteAPIData(w, http.StatusOK, map[string]any{})
	case types.PathAuthLeases:
		if !utils.RequireMethod(w, r, http.MethodGet) {
			return
		}
		address, ok := f.currentWalletAddress(r)
		if !ok {
			utils.WriteAPIError(w, http.StatusUnauthorized, types.APIErrorCodeUnauthorized, "unauthorized")
			return
		}
		leases := f.server.AccountLeases(address)
		f.attachAutomaticThumbnails(leases)
		utils.WriteAPIData(w, http.StatusOK, leases)
	default:
		http.NotFound(w, r)
	}
}

func (f *Frontend) serveAdmin(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(strings.TrimSpace(r.URL.Path), "/")
	if path == "" {
		path = types.PathRoot
	}

	switch path {
	case types.PathAdmin:
		if r.Method == http.MethodGet {
			f.ServeAppStatic(w, r, "")
			return
		}
		http.NotFound(w, r)
		return
	}

	address, ok := f.currentWalletAddress(r)
	if !ok || !f.isRelayWallet(address) {
		utils.WriteAPIError(w, http.StatusUnauthorized, types.APIErrorCodeUnauthorized, "unauthorized")
		return
	}

	runtime := f.server.PolicyRuntime()
	methodNotAllowed := utils.MethodNotAllowedError()
	invalidRequestBody := utils.InvalidRequestError(errors.New("invalid request body"))

	switch path {
	case types.PathAdminSnapshot:
		if !utils.RequireMethod(w, r, http.MethodGet) {
			return
		}
		leases := f.server.AdminLeases()
		f.attachAutomaticAdminThumbnails(leases)
		utils.WriteAPIData(w, http.StatusOK, types.AdminSnapshotResponse{
			ApprovalMode:       string(runtime.Approver().Mode()),
			LandingPageEnabled: f.isLandingPageEnabled(),
			Leases:             leases,
			UDP: types.AdminPortSettings{
				Enabled:   runtime.IsUDPEnabled(),
				MaxLeases: runtime.UDPMaxLeases(),
			},
			TCPPort: types.AdminPortSettings{
				Enabled:   runtime.IsTCPPortEnabled(),
				MaxLeases: runtime.TCPPortMaxLeases(),
			},
		})
	case types.PathAdminSettings:
		if !utils.RequireMethod(w, r, http.MethodPost) {
			return
		}
		req, ok := utils.DecodeJSONRequestAs[types.AdminSettingsRequest](w, r, adminBodyLimit, invalidRequestBody)
		if !ok {
			return
		}
		if mode := strings.TrimSpace(req.ApprovalMode); mode != "" {
			if err := runtime.Approver().SetMode(policy.Mode(mode)); err != nil {
				utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidMode, "invalid mode (must be 'auto' or 'manual')")
				return
			}
		}
		if req.LandingPageEnabled != nil {
			f.setLandingPageEnabled(*req.LandingPageEnabled)
		}
		if req.UDP != nil {
			if req.UDP.MaxLeases < 0 {
				utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidRequest, "udp.max_leases must be non-negative")
				return
			}
			runtime.SetUDPPolicy(req.UDP.Enabled, req.UDP.MaxLeases)
		}
		if req.TCPPort != nil {
			if req.TCPPort.MaxLeases < 0 {
				utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidRequest, "tcp_port.max_leases must be non-negative")
				return
			}
			runtime.SetTCPPortPolicy(req.TCPPort.Enabled, req.TCPPort.MaxLeases)
		}
		f.saveAdminState(runtime)
		utils.WriteAPIData(w, http.StatusOK, types.AdminSettingsResponse{
			ApprovalMode:       string(runtime.Approver().Mode()),
			LandingPageEnabled: f.isLandingPageEnabled(),
			UDP: types.AdminPortSettings{
				Enabled:   runtime.IsUDPEnabled(),
				MaxLeases: runtime.UDPMaxLeases(),
			},
			TCPPort: types.AdminPortSettings{
				Enabled:   runtime.IsTCPPortEnabled(),
				MaxLeases: runtime.TCPPortMaxLeases(),
			},
		})
	default:
		switch {
		case strings.HasPrefix(path, types.PathAdminLeasesPrefix):
			rest := strings.TrimPrefix(path, types.PathAdminLeasesPrefix)
			parts := strings.Split(rest, "/")
			if len(parts) != 3 {
				http.NotFound(w, r)
				return
			}

			name, err := utils.DecodeBase64URLString(parts[0])
			if err != nil {
				utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidRequest, "invalid identity")
				return
			}
			address, err := utils.DecodeBase64URLString(parts[1])
			if err != nil {
				utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidAddress, "invalid address")
				return
			}
			identity, err := utils.NormalizeIdentity(types.Identity{
				Name:    name,
				Address: address,
			})
			if err != nil {
				utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidRequest, "invalid identity")
				return
			}
			identityKey := identity.Key()
			approver := runtime.Approver()

			type identityAction struct {
				post   func() bool // returns true if response was already written (error path)
				delete func()
			}
			actions := map[string]identityAction{
				"ban": {
					post:   func() bool { runtime.BanIdentity(identityKey); return false },
					delete: func() { runtime.UnbanIdentity(identityKey) },
				},
				"bps": {
					post: func() bool {
						req, ok := utils.DecodeJSONRequestAs[types.AdminBPSRequest](w, r, adminBodyLimit, invalidRequestBody)
						if !ok {
							return true
						}
						if req.BPS <= 0 {
							utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidRequest, "bps must be greater than zero")
							return true
						}
						runtime.BPSManager().SetIdentityBPS(identityKey, req.BPS)
						return false
					},
					delete: func() { runtime.BPSManager().DeleteIdentityBPS(identityKey) },
				},
				"approve": {
					post:   func() bool { approver.Approve(identityKey); approver.Undeny(identityKey); return false },
					delete: func() { approver.Revoke(identityKey) },
				},
				"deny": {
					post:   func() bool { approver.Deny(identityKey); return false },
					delete: func() { approver.Undeny(identityKey) },
				},
			}

			action, ok := actions[parts[2]]
			if !ok {
				http.NotFound(w, r)
				return
			}
			switch r.Method {
			case http.MethodPost:
				if action.post() {
					return
				}
			case http.MethodDelete:
				action.delete()
			default:
				methodNotAllowed.Write(w)
				return
			}
			f.saveAdminState(runtime)
			utils.WriteAPIData(w, http.StatusOK, map[string]any{})
		case strings.HasPrefix(path, types.PathAdminIPsPrefix):
			if !strings.HasSuffix(path, "/ban") {
				http.NotFound(w, r)
				return
			}

			rawIP := strings.TrimSuffix(strings.TrimPrefix(path, types.PathAdminIPsPrefix), "/ban")
			rawIP = strings.Trim(rawIP, "/")
			if net.ParseIP(rawIP) == nil {
				utils.WriteAPIError(w, http.StatusBadRequest, types.APIErrorCodeInvalidIP, "invalid IP address")
				return
			}

			filter := runtime.IPFilter()
			switch r.Method {
			case http.MethodPost:
				filter.BanIP(rawIP)
			case http.MethodDelete:
				filter.UnbanIP(rawIP)
			default:
				methodNotAllowed.Write(w)
				return
			}
			f.saveAdminState(runtime)
			utils.WriteAPIData(w, http.StatusOK, map[string]any{})
		default:
			http.NotFound(w, r)
		}
	}
}

func (f *Frontend) currentWalletAddress(r *http.Request) (string, bool) {
	if f == nil {
		return "", false
	}
	cookie, err := r.Cookie(walletCookieName)
	if err != nil {
		return "", false
	}
	messagePart, signaturePart, ok := strings.Cut(strings.TrimSpace(cookie.Value), ".")
	if !ok || messagePart == "" || signaturePart == "" {
		return "", false
	}
	messageBytes, err := base64.RawURLEncoding.DecodeString(messagePart)
	if err != nil {
		return "", false
	}
	signatureBytes, err := base64.RawURLEncoding.DecodeString(signaturePart)
	if err != nil {
		return "", false
	}
	verified, err := portalauth.VerifySIWEMessage(string(messageBytes), string(signatureBytes), time.Now().UTC())
	return verified.Address, err == nil
}

func (f *Frontend) authSessionResponse(authenticated bool, address string) types.AuthSessionResponse {
	address = strings.TrimSpace(address)
	relayAddress := strings.TrimSpace(f.relayAddress)
	relayOwner := authenticated && f.isRelayWallet(address)
	return types.AuthSessionResponse{
		Authenticated: authenticated,
		Address:       address,
		RelayAddress:  relayAddress,
		IsAdmin:       relayOwner,
		IsRelayOwner:  relayOwner,
	}
}

func (f *Frontend) storeWalletChallenge(challenge walletChallenge) {
	if f == nil || challenge.ChallengeID == "" {
		return
	}
	now := time.Now().UTC()
	f.walletChallengeMu.Lock()
	defer f.walletChallengeMu.Unlock()
	if f.walletChallenges == nil {
		f.walletChallenges = make(map[string]walletChallenge)
	}
	f.cleanupExpiredWalletChallengesLocked(now)
	f.walletChallenges[challenge.ChallengeID] = challenge
}

func (f *Frontend) loadWalletChallenge(challengeID string, now time.Time) (walletChallenge, bool) {
	if f == nil || strings.TrimSpace(challengeID) == "" {
		return walletChallenge{}, false
	}
	f.walletChallengeMu.Lock()
	defer f.walletChallengeMu.Unlock()
	f.cleanupExpiredWalletChallengesLocked(now)
	challenge, ok := f.walletChallenges[strings.TrimSpace(challengeID)]
	return challenge, ok
}

func (f *Frontend) deleteWalletChallenge(challengeID string) {
	if f == nil || strings.TrimSpace(challengeID) == "" {
		return
	}
	f.walletChallengeMu.Lock()
	defer f.walletChallengeMu.Unlock()
	delete(f.walletChallenges, strings.TrimSpace(challengeID))
}

func (f *Frontend) cleanupExpiredWalletChallengesLocked(now time.Time) {
	for challengeID, challenge := range f.walletChallenges {
		if now.After(challenge.ExpiresAt) {
			delete(f.walletChallenges, challengeID)
		}
	}
}

func walletCookieSecure(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func (f *Frontend) isRelayWallet(address string) bool {
	if f == nil {
		return false
	}
	relayAddress := strings.TrimSpace(f.relayAddress)
	if relayAddress == "" {
		return false
	}
	normalized, err := utils.NormalizeEVMAddress(address)
	return err == nil && normalized == relayAddress
}

func (f *Frontend) saveAdminState(runtime *policy.Runtime) {
	if f == nil {
		return
	}
	path := strings.TrimSpace(f.adminSettingsPath)
	if path == "" {
		return
	}

	approver := runtime.Approver()
	udpEnabled := runtime.IsUDPEnabled()
	udpMaxLeases := runtime.UDPMaxLeases()
	tcpPortEnabled := runtime.IsTCPPortEnabled()
	tcpPortMaxLeases := runtime.TCPPortMaxLeases()
	landingPageEnabled := f.isLandingPageEnabled()
	payload := persistedAdminState{
		ApprovalMode:         string(approver.Mode()),
		ApprovedIdentityKeys: approver.ApprovedKeys(),
		DeniedIdentityKeys:   approver.DeniedKeys(),
		BannedIdentityKeys:   runtime.BannedIdentityKeys(),
		BannedIPs:            runtime.IPFilter().BannedIPs(),
		IdentityBPS:          runtime.BPSManager().IdentityBPSLimits(),
		UDPEnabled:           &udpEnabled,
		UDPMaxLeases:         &udpMaxLeases,
		TCPPortEnabled:       &tcpPortEnabled,
		TCPPortMaxLeases:     &tcpPortMaxLeases,
		LandingPageEnabled:   &landingPageEnabled,
	}
	_ = utils.WriteJSONFile(path, payload, 0o600)
}

func loadAdminState(path string, runtime *policy.Runtime) (persistedAdminState, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return persistedAdminState{}, nil
	}

	var payload persistedAdminState
	if _, err := utils.ReadJSONFileIfExists(path, &payload); err != nil {
		return persistedAdminState{}, err
	}
	if runtime == nil {
		return payload, nil
	}
	if mode := strings.TrimSpace(payload.ApprovalMode); mode != "" {
		if err := runtime.Approver().SetMode(policy.Mode(mode)); err != nil {
			return persistedAdminState{}, err
		}
	}
	runtime.Approver().SetDecisions(
		utils.NormalizeIdentityKeys(payload.ApprovedIdentityKeys),
		utils.NormalizeIdentityKeys(payload.DeniedIdentityKeys),
	)
	runtime.SetBannedIdentityKeys(utils.NormalizeIdentityKeys(payload.BannedIdentityKeys))
	runtime.IPFilter().SetBannedIPs(payload.BannedIPs)
	runtime.BPSManager().SetIdentityBPSLimits(utils.NormalizeIdentityKeyBPS(payload.IdentityBPS))
	if payload.UDPEnabled != nil || payload.UDPMaxLeases != nil {
		enabled := runtime.IsUDPEnabled()
		maxLeases := runtime.UDPMaxLeases()
		if payload.UDPEnabled != nil {
			enabled = *payload.UDPEnabled
		}
		if payload.UDPMaxLeases != nil {
			maxLeases = *payload.UDPMaxLeases
		}
		runtime.SetUDPPolicy(enabled, maxLeases)
	}
	if payload.TCPPortEnabled != nil || payload.TCPPortMaxLeases != nil {
		enabled := runtime.IsTCPPortEnabled()
		maxLeases := runtime.TCPPortMaxLeases()
		if payload.TCPPortEnabled != nil {
			enabled = *payload.TCPPortEnabled
		}
		if payload.TCPPortMaxLeases != nil {
			maxLeases = *payload.TCPPortMaxLeases
		}
		runtime.SetTCPPortPolicy(enabled, maxLeases)
	}
	return payload, nil
}

type persistedAdminState struct {
	ApprovalMode         string           `json:"approval_mode"`
	ApprovedIdentityKeys []string         `json:"approved_identity_keys,omitempty"`
	DeniedIdentityKeys   []string         `json:"denied_identity_keys,omitempty"`
	BannedIdentityKeys   []string         `json:"banned_identity_keys,omitempty"`
	BannedIPs            []string         `json:"banned_ips,omitempty"`
	IdentityBPS          map[string]int64 `json:"identity_bps,omitempty"`
	UDPEnabled           *bool            `json:"udp_enabled,omitempty"`
	UDPMaxLeases         *int             `json:"udp_max_leases,omitempty"`
	TCPPortEnabled       *bool            `json:"tcp_port_enabled,omitempty"`
	TCPPortMaxLeases     *int             `json:"tcp_port_max_leases,omitempty"`
	LandingPageEnabled   *bool            `json:"landing_page_enabled,omitempty"`
}
