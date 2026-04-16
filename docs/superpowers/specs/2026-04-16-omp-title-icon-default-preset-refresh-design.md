# omp-title-icon Default Preset Refresh Design

日期：2026-04-16
狀態：Draft

## 1. 目標

在不改變 `omp-title-icon` 設定覆寫模型的前提下，調整內建預設 prefix，讓 `idle` 比現行 `◆` 更醒目、`running` 比現行 `·` 更像「正在運作」，同時維持 `ask` 的高辨識度。

本次變更只調整內建預設值與對應文件/測試，不變更：

- `~/.omp/agent/config.yml` 為主、`~/.omp/agent/settings.json` 為 fallback 的設定來源模型
- `ask > running > idle` 的狀態優先序
- reassert 策略
- cross-platform title capability gating
- prefix string override 的資料結構

## 2. 新預設決策

新的內建預設值：

- `idle`: `✳`
- `running`: `⟳`
- `ask`: `?!`

## 3. 設計理由

### 3.1 idle：`✳`

`◆` 在 title 中仍然偏小，待命狀態不夠醒目。

`✳` 的視覺存在感更高，且比實心幾何符號更像「亮著的狀態提示」。

本次應使用純文字符號 `✳`，不是 emoji 變體 `✳️`，避免終端把 prefix 渲染成彩色 emoji 或造成字寬不穩定。

### 3.2 running：`⟳`

`·` 雖然低調，但語意過弱；一眼看上去更像單純分隔符，而不是「正在運作」。

`⟳` 保留了文字符號的穩定性，同時更明確表達循環、處理中、運行中的語意。這比 `…` 或 `⋯` 更不容易被誤讀成停頓或等待輸入。

### 3.3 ask：`?!`

`ask` 仍需要比 `running` 更醒目，因此保留既有 `?!`。這個前綴已經足夠短，也能清楚表達「需要你回應」。

## 4. 設定與覆寫影響

使用者覆寫格式不變：

```yaml
ompTitleIcon:
  icons:
    idle: "✳"
    running: "⟳"
    ask: "?!"
```

```json
{
  "ompTitleIcon": {
    "icons": {
      "idle": "✳",
      "running": "⟳",
      "ask": "?!"
    }
  }
}
```

覆寫優先序也不變：

1. `~/.omp/agent/config.yml`
2. `~/.omp/agent/settings.json`
3. 內建預設 `✳ / ⟳ / ?!`

一旦 `config.yml` 定義 `ompTitleIcon.icons`，仍不做跨檔 merge；缺欄位直接回退內建預設，不從 legacy JSON 補洞。

## 5. 渲染結果

預設渲染應更新為：

- idle: `✳ Build Fix`
- running: `⟳ Build Fix`
- ask: `?! Build Fix`

若使用者把某個 prefix 設為空字串，既有規則不變：

- 直接回傳 `baseTitle`
- 不留下前導空白

## 6. 實作範圍

需要修改：

- `src/extension.ts`：更新 `DEFAULT_TITLE_PREFIXES`
- `test/extension.test.ts`：先用 TDD 改紅，再把所有預設值斷言改成新組合
- `README.md`：更新產品說明、override 範例、手動驗證文案中的預設值

本次不新增新的設定欄位，也不變更 public API surface。

## 7. 測試需求

至少覆蓋或更新以下案例：

1. `renderTitle()` / lifecycle 預設值改為 `✳ / ⟳ / ?!`
2. config fallback 到 built-in defaults 時，新的 defaults 必須正確出現在 title 中
3. README contract tests 必須改成驗證新的預設值與 override 範例
4. 空字串 prefix 行為維持不變
5. user override precedence 行為維持不變

## 8. 風險與非目標

風險：

- 某些 terminal/font 對 `✳`、`⟳` 的字寬與視覺重量可能略有差異

本次接受這個風險，因為：

- 兩者都屬於文字符號，不是必然 emoji 呈現
- 使用者仍可透過既有 override 機制改成自己偏好的 prefix

非目標：

- 不新增 icon theme/preset 切換系統
- 不改 marketplace 流程
- 不新增 UI 設定入口
- 不更動 config loading precedence 或錯誤處理規則
