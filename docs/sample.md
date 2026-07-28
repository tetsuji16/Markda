# ⚡ Quick Cheat Sheet & Sample

---

### 1. 数式 & テキスト装飾
- **インライン数式**: オイラーの等式 $e^{i\pi} + 1 = 0$ や `MSE` 計算式。
- **ブロック数式**:
  $$J(\theta) = -\frac{1}{m} \sum_{i=1}^{m} \left[ y^{(i)} \log(\hat{y}^{(i)}) + (1 - y^{(i)}) \log(1 - \hat{y}^{(i)}) \right]$$

### 2. データ処理フロー
| 機能  | 状態            | 実行時間 |
| :-- | ------------: | ---: |
| 前処理 | `Done`        | 1.2s |
| 学習  | `In Progress` | --   |

- [x] データクレンジング完了
- [ ] ハイパーパラメータ最適化

### 3. コードサンプル (Python)
```python
import torch

# 1行でモデル推論
y_pred = torch.sigmoid(torch.tensor([0.5, -1.2]))
print(f"Predictions: {y_pred.tolist()}")
```
