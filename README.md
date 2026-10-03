# NAKA License Ed25519 Patch FINAL

### Vercel Production variable
Name: LICENSE_ED25519_PRIVATE_KEY_B64

Use the separate private-key file supplied with this patch. Never commit that value to GitHub or place it in Roblox.

### Roblox
Replace the installed LicenseSignature module with roblox/LicenseSignature.rbxm.

### Protocol
Canonical order: signatureVersion | valid(1/0) | ownerId | ownerType | product | universeId | status | issuedAt | expiresAt | requestNonce
Signature: lowercase Ed25519 hex, 128 characters.
The server echoes the exact requestNonce sent by LicenseClient.
