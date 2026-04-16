# Historical omp-title-icon Icon Preset and User Override Design (Superseded)

日期：2026-04-16
狀態：Superseded

 > Superseded note (2026-04-16): The original built-in default preset decision recorded in this document (`◆ / · / ?!`) was superseded later the same day by `docs/superpowers/specs/2026-04-16-omp-title-icon-default-preset-refresh-design.md` and `docs/superpowers/plans/2026-04-16-omp-title-icon-default-preset-refresh.md`. Treat those newer documents as the only current source of truth for preset values. This file remains historical context for the configurable override design that introduced prefix-string settings.

## 1. 目標（歷史）

這份文件描述的是 `omp-title-icon` 當時把固定 glyph 升級為可覆寫 prefix string 的原始設計，包含當時選定的內建預設值 `◆ / · / ?!`。

> 目前有效的預設值已改為 `✳ / ⟳ / ?!`；若需要現行 preset，請改讀 preset-refresh spec/plan。

這份歷史設計在 `omp-title-icon` 既有的 cross-platform title plugin 基礎上，新增更醒目的預設圖示組合，並暴露使用者可覆寫的 icon/prefix 設定。

當時這次變更的產品目標：

- 預設圖示不再使用過小的實心圓組合
- `idle` 與 `ask` 必須比 `running` 更醒目
- 使用者可在自己的 OMP 設定檔中覆寫這三個狀態的圖示/前綴
- 設定覆寫應不依賴 marketplace/plugin runtime 設定系統，因為當前此插件主要仍以 extension path 載入

## 2. 原始預設圖示決策（已被取代）

此文件在當時記錄的預設組合為：

- `idle`: `◆`
- `running`: `·`
- `ask`: `?!`

當時的設計理由：

- `◆` 比 `●` 更大、更有存在感，適合 idle 的穩定狀態提示
- `·` 的存在感明顯低於實心/空心圓，符合 running 不必過度搶眼的需求
- `?!` 比單一 `?` 更醒目，同時仍保留「正在等待回答」的語意

## 3. 不再把圖示當作單一字元

目前實作把狀態標記當作固定單一 glyph。

本次應改成「prefix string」模型，也就是每個狀態對應一段可配置字串：

- `idlePrefix`
- `runningPrefix`
- `askPrefix`

這樣的好處：

- ask 可以用 `?!`、`??` 這類更醒目的前綴
- 之後若使用者想用文字、符號組合、或空字串都更容易
- 不需要把設計限制在單一 Unicode 碼點

## 4. 設定來源與路徑

### 4.1 標準全域路徑

實際應支援的 OMP 使用者設定路徑是：

- `~/.omp/agent/config.yml`

不是：

- `~/.omp/agents/...`

`agent` 才是目前 OMP 全域設定的實際目錄名稱。

### 4.2 Legacy fallback

為了兼容仍保留舊 JSON 設定檔的使用者，可額外支援：

- `~/.omp/agent/settings.json`

但此路徑只作為 fallback，不是主要寫法。

## 5. 設定格式

### 5.1 `config.yml`

推薦格式：

```yml
ompTitleIcon:
  icons:
    idle: "◆"
    running: "·"
    ask: "?!"
```

### 5.2 `settings.json`

fallback 格式：

```json
{
  "ompTitleIcon": {
    "icons": {
      "idle": "◆",
      "running": "·",
      "ask": "?!"
    }
  }
}
```

## 6. 設定優先序（歷史設計，規則仍沿用）

此段描述的是原始 icon-config 設計定下的讀取順序；preset-refresh 只改內建預設值，沒有改 precedence。

當時設計的設定讀取順序如下：

1. `~/.omp/agent/config.yml`
2. `~/.omp/agent/settings.json`
3. 當時的內建預設值

規則：

- 若 `config.yml` 中存在 `ompTitleIcon.icons`，優先使用它
- 若 `config.yml` 中不存在該區塊，再讀 `settings.json`
- 若兩者都沒有可用設定，當時回退到內建預設：
  - `idle = "◆"`
  - `running = "·"`
  - `ask = "?!"`

今天若需要現行 preset，請將上述 fallback 值改讀新文件中的 `✳ / ⟳ / ?!`。

這份歷史設計不做跨檔 merge。

也就是說：

- `config.yml` 一旦提供 `ompTitleIcon.icons`，就視為完整優先來源
- 不再從 `settings.json` 補洞

這樣可以避免兩個設定來源混用時出現難理解的結果

## 7. 解析與驗證規則

設定值來自使用者檔案，因此必須做邊界驗證。

### 7.1 合法值

- `idle` / `running` / `ask` 皆接受字串
- 空字串也是合法值

### 7.2 非法值

- 若任一欄位不存在、型別不是字串、或整個結構不是物件，則該欄位回退到預設值
- 設定檔解析失敗時，不中止插件功能；整體回退到預設值

### 7.3 空字串語義

若某個 prefix 被設定為空字串，代表：

- 該狀態不顯示前綴
- title 直接顯示 `baseTitle`
- 不應留下多餘前導空白

例如：

- `running: ""`
- 產生的 title 應為 `Build Fix`
- 而不是 ` Build Fix`

## 8. 渲染規則（歷史預設示例）

目前渲染形式是：

- `<icon> <baseTitle>`

本次改為：

- 若 prefix 非空：`<prefix> <baseTitle>`
- 若 prefix 為空：`<baseTitle>`

這份歷史文件中的原始範例：

- idle default: `◆ Build Fix`
- running default: `· Build Fix`
- ask default: `?! Build Fix`
- running empty override: `Build Fix`

現行預設範例已更新為 `✳ Build Fix` / `⟳ Build Fix` / `?! Build Fix`，請以 preset-refresh spec/plan 為準。

## 9. 與既有狀態機的關係

本次只變更 prefix 選擇與渲染來源。

不變項：

- 狀態判斷優先序仍是 `ask > running > idle`
- 事件來源不變：`session_*` / `agent_*` / `tool_execution_*`
- reassert 策略不變
- `computeBaseTitle()` 不變
- cross-platform capability gating 不變

## 10. 測試需求（歷史預設示例）

至少新增或調整以下測試：

### 10.1 預設 prefix

驗證這份歷史文件當時的預設渲染：

- idle -> `◆ Build Fix`
- running -> `· Build Fix`
- ask -> `?! Build Fix`

### 10.2 設定覆寫

驗證從設定檔讀到覆寫值時：

- `idle`, `running`, `ask` 會套用自訂前綴
- 不會再使用內建預設值

### 10.3 fallback 行為

驗證：

- `config.yml` 有值時，忽略 `settings.json`
- `config.yml` 缺少設定塊時，可回落到 `settings.json`
- 兩者皆無時，回退到預設值

### 10.4 非法設定

驗證：

- 非字串值會回退到預設
- 結構錯誤或檔案解析失敗時不會讓插件崩潰

### 10.5 空字串 prefix

驗證：

- `running: ""` 時 title 為 `Build Fix`
- 不會產生前導空白

## 11. 非目標

本次不做：

- 不做 UI 面板設定入口
- 不做 `omp plugin config set ...` 整合
- 不做 project-level `.omp/settings.json` 的 icon override
- 不做 marketplace install/config workflow 變更
- 不做 icon 套件/theme system

## 12. 建議實作邊界（歷史）

這份歷史 implementation 當時只包含：

- 將固定 glyph 改成狀態 prefix 設定
- 新增設定檔讀取器（`config.yml` 主、`settings.json` fallback）
- 套用當時的內建預設值 `◆ / · / ?!`
- 補齊覆寫/fallback/空字串/錯誤處理測試
- 更新 README 說明新的預設與自訂方式

## 13. 最終建議（歷史）

這份歷史文件的最終建議，是將 `omp-title-icon` 的狀態標記正式升級為「可設定 prefix」。

當時的預設值建議使用：

- idle: `◆`
- running: `·`
- ask: `?!`

目前有效的預設值已由 preset-refresh 文件取代為：

- idle: `✳`
- running: `⟳`
- ask: `?!`
使用者設定來源採：

- `~/.omp/agent/config.yml` 為主
- `~/.omp/agent/settings.json` 為 fallback

這樣可以同時達成：

- 改善預設視覺辨識度
- 讓使用者能依個人字型/終端偏好自訂
- 不依賴目前尚未完全打通的 marketplace/plugin 設定通路
