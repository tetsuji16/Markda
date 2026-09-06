## 概要

`services/billing/src/billing.ts` の `getBilling()` は、環境変数 `STRIPE_SECRET_KEY` や `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` が設定されていても実際のプロバイダを返さず、警告・ログなしに `FreeProvider`（無料モード＝全スキン解放・課金なし）へ暗黙的にフォールバックする。決済を有効にするつもりでシークレットを設定した運用で、サイレントに課金が発生しなくなる。

## 問題箇所

`services/billing/src/billing.ts:88-96`

```ts
export function getBilling(): BillingProvider {
  if (process.env.STRIPE_SECRET_KEY) {
    // return new StripeProvider(process.env.STRIPE_SECRET_KEY);   // ← 実装されていない
  }
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    // return new PayPalProvider(...);                              // ← 実装されていない
  }
  return new FreeProvider();
}
```

## 脅威・再現手順

1. 本番環境で `STRIPE_SECRET_KEY` を設定し、Stripe 決済を期待してデプロイ。
2. `getBilling()` は空の `if` ブロックを通り抜け、最終行で `FreeProvider` を返す。
3. 課金フローが動作せず、全スキンが無料解放されたままになる。エラー・警告・ログは一切出ない。

## 影響

- 設定ミスに気づけず収入が得られない（サイレントな収益欠損）。
- 設定済みシークレットが「有効」と誤認される。

## 推奨対応

- Stripe/PayPal 未実装のまま env を検出した場合は、`console.error` 等で「課金プロバイダが未実装のため FreeProvider で動作します」と明記する。
- あるいは `throw` / 起動失敗にして設定と実装の不整合を顕在化させる。
- 実装時は env 検出と return を対応付ける（現在は return がコメントアウト）。

## 検証方法

- `process.env.STRIPE_SECRET_KEY = 'x'` のもとで `getBilling().name` を呼び、`'free'` が返る（＝再現）ことを確認するテストを追加。

## 優先度

medium（稼働中の課金要件の核心だが、現時点では #29 未実装のため実害は導入時）
