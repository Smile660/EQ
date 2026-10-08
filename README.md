# EqLens 公式识图

拍照 / 截图识别数学公式，转换为 LaTeX / Markdown / Word 等格式。
识别能力来自 [SimpleTex](https://simpletex.cn/) 开放接口，页面本身为纯静态站点。

## 在线使用

站点部署在 Cloudflare Pages，任何设备通过网址即可访问；在页面设置中填入自己的
[SimpleTex 用户令牌（UAT）](https://simpletex.cn/user/api) 即可开始识别。
令牌只保存在访客自己的浏览器里，不经过任何第三方存储。

## 本地使用

```bash
python server.py            # 默认 http://127.0.0.1:8020
```

`server.py` 提供静态文件服务，并把 `/api/latex_ocr*` 同源代理转发到 SimpleTex
（浏览器跨域策略不允许网页直接携带 SimpleTex 要求的 `token` 自定义请求头）。

## 部署架构（Cloudflare Pages）

```
访客浏览器
  ├─ 静态页面            index.html / assets/*      （Pages 直接托管）
  └─ POST /api/latex_ocr ──> functions/api/[[path]].js ──> server.simpletex.cn
                              （x-eq-token 换成 token 头后转发，白名单 + 12MB 上限）
```

推送代码到 GitHub 后，Pages 自动重新部署，无需手动操作。

## 目录结构

```
index.html                  页面入口
assets/css|js               前端样式与逻辑（无框架、无构建步骤）
server.py                   本地服务：静态文件 + 同源代理
functions/api/[[path]].js   线上代理（Cloudflare Pages Functions，逻辑与 server.py 一致）
```
