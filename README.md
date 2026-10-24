# Cloudflare Proxy（Proxy Everything · 帶 TOKEN 認證）

一個基於 Cloudflare Workers 的通用網頁反向代理，帶 TOKEN 鑑權。部署後只有持有 TOKEN 的人可以使用：代理地址格式為 `workers地址/<TOKEN>/<要代理的網址>`，未帶或帶錯 TOKEN 一律返回 403。

> 本項目為正體中文版本：代碼註釋、前端頁面文案與語言標識（`lang="zh-TW"`、`Content-Language: zh-TW`）均已由簡體中文轉換而來。代碼採用 Modules 語法（`export default { fetch }`），與 Cloudflare 面板新建 Worker 的 Hello World 模板一致，可直接粘貼部署。原作者：ymyuuu。

## 快速部署（Cloudflare 面板，無需任何命令行）

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers 和 Pages** → **創建** → **Worker**，隨便取個名字，點 **部署**（此時是 Hello World 模板）。
2. 點 **編輯代碼**，在編輯器中 **全選刪除** 模板內容，把本目錄 `worker.js` 的 **全部代碼粘貼進去**，點右上角 **部署**。
3. 設置你的 TOKEN（二選一，推薦 a）：
   - **a. 環境變量（推薦，代碼中不出現明文）**：Worker 頁面 → **設置** → **變量和密鑰（Variables and Secrets）** → **添加** → 名稱填 `PROXY_TOKEN`，值填你的隨機字符串，類型建議選 **Secret** → 保存。環境變量會自動優先於代碼裡的默認值。
   - **b. 改代碼常量**：把 `worker.js` 頂部 `DEFAULT_TOKEN = "..."` 改成自己的隨機字符串，重新粘貼並部署。
4. 訪問 `https://<你的worker名>.<你的子域>.workers.dev`，在頁面中輸入 TOKEN 與目標地址即可使用。

> 代碼中出廠默認 TOKEN 為一組隨機十六進制字符串，**僅供測試**；正式使用請務必按第 3 步換成自己的。

### 可選：Wrangler CLI 部署

```bash
npm install -g wrangler
wrangler login
wrangler init cloudflare-proxy   # 或直接在本目錄創建 wrangler.toml
```

`wrangler.toml`：

```toml
name = "proxy-everything"
main = "worker.js"
compatibility_date = "2024-09-23"

# 明文變量（不推薦放敏感值）；推薦改用下方 secret 命令
# [vars]
# PROXY_TOKEN = "your-token"
```

```bash
wrangler deploy
wrangler secret put PROXY_TOKEN   # 交互式輸入 TOKEN，加密存儲
```

## 使用方法

### Web 頁面（根目錄）

訪問 Worker 域名根目錄 `/`，會看到輸入卡片：

- **訪問令牌（TOKEN）**：必填。輸入一次後會保存在本瀏覽器 `localStorage`，下次自動填入。
- **目標地址**：要代理的網址。
- 點「跳轉」後在新標籤頁打開 `/<TOKEN>/<編碼後的目標URL>`。

頁面本身公開可見（只是一個表單），但 **沒有 TOKEN 無法代理任何內容**。

### 直接拼 URL

```
https://<你的worker域名>/<TOKEN>/<目標URL>
```

- 編碼寫法（推薦，由頁面自動生成）：

  ```
  https://worker.example.com/8848022e.../https%3A%2F%2Fexample.com%2Fa%3Fb%3D1
  ```

- 未編碼寫法同樣可用：

  ```
  https://worker.example.com/8848022e.../https://example.com/a?b=1
  ```

- 目標 URL 未帶協議時自動沿用當前請求協議；查詢參數原樣保留。

### 鑑權行為

| 請求 | 結果 |
| --- | --- |
| `/`（根目錄） | 200，返回 TOKEN 輸入頁 |
| `/<正確TOKEN>/<目標URL>` | 正常代理 |
| `/<錯誤或無TOKEN>/...` | 403 JSON：`Forbidden` |
| `/<正確TOKEN>/`（無目標） | 400 JSON：`Bad Request` |

## 功能特性

- **TOKEN 鑑權**：所有代理請求必須攜帶正確 TOKEN（路徑首段）；支持環境變量 `PROXY_TOKEN`（優先）或代碼常量兩種配置方式。
- **帶 TOKEN 的鏈路改寫**：重定向 `Location` 與 HTML 內 `href` / `src` / `action` 相對路徑改寫後均自動帶上 TOKEN 前綴，跳轉與站內資源不會「掉登入」。
- **通用代理**：支援任意 http/https 目標；攔截 301/302/303/307/308 重定向；保留查詢參數；剔除 `cf-` 開頭請求頭。
- **CORS 與緩存**：響應附加 `Access-Control-Allow-Origin: *` 與 `Cache-Control: no-store`。
- **首頁表單**：Materialize 風格，支援深色模式，TOKEN 本地記憶。
- **錯誤處理**：代理出錯返回 JSON 錯誤消息與 500 狀態碼。

## 與原版的差異

1. 由 Service Worker 舊語法（`addEventListener('fetch')`，已被 Cloudflare 棄用）改為 **Modules 語法**，可直接粘貼進面板新建的 Hello World Worker。
2. 新增 **TOKEN 認證**（根頁面、URL 格式、重定向與 HTML 改寫均已適配）。
3. 順帶修復原版兩個小問題：
   - 重定向時 `{...response.headers}` 展開 Headers 實例會丟失全部原始頭部，現改用 `new Headers(response.headers)` 複製後再改寫 `Location`；
   - 相對 `Location`（如 `/path`）原先會解析失敗，現以目標 URL 為 base 解析。
4. 根頁面 `robots` 由 `index, follow` 改為 `noindex, nofollow`（私人代理不宜被搜索引擎收錄）。

## 安全注意事項

- TOKEN 出現在 URL 路徑中，會留在瀏覽器歷史、Referer 及 Cloudflare 日誌裡：請使用足夠長的隨機字符串，洩露後立即更換（改環境變量即刻生效）。
- 拿到 TOKEN 的人即擁有該 Worker 的完整代理權限，不要公開分享帶 TOKEN 的連結。
- 請遵守目標網站的服務條款與當地法律法規，勿用於侵權或違規用途。
- Worker 免費方案有每日請求數與 CPU 時間限制，大流量場景請留意配額。
- 部分網站會檢測代理或依賴 Cookie / WebSocket / 絕對路徑資源，可能無法完整渲染或登入；HTML 路徑改寫僅覆蓋 `href` / `src` / `action` 屬性。

## 文件說明

```
cloudflare-proxy/
├── worker.js   # Worker 入口腳本（Modules 語法，含根目錄前端頁面與 TOKEN 鑑權）
└── README.md   # 本說明文件
```
