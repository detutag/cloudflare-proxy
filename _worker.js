// ==================== 配置區 ====================
// 訪問令牌（代碼默認值）：部署前請修改為自己的隨機字符串
// 也可以在 Cloudflare 面板 Settings → Variables and Secrets 中
// 添加名為 PROXY_TOKEN 的變量（建議 Secret 類型），環境變量會優先於下面的默認值
const DEFAULT_TOKEN = "8848022e9bfbbcbba2a01df4d2e1364a";
// ================================================

// 入口（Modules 語法，與 Cloudflare 面板 Hello World 模板一致，可直接粘貼部署）
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};

// 獲取生效的 TOKEN：環境變量 PROXY_TOKEN 優先，其次為代碼中的默認值
function getToken(env) {
  return env && env.PROXY_TOKEN ? env.PROXY_TOKEN : DEFAULT_TOKEN;
}

async function handleRequest(request, env) {
  try {
      const url = new URL(request.url);
      const token = getToken(env);
      const tokenPrefix = `/${token}/`;

      // 如果訪問根目錄，返回HTML輸入頁（頁面本身公開，但必須輸入 TOKEN 才能使用代理）
      if (url.pathname === "/") {
          return new Response(getRootHtml(), {
              headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-store'
              }
          });
      }

      // 鑑權：請求路徑必須為 /<TOKEN>/<目標URL> 格式，TOKEN 不符則返回 403
      if (!url.pathname.startsWith(tokenPrefix)) {
          return jsonResponse({
              error: 'Forbidden: TOKEN missing or incorrect'
          }, 403);
      }

      // 去掉 /<TOKEN>/ 前綴，從剩餘路徑中提取目標 URL
      let actualUrlStr = decodeURIComponent(url.pathname.slice(tokenPrefix.length));

      // 缺少目標 URL 時返回 400
      if (!actualUrlStr) {
          return jsonResponse({
              error: 'Bad Request: missing target URL, format should be /<TOKEN>/<target URL>'
          }, 400);
      }

      // 判斷用戶輸入的 URL 是否帶有協議
      actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);

      // 保留查詢參數
      actualUrlStr += url.search;

      // 創建新 Headers 對象，排除以 'cf-' 開頭的請求頭
      const newHeaders = filterHeaders(request.headers, name => !name.startsWith('cf-'));

      // 創建一個新的請求以訪問目標 URL
      const modifiedRequest = new Request(actualUrlStr, {
          headers: newHeaders,
          method: request.method,
          body: request.body,
          redirect: 'manual'
      });

      // 發起對目標 URL 的請求
      const response = await fetch(modifiedRequest);
      let body = response.body;

      // 處理重定向（Location 會改寫為 /<TOKEN>/<新目標>，保證跳轉後仍走代理）
      if ([301, 302, 303, 307, 308].includes(response.status)) {
          return handleRedirect(response, body, token, actualUrlStr);
      } else if (response.headers.get("Content-Type")?.includes("text/html")) {
          body = await handleHtmlContent(response, url.protocol, url.host, actualUrlStr, token);
      }

      // 創建修改後的響應對象
      const modifiedResponse = new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
      });

      // 添加禁用緩存的頭部
      setNoCacheHeaders(modifiedResponse.headers);

      // 添加 CORS 頭部，允許跨域訪問
      setCorsHeaders(modifiedResponse.headers);

      return modifiedResponse;
  } catch (error) {
      // 如果請求目標地址時出現錯誤，返回帶有錯誤消息的響應和狀態碼 500（服務器錯誤）
      return jsonResponse({
          error: error.message
      }, 500);
  }
}

// 確保 URL 帶有協議
function ensureProtocol(url, defaultProtocol) {
  return url.startsWith("http://") || url.startsWith("https://") ? url : defaultProtocol + "//" + url;
}

// 處理重定向：將 Location 改寫為 /<TOKEN>/<編碼後的目標URL>
function handleRedirect(response, body, token, baseUrl) {
  const location = new URL(response.headers.get('location'), baseUrl);
  const modifiedLocation = `/${token}/${encodeURIComponent(location.toString())}`;
  // 複製原始響應頭後再改寫 Location（原代碼用 {...response.headers} 展開會丟失全部頭部）
  const headers = new Headers(response.headers);
  headers.set('Location', modifiedLocation);
  return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
  });
}

// 處理 HTML 內容中的相對路徑
async function handleHtmlContent(response, protocol, host, actualUrlStr, token) {
  const originalText = await response.text();
  return replaceRelativePaths(originalText, protocol, host, new URL(actualUrlStr).origin, token);
}

// 替換 HTML 內容中的相對路徑：把 /xxx 改寫為 /<TOKEN>/<origin>/xxx
function replaceRelativePaths(text, protocol, host, origin, token) {
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  return text.replace(regex, `$1${protocol}//${host}/${token}/${origin}/`);
}

// 返回 JSON 格式的響應
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
      status: status,
      headers: {
          'Content-Type': 'application/json; charset=utf-8'
      }
  });
}

// 過濾請求頭
function filterHeaders(headers, filterFunc) {
  return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

// 設置禁用緩存的頭部
function setNoCacheHeaders(headers) {
  headers.set('Cache-Control', 'no-store');
}

// 設置 CORS 頭部
function setCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  headers.set('Access-Control-Allow-Headers', '*');
}

// 返回根目錄的 HTML（含 TOKEN 輸入框）
function getRootHtml() {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <link href="https://s4.zstatic.net/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <title>Proxy Everything</title>
  <link rel="icon" type="image/png" href="https://s2.hdslb.com/bfs/openplatform/1682b11880f5c53171217a03c8adc9f2e2a27fcf.png@100w.webp">
  <meta name="Description" content="Proxy Everything with CF Workers.">
  <meta property="og:description" content="Proxy Everything with CF Workers.">
  <meta property="og:image" content="https://s2.hdslb.com/bfs/openplatform/1682b11880f5c53171217a03c8adc9f2e2a27fcf.png@100w.webp">
  <meta name="robots" content="noindex, nofollow">
  <meta http-equiv="Content-Language" content="zh-TW">
  <meta name="copyright" content="Copyright © ymyuuu">
  <meta name="author" content="ymyuuu">
  <link rel="apple-touch-icon-precomposed" sizes="120x120" href="https://s2.hdslb.com/bfs/openplatform/1682b11880f5c53171217a03c8adc9f2e2a27fcf.png@100w.webp">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
  <style>
      body, html {
          height: 100%;
          margin: 0;
      }
      .background {
          background-size: cover;
          background-position: center;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
      }
      .card {
          background-color: rgba(255, 255, 255, 0.8);
          transition: background-color 0.3s ease, box-shadow 0.3s ease;
      }
      .card:hover {
          background-color: rgba(255, 255, 255, 1);
          box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.3);
      }
      .input-field input[type=text], .input-field input[type=password] {
          color: #2c3e50;
      }
      .input-field input[type=text]:focus+label, .input-field input[type=password]:focus+label {
          color: #2c3e50 !important;
      }
      .input-field input[type=text]:focus, .input-field input[type=password]:focus {
          border-bottom: 1px solid #2c3e50 !important;
          box-shadow: 0 1px 0 0 #2c3e50 !important;
      }
      @media (prefers-color-scheme: dark) {
          body, html {
              background-color: #121212;
              color: #e0e0e0;
          }
          .card {
              background-color: rgba(33, 33, 33, 0.9);
              color: #ffffff;
          }
          .card:hover {
              background-color: rgba(50, 50, 50, 1);
              box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.6);
          }
          .input-field input[type=text], .input-field input[type=password] {
              color: #ffffff;
          }
          .input-field input[type=text]:focus+label, .input-field input[type=password]:focus+label {
              color: #ffffff !important;
          }
          .input-field input[type=text]:focus, .input-field input[type=password]:focus {
              border-bottom: 1px solid #ffffff !important;
              box-shadow: 0 1px 0 0 #ffffff !important;
          }
          label {
              color: #cccccc;
          }
      }
  </style>
</head>
<body>
  <div class="background">
      <div class="container">
          <div class="row">
              <div class="col s12 m8 offset-m2 l6 offset-l3">
                  <div class="card">
                      <div class="card-content">
                          <span class="card-title center-align"><i class="material-icons left">link</i>Proxy Everything</span>
                          <form id="urlForm" onsubmit="redirectToProxy(event)">
                              <div class="input-field">
                                  <input type="password" id="proxyToken" placeholder="在此輸入訪問令牌" autocomplete="off" required>
                                  <label for="proxyToken">訪問令牌（TOKEN）</label>
                              </div>
                              <div class="input-field">
                                  <input type="text" id="targetUrl" placeholder="在此輸入目標地址" required>
                                  <label for="targetUrl">目標地址</label>
                              </div>
                              <button type="submit" class="btn waves-effect waves-light teal darken-2 full-width">跳轉</button>
                          </form>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  </div>
  <script src="https://s4.zstatic.net/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
  <script>
      // 頁面加載時恢復上次輸入的 TOKEN（僅保存在本瀏覽器 localStorage）
      document.addEventListener('DOMContentLoaded', function () {
          try {
              var saved = localStorage.getItem('cf_proxy_token');
              if (saved) {
                  document.getElementById('proxyToken').value = saved;
              }
          } catch (e) {}
          if (window.M && M.updateTextFields) { M.updateTextFields(); }
      });

      function redirectToProxy(event) {
          event.preventDefault();
          var token = document.getElementById('proxyToken').value.trim();
          var targetUrl = document.getElementById('targetUrl').value.trim();
          try { localStorage.setItem('cf_proxy_token', token); } catch (e) {}
          var currentOrigin = window.location.origin;
          // 代理地址格式：workers地址/TOKEN/要代理的網址
          window.open(currentOrigin + '/' + encodeURIComponent(token) + '/' + encodeURIComponent(targetUrl), '_blank');
      }
  </script>
</body>
</html>`;
}
