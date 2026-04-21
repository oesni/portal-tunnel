package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/spruceid/siwe-go"

	"github.com/gosuda/portal-tunnel/v2/utils"
)

var (
	ErrSIWEInvalidMessage   = errors.New("siwe message is invalid")
	ErrSIWEInvalidSignature = errors.New("siwe signature is invalid")
)

type SIWEChallenge struct {
	ChallengeID string
	ExpiresAt   time.Time
	Message     string
}

type SIWEVerification struct {
	Address   string
	RequestID string
}

func NewSIWEChallenge(address, domain, uri, statement string, now time.Time, ttl time.Duration) (SIWEChallenge, error) {
	address, err := utils.NormalizeEVMAddress(address)
	if err != nil {
		return SIWEChallenge{}, err
	}

	issuedAt := now.UTC().Truncate(time.Second)
	expiresAt := issuedAt.Add(ttl)
	challengeID := utils.RandomID("siwe_")
	message, err := siwe.InitMessage(domain, address, uri, siwe.GenerateNonce(), map[string]interface{}{
		"statement":      statement,
		"chainId":        1,
		"issuedAt":       issuedAt.Format(time.RFC3339),
		"expirationTime": expiresAt.Format(time.RFC3339),
		"requestId":      challengeID,
	})
	if err != nil {
		return SIWEChallenge{}, fmt.Errorf("build siwe message: %w", err)
	}

	return SIWEChallenge{
		ChallengeID: challengeID,
		ExpiresAt:   expiresAt,
		Message:     message.String(),
	}, nil
}

func VerifySIWEMessage(rawMessage, signature string, now time.Time) (SIWEVerification, error) {
	message, err := siwe.ParseMessage(strings.TrimSpace(rawMessage))
	if err != nil {
		return SIWEVerification{}, ErrSIWEInvalidMessage
	}
	domain := message.GetDomain()
	nonce := message.GetNonce()
	verifiedAt := now.UTC()
	if _, err := message.Verify(strings.TrimSpace(signature), &domain, &nonce, &verifiedAt); err != nil {
		return SIWEVerification{}, ErrSIWEInvalidSignature
	}
	address, err := utils.NormalizeEVMAddress(message.GetAddress().Hex())
	if err != nil {
		return SIWEVerification{}, err
	}
	requestID := ""
	if value := message.GetRequestID(); value != nil {
		requestID = strings.TrimSpace(*value)
	}
	return SIWEVerification{
		Address:   address,
		RequestID: requestID,
	}, nil
}
