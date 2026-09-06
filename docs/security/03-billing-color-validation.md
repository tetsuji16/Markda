## 概要

`services/billing/src/billing.ts` の `validateSkin` がスキン色を検証する正規表現 `CSS_COLOR_RE` は「接頭辞」しか見ておらず、`rgba(` / `hsla(` / `#hex` の直後に任意の文字（ `;` や閉じ括弧の不一致、`url(...)` 等）を許容する。この値は `skinToCssVars()` でそのまま `--skin-*` カスタムプロパティに格納されるため、外部スキン定義を `validateSkin` に通す経路（issue #29 Skin API）が実装された際、攻撃者が不当な CSS 値／不正な色文字列を注入できる。

## 問題箇所

`services/billing/src/billing.ts:124`

```ts
const CSS_COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsla?\(/;
```

`validateSkin` 内で使用（`:163` の `colors` 必須色、` colors.extra` 各値 `:175`）。`skinToCssVars`（`:235-248`）は検証済み値を `v["--skin-..."] = val` にそのまま格納。

## 脅威・再現手順

1. 攻撃者がスキン定義 JSON を提出し、`colors.accent` に例えば `rgba(0,0,0,0); --skin-bg: url(javascript:...)` や閉じ括弧のない `rgba(0,0,0` を指定。
2. `CSS_COLOR_RE.test("rgba(0,0,0,0); --skin-bg: ...")` は先頭 `rgba(` に一致するため `true`（検証通過）。
3. 値が `--skin-*` に格納され、CSS 変数として展開される。

## 影響

- 現状クライアント未配線（issue #30 未実装）のため直接被害は無いが、#29/#30 でスキンが描画される経路にそのまま流し込まれると、不正な CSS 値による描画崩れ・文脈によっては CSS インジェクションになる。
- 検証が「形式的に誤った色」を許すため、品質・堅牢性の欠陥でもある。

## 推奨対応

- 厳密な色文法へ置き換え：16進は長さ検証済み；`rgb()`/`rgba()`/`hsl()`/`hsla()` は括弧の対応・カンマ区切りの成分数（rgb=3 / rgba=4 等）・各成分の範囲を検証；名前付きカラーは許可しない（現状どおり）。
- または許可色のホワイトリスト化。
- 検証は「値全体」が文法に合致すること（`^...$` で囲む）を必須とする。

## 検証方法

- `validateSkin({ id:'x', name:'n', brand:'b', colors:{ accent:'rgba(0,0,0,0); --x:y', background:'#fff', foreground:'#000' } })` が `ok:false` になることを期待（現在は `ok:true` で通過＝再現）。
- `billing.test.ts` に不正色のテストを追加。

## 優先度

medium（#29/#30 導入前の事前修正が必要。防衛的観点から今すぐ修正推奨）
