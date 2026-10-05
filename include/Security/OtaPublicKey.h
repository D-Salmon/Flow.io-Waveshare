#pragma once

// Provision the production ECDSA P-256 public key here. The matching private
// key must remain outside the firmware repository (CI secret/HSM/offline host).
// Empty by default: signed OTA uploads fail closed until a key is provisioned.
namespace OtaTrust {
inline constexpr char PublicKeyPem[] = "";
}
