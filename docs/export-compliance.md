# Export compliance (App Store encryption question)

Status: **keep `ITSAppUsesNonExemptEncryption: false`** (decided Oct 21, 2026).
Revisit before Gate E (App Store approval, Feb 19) if anything below changes.
This is an engineering summary, not legal advice.

## What the app does with cryptography

| Thing | Where | Counts as the app's own encryption? |
| --- | --- | --- |
| HTTPS for map tiles (`server.arcgisonline.com`) | iOS networking | No. Encryption provided by the OS is exempt. |
| Bluetooth link to the radio | iOS Bluetooth stack | No. OS-provided. |
| Crew key generation (`expo-crypto` `getRandomBytes`) | phone | No. Generating random bytes isn't encryption. |
| Sending the crew key to the radio | phone → radio over Bluetooth | No. The phone only stores and forwards key bytes. |
| AES encryption of crew messages | **the radio's firmware** | Not in the app binary. The phone never encrypts or decrypts. |

The app binary contains no encryption algorithm of its own and calls none
outside the OS. That is the case `ITSAppUsesNonExemptEncryption = false`
covers, so TestFlight and App Store uploads skip the encryption questionnaire.

## When to change the answer

Change it (and redo this note) if the phone itself starts encrypting or
decrypting, for example:
- the app decrypts mesh packets itself (a phone-side Meshtastic decoder);
- end-to-end encrypted direct messages computed on the phone;
- any crypto library added for anything other than random numbers or hashing.

Even then, RNDVU would use standard algorithms (AES) in a mass-market consumer
app. That is normally the exempt mass-market category: answer "yes, uses
encryption" and "exempt" in App Store Connect rather than needing an export
license. Check the current Apple and US export-control guidance at that point.

## If App Review asks

Short answer: "RNDVU configures a separate LoRa radio over Bluetooth. Message
encryption happens in the radio's open-source Meshtastic firmware, not in the
app. The app uses only encryption provided by iOS (HTTPS, Bluetooth, and the
Multipeer Connectivity link used to start Ultra Wideband finding)."

Precise finding (Ultra Wideband) asks iOS's Multipeer Connectivity for an
encrypted phone-to-phone link (`encryptionPreference: .required`) to swap the
Nearby Interaction tokens. That's encryption provided by the operating system,
like HTTPS, so the answer above doesn't change.
