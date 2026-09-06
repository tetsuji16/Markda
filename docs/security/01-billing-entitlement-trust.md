## 概要

有料スキンの「所持判定」がクライアント側が提示する `entitlements` 配列をそのまま信頼しており、改変クライアント（DevTools 等で entitlements を書き換え）により任意の有料スキンを無料で解除できる。決済の真正性を検証する `verifyWebhook` は未実装（常に `null`）のため、サーバー側で購入を裏付ける経路が存在しない。

## 問題箇所

- `services/billing/src/billing.ts:99-102` — `ownsSkin(skin, entitlements)` は `skin.free` または `entitlements.some(e => e.skinId === skin.id)` のみで判定。entitlements の出自（誰が発行したか・改ざんされていないか）を検証しない。
- `services/billing/src/billing.ts:69, 78-80` — `BillingProvider.verifyWebhook` は `FreeProvider` で常に `null` を返し、Stripe/PayPal 実装も未実装（TODO）。購入結果をサーバーが署名・保持する仕組みが無い。

（現状 `SKIN_CATALOG` はハードコードされた無料スキンのみで安全だが、issue #29/#30 で外部スキン定義・購入履歴を導入する際の設計リスクとして指摘。）

## 脅威・再現手順

1. クライアントが購入履歴（entitlements）を localStorage / メモリ上で保持すると仮定（#30 の前提）。
2. 攻撃者が DevTools で `entitlements` に任意の `skinId` を追加。
3. `ownsSkin` が `true` を返し、有料スキンが反映される。
4. `verifyWebhook` が常に `null` のため、誰も「本当に購入されたか」を確認しない。

## 影響

- 収益化が迂回され、有料スキンを無断で利用可能。
- リポジトリが PRIVATE でスキン資産を非公開とする方針と矛盾し、保護目的を損なう。

## 推奨対応

- サーバー側で Webhook（Stripe/PayPal）検証済みの entitlement を署名付きで保持（DB または署名付き JWT）。クライアントは署名検証のみを行い、未検証の entitlements は信頼しない。
- `ownsSkin` の入力を「クライアント提示値」ではなく「サーバー署名済み値」に限定する。
- #28/#29 実装時はこの脅威モデル（クライアントは常に改変可能）を前提とすること。

## 検証方法

- 単体テストで「偽の `entitlements`（任意 skinId を含む）を渡して `ownsSkin` が `true` になる」ことを確認（現在の実装では通ってしまう＝再現）。
- `billing.test.ts` に「署名なし entitlements は拒否される」テストを追加予定。

## 優先度

high（収益化・非公開資産保護の核心。実装予定の #28/#29 のセキュリティ前提）
