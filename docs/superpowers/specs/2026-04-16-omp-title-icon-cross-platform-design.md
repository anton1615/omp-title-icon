# omp-title-icon Cross-Platform Design

日期：2026-04-16
狀態：Draft

## 1. 目標

將 `omp-title-icon` 從目前的 Windows-only 啟用模型，擴展為真正的跨平台插件產品。

新版本的產品定義如下：

- 只要終端支援 OSC title 更新，就應盡量啟用
- 支援 Windows、macOS、Linux 的互動式終端環境
- 維持既有的三態圖示：
  - idle：`●`
  - running：`○`
  - ask：`?`
- 維持既有 best-effort takeover 設計：以短期 reassert 壓過晚到的 title 覆寫

## 2. 非目標

本次變更不包含以下內容：

- 不把插件改造成「終端相容性資料庫」
- 不維護特定品牌終端的大型白名單
- 不新增使用者可設定的 capability policy
- 不新增 CI matrix（Windows/macOS/Linux）
- 不改動 oh-my-pi core 的 title API 或 marketplace/plugin-root 架構
- 不改變 title takeover 的基本狀態機或 icon 映射

## 3. 問題背景

目前 `omp-title-icon` 有兩個與產品目標衝突的點：

1. 啟用條件硬綁 Windows：
   - 目前 `isWindowsTerminal()` 只在 `platform === "win32" && WT_SESSION` 時啟用
   - 這使插件在 macOS/Linux 終端上永遠不會嘗試管理 title

2. `computeBaseTitle()` 依賴 host OS 的 `node:path` 預設語意：
   - 在 Windows runner 上，`"C:/"` 會被視為 Windows root
   - 在 Linux runner 上，`path.basename("C:/")` 會得到 `"C:"`
   - 結果是產品語意被執行環境污染，導致 CI 在 Linux runner 失敗

這代表目前實作的跨平台性不足，不只是 CI 測試問題，而是產品語意與 host OS 耦合。

## 4. 產品定義

`omp-title-icon` 應被定義為：

- 一個跨平台 title status 插件
- 以終端是否支援 OSC title 更新為能力邊界
- 對不支援或不適合的環境採 best-effort / silent fallback

也就是說，插件不保證所有終端一定能顯示 title 更新，但不應因作業系統不同而被預先排除。

## 5. 啟用條件：能力導向 gating

### 5.1 設計方向

目前的 `isWindowsTerminal()` 應被移除，改成能力導向的 `shouldEnableTitlePlugin(...)`。

此函式關注的不是：

- 這是不是 Windows？

而是：

- 這是否看起來像一個值得嘗試寫入 OSC title 的互動式終端環境？

### 5.2 規則

#### A. 明確停用

以下情境直接停用：

- `TERM === "dumb"`
- 明確的非互動、無 title 意義的輸出情境
- 後續若發現特定 host 會把 OSC title 變成噪音，可再列入 denylist

#### B. 明確啟用

只要存在典型互動式 terminal 訊號，就啟用：

- `WT_SESSION`
- `TERM_PROGRAM`
- `TERM`
- `COLORTERM`

注意：這些值不是品牌白名單，而是互動式終端存在的訊號。

#### C. 訊號不足時的預設

若沒有明確停用訊號，也沒有強烈的啟用訊號，預設仍然啟用。

原因：

- 本插件是 best-effort
- 不支援的終端通常會忽略 title 更新
- 產品目標已明確改為「只要終端支援 OSC title 就一律嘗試啟用」

### 5.3 設計結論

第一版跨平台啟用規則應該是：

- 不再綁 `win32`
- 使用 capability-oriented best-effort enablement
- 保留少量明確停用條件
- 其餘環境預設嘗試啟用

## 6. baseTitle：與 host OS 脫鉤的 path 規則

### 6.1 問題

目前 `computeBaseTitle()` 直接使用 `path.basename(cwd)` 與 `path.parse(cwd).root`，這會依賴 Node 執行時所在平台。

這不符合產品語意。

`computeBaseTitle()` 應該判斷：

- 這個字串看起來像 Windows path 還是 POSIX path？

而不是：

- 這個 runner 是 Windows 還是 Linux？

### 6.2 Windows-style path

以下都視為 Windows path：

- `C:\\work\\project`
- `C:/work/project`
- `\\server\\share\\folder`

處理方式：

- 使用 `path.win32.basename(...)`
- 使用 `path.win32.parse(...).root`

### 6.3 POSIX-style path

以下視為 POSIX path：

- `/home/anton/project`
- `/tmp/foo`
- `/`

處理方式：

- 使用 `path.posix.basename(...)`
- 使用 `path.posix.parse(...).root`

### 6.4 未知或模糊路徑

例如：

- `project`
- `foo/bar`
- `foo\\bar`

處理原則：

- 先 trim
- 若含 `\\` 或明顯符合 Windows 形狀，優先走 `path.win32`
- 其餘走 `path.posix`
- 若最終結果為空字串或 root，fallback 到 `π`

### 6.5 行為目標

`computeBaseTitle()` 必須保證：

- 相同輸入在 Windows runner 與 Linux runner 上得到相同結果
- 產品語意不再依賴 host OS

## 7. Title 顯示規則

title 顯示格式維持不變：

- idle -> `● ${baseTitle}`
- running -> `○ ${baseTitle}`
- ask -> `? ${baseTitle}`

狀態優先順序維持：

1. ask
2. running
3. idle

這一層本來就與平台無關，因此不需要重新設計。

## 8. Takeover 策略

既有 takeover/reassert 設計維持不變：

- `reassertDurationMs = 2000`
- `reassertIntervalMs = 250`

在以下事件後啟動短期 forced reassert：

- `session_start`
- `session_switch`
- `session_branch`
- `session_tree`
- `agent_start`
- `agent_end`
- `tool_execution_start` (`toolName === "ask"`)
- `tool_execution_end` (`toolName === "ask"`)

這部分本來就不依賴作業系統，故僅需保留並由跨平台 gating 決定是否啟用。

## 9. 測試矩陣

### 9.1 capability gating

新增或調整測試覆蓋：

- `TERM=dumb` -> false
- `WT_SESSION` -> true
- `TERM_PROGRAM=iTerm.app` -> true
- `TERM=xterm-256color` -> true
- 沒有明確停用訊號時 -> true

### 9.2 path normalization / baseTitle

至少覆蓋以下案例：

- `computeBaseTitle(undefined, undefined) -> "π"`
- `computeBaseTitle(undefined, "C:/") -> "π"`
- `computeBaseTitle(undefined, "C:\\") -> "π"`
- `computeBaseTitle(undefined, "C:/work/project") -> "project"`
- `computeBaseTitle(undefined, "C:\\work\\project") -> "project"`
- `computeBaseTitle(undefined, "/") -> "π"`
- `computeBaseTitle(undefined, "/home/anton/project") -> "project"`
- `computeBaseTitle("Manual", "/home/anton/project") -> "Manual"`

### 9.3 既有狀態機

既有測試應保留：

- `idle -> running -> ask -> running -> idle`
- duplicate non-forced writes are skipped
- forced reassert writes still happen
- askDepth clamp at zero

### 9.4 測試目標

測試必須驗證：

- path/title 語意不受 runner 平台影響
- capability gating 不再綁 Windows-only
- 既有狀態機邏輯未被破壞

## 10. CI 策略

本次不新增 matrix。

CI 仍維持：

- `ubuntu-latest`
- `bun install --frozen-lockfile`
- `bun run check`

原因：

- 若 path/title 語意已與 host OS 脫鉤，單一 Linux runner 就足以驗證產品邏輯一致性
- 先修語意依賴，比擴大 CI 維度更有價值

## 11. README 與產品說明

README 需從 Windows-only 改成跨平台相容產品定位。

### 11.1 定位

從：

- Windows Terminal title takeover

改成：

- Cross-platform terminal title status extension for Oh My Pi / Pi coding agent

### 11.2 啟用條件說明

改成：

- Any interactive terminal host that supports OSC title updates
- Best-effort behavior; unsupported terminals may ignore title updates

### 11.3 平台說明

明確寫出：

- Supports Windows, macOS, and Linux terminal environments on a best-effort basis
- Terminal compatibility depends on host support for OSC title sequences
- Some terminals may ignore title updates or overwrite them later

### 11.4 Marketplace 說明

保留現有誠實說明：

- marketplace catalog 已存在
- 但目前 OMP marketplace/plugin-root loading 對純 `omp.extensions` extension-module 仍未完整支援
- 實際使用仍以 `--extension` / `extensions` path 為主

## 12. 實作邊界

本次 implementation 只做以下內容：

- 用 capability-oriented gating 取代 Windows-only gating
- 讓 `computeBaseTitle()` 依 path shape 選擇 `path.win32` 或 `path.posix`
- 擴充測試矩陣
- 更新 README 產品定位
- 修正現有 CI 失敗

本次不做：

- terminal 品牌白名單
- 使用者可設定 capability policy
- CI matrix
- upstream oh-my-pi API 或 marketplace 架構改造

## 13. 最終建議

`omp-title-icon` 應升級為跨平台相容插件產品。

推薦方案：

- 採 capability-oriented best-effort gating
- 讓 path/title 語意與 host OS 脫鉤
- 保留既有狀態機與 forced reassert 設計
- 維持最小範圍修正，不把產品膨脹成 terminal compatibility framework

這能同時達成：

- 修掉目前 CI failure 的根因
- 符合插件產品應有的跨平台定義
- 不需要大改 oh-my-pi core 或大幅擴充 repo 複雜度
