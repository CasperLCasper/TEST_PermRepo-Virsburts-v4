# Līgumu izmaiņas v2 (nav kompilēts šajā vidē — kompilējiet un pārbaudiet Remix)

## PermRepoNFT (`60-1-PermRepoNFT.sol`, pragma 0.8.35)
| Izmaiņa | Kāpēc |
|---|---|
| `revokeRepository(uint256 tokenId)` (`onlyOwner`, tikai ja `backupCount == 0`) + notikums `RepositoryRevoked` | C-01: atbrīvo repozitorija ID, ko aizņēmis neatļauts mint (kompromitēts signeris). Nevar iznīcināt reālu backup vēsturi. |
| `addBackup` izmanto `SignatureChecker.isValidSignatureNow` (ECDSA **un** ERC-1271) | C-03: viedie maki (Safe, Coinbase Smart Wallet) var parakstīt backup. |
| Miruša pārbaude `owner == address(0)` noņemta | `ownerOf` pats atgriež kļūdu neesošam tokenam. |

`RestorePageURIUpdated` notikums jau pastāv — izmaiņu nav.

## PermRepoSubscription (`10-PermRepo-Subscription.sol`, pragma 0.8.35)
| Izmaiņa | Kāpēc |
|---|---|
| `subscribeWithMaxPrice(bytes32, uint256)`; `subscribe` paliek nemainīta | C-07: lietotājs ierobežo maksimālo cenu. |
| Dokumentācija: hash = `keccak256(abi.encode(GitHub user ID))` | Komentārs runāja par username. |
| Vienota pragma ar NFT līgumu | C-06. |

## Remix pārbaudes saraksts (testnet)
1. NFT: mint → `addBackup` ar parastu maku (jāizdodas).
2. NFT: `revokeRepository(tokenId)` ar owner, kad `backupCount == 0` → jāizdodas; `getTokenIdByRepo` = 0; mint tam pašam repo atkal jāizdodas.
3. NFT: `revokeRepository` pēc pirmā backup → `BackupsExist`; ne-owner → `OwnableUnauthorizedAccount`.
4. NFT: `addBackup` ar viedā maka parakstu (ERC-1271), ja iespējams.
5. Abonements: `subscribeWithMaxPrice(hash, price)` ar pareizu cenu → izdodas; pēc `setPrice` uz augstāku → `PriceTooHigh`.
6. Servera `.env`: `SUBSCRIPTION_SUPPORTS_MAX_PRICE=true` tikai pēc jaunā abonementa līguma izvietošanas.
