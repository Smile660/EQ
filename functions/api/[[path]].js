// EqLens 线上代理（Cloudflare Pages Functions）
// 与本地 server.py 的 /api/* 转发逻辑保持一致：
//   浏览器 --(x-eq-token)--> 本函数 --(token)--> https://server.simpletex.cn
// 页面中填写的令牌仅保存在访客本地浏览器，转发时原样传给 SimpleTex，不落任何存储。
export async function onRequestPost(context) {
  const { request } = context;
  const url = new URL(request.url);
  return proxy(request, url.pathname);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

// 代理白名单：仅开放公式识别相关端点，防止代理被滥用
const PROXY_PATHS = new Set(["/api/latex_ocr", "/api/latex_ocr_turbo"]);
const MAX_BODY = 12 * 1024 * 1024; // 12MB（页面侧限制 10MB）
const UPSTREAM = "https://server.simpletex.cn";

function upstreamError(errType, errMsg) {
  return { status: false, err_info: { err_type: errType, err_msg: errMsg } };
}

function jsonResponse(obj, code) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function proxy(request, path) {
  if (!PROXY_PATHS.has(path)) {
    return jsonResponse(upstreamError("api_not_find", "代理仅开放公式识别端点 /api/latex_ocr"), 404);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY) {
    return jsonResponse(upstreamError("image_oversize", "请求体过大（上限 12MB）"), 413);
  }
  if (body.byteLength === 0) {
    return jsonResponse(upstreamError("image_missing", "请求体为空"), 413);
  }

  const token = (request.headers.get("x-eq-token") || "").trim();
  const headers = new Headers();
  headers.set("Content-Type", request.headers.get("Content-Type") || "application/octet-stream");
  if (token) {
    headers.set("token", token); // x-eq-token -> token，符合 SimpleTex 鉴权协议
  }

  let resp;
  try {
    resp = await fetch(UPSTREAM + path, { method: "POST", body: body, headers: headers });
  } catch (err) {
    return jsonResponse(upstreamError("proxy_upstream_error", "无法连接 SimpleTex 服务：" + err.message), 502);
  }

  // 上游 401/402/429 等原样透传给页面
  const data = await resp.arrayBuffer();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}
